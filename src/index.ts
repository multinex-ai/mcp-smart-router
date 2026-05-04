import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/**
 * Cloudflare AI environment binding.
 */
export interface CloudflareEnv {
  AI: any;
}

export interface SmartRouterConfig {
  /** The Cloudflare AI gateway ID to use (e.g. 'default') */
  gatewayId: string;
  /** The model to use for intelligent routing (e.g. 'openai/gpt-5.5') */
  defaultModel: string;
  /** Cloudflare environment containing the AI binding */
  env: CloudflareEnv;
}

export interface ChildTool {
  name: string;
  description: string;
  inputSchema: any;
  /** The local handler for the tool */
  handler: (args: any) => Promise<any>;
}

export type RouterEvent = 
  | { type: "tool_call"; tool: string; input?: any }
  | { type: "tool_result"; tool: string; result: any }
  | { type: "final_answer"; text: string }
  | { type: "error"; message: string };

export class SmartRouterMCP {
  private server: Server;
  private childTools: Map<string, ChildTool> = new Map();

  constructor(
    private config: SmartRouterConfig,
    serverName: string = "multinex-smart-router",
    serverVersion: string = "1.0.0"
  ) {
    this.server = new Server(
      { name: serverName, version: serverVersion },
      { capabilities: { tools: {} } }
    );

    this.setupHandlers();
  }

  /**
   * Registers a child tool internally. These tools are NOT exposed directly
   * to the IDE, bypassing the 50-tool limitation.
   */
  public registerTool(tool: ChildTool) {
    this.childTools.set(tool.name, tool);
  }

  private setupHandlers() {
    // Expose only ONE high-level tool to the IDE/Client
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "execute_intelligent_task",
            description:
              "An intelligent agentic router that can autonomously utilize hundreds of internal tools to accomplish complex tasks. Use this for ANY multi-step process, analysis, or action.",
            inputSchema: {
              type: "object",
              properties: {
                prompt: {
                  type: "string",
                  description: "The task, question, or instruction for the router to execute.",
                },
                context: {
                  type: "string",
                  description: "Optional additional context or JSON state.",
                },
              },
              required: ["prompt"],
            },
          },
        ],
      };
    });

    // Handle the high-level tool call
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "execute_intelligent_task") {
        const { prompt, context } = request.params.arguments as any;
        const result = await this.routeAndExecute(prompt, context);
        return {
          content: [{ type: "text", text: result }],
        };
      }
      throw new Error(`Tool not found: ${request.params.name}`);
    });
  }

  /**
   * Core Agentic Loop: 
   * Uses Cloudflare AI to evaluate the prompt against the registered child tools,
   * decides which tools to call, executes them locally, and synthesizes a final response.
   * This is a convenience method that exhausts the stream and returns the final answer.
   */
  private async routeAndExecute(prompt: string, context?: string): Promise<string> {
    let finalAnswer = "Task completed.";
    for await (const event of this.executeTaskStream(prompt, context)) {
      if (event.type === "final_answer") {
        finalAnswer = event.text;
      } else if (event.type === "error") {
        return `Error: ${event.message}`;
      }
    }
    return finalAnswer;
  }

  /**
   * Streaming Agentic Loop:
   * Yields execution state events back to the caller for UI rendering (e.g. SSE)
   */
  public async *executeTaskStream(prompt: string, context?: string): AsyncGenerator<RouterEvent, void, unknown> {
    const tools = Array.from(this.childTools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));

    const systemPrompt = `You are the Multinex Smart Router. You have access to a set of internal tools. 
Your job is to solve the user's task using the tools provided. If no tools are needed or you have finished, provide the final answer. Keep your final answer concise and helpful.`;

    const messages: any[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt + (context ? `\nContext: ${context}` : "") }
    ];

    let maxIterations = 5;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      try {
        const aiPayload: any = { messages };
        if (tools.length > 0) {
          aiPayload.tools = tools;
        }

        const response = await this.config.env.AI.run(
          this.config.defaultModel,
          aiPayload,
          { gateway: { id: this.config.gatewayId } }
        );

        if (response.tool_calls && response.tool_calls.length > 0) {
          // Model decided to call tools
          messages.push({
            role: "assistant",
            tool_calls: response.tool_calls
          });

          for (const call of response.tool_calls) {
            yield { type: "tool_call", tool: call.name, input: call.arguments };
            
            const tool = this.childTools.get(call.name);
            let toolResultStr = "";

            if (!tool) {
              toolResultStr = JSON.stringify({ error: `Tool ${call.name} not found.` });
            } else {
              try {
                // Workers AI tool calls might return arguments as object or string
                const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
                const rawResult = await tool.handler(args || {});
                toolResultStr = JSON.stringify(rawResult);
                yield { type: "tool_result", tool: call.name, result: rawResult };
              } catch (e: any) {
                toolResultStr = JSON.stringify({ error: e.message });
                yield { type: "tool_result", tool: call.name, result: { error: e.message } };
              }
            }

            messages.push({
              role: "tool",
              name: call.name,
              content: toolResultStr
            });
          }
        } else if (response.response) {
          // Model provided a final text answer
          yield { type: "final_answer", text: response.response };
          return;
        } else {
          yield { type: "error", message: "Unexpected empty response from model." };
          return;
        }

      } catch (err: any) {
        yield { type: "error", message: err.message || "Failed to execute AI request." };
        return;
      }
    }

    yield { type: "error", message: "Reached maximum iterations without completing the task." };
  }

  /**
   * Return the underlying Server instance for binding to standard transports
   * (e.g. StdioServerTransport or SSEServerTransport).
   */
  public getServer(): Server {
    return this.server;
  }
}
