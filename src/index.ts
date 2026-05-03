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
   */
  private async routeAndExecute(prompt: string, context?: string): Promise<string> {
    // 1. Build tool definitions for the LLM
    const availableTools = Array.from(this.childTools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    // 2. Create the system prompt with tool knowledge
    const systemPrompt = `You are the Multinex Smart Router. You have access to the following tools:
${JSON.stringify(availableTools, null, 2)}

Your job is to solve the user's task. You must output a JSON object containing the tool to call and its arguments, OR a final answer.
Format:
{
  "action": "call_tool" | "final_answer",
  "tool": "tool_name",
  "arguments": { ... },
  "answer": "The final result if action is final_answer"
}`;

    let currentPrompt = prompt + (context ? `\nContext: ${context}` : "");
    let maxIterations = 5;
    let iteration = 0;
    
    // Simplistic ReAct loop
    while (iteration < maxIterations) {
      iteration++;

      // Invoke Cloudflare AI Gateway
      const response = await this.config.env.AI.run(
        this.config.defaultModel,
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: currentPrompt },
          ],
        },
        { gateway: { id: this.config.gatewayId } }
      );

      let llmOutput = response.response;
      
      try {
        // Strip markdown code blocks if the LLM wrapped the JSON
        const jsonMatch = llmOutput.match(/\{[\s\S]*\}/);
        if (jsonMatch) llmOutput = jsonMatch[0];
        
        const decision = JSON.parse(llmOutput);

        if (decision.action === "final_answer") {
          return decision.answer || "Task completed.";
        }

        if (decision.action === "call_tool" && decision.tool) {
          const tool = this.childTools.get(decision.tool);
          if (!tool) {
            currentPrompt += `\nSystem: Tool '${decision.tool}' not found. Try again.`;
            continue;
          }

          // Execute the local tool handler
          const toolResult = await tool.handler(decision.arguments || {});
          
          // Feed result back to the LLM
          currentPrompt += `\nTool '${decision.tool}' returned: ${JSON.stringify(toolResult)}`;
        }
      } catch (err: any) {
        currentPrompt += `\nSystem: Failed to parse your JSON or execute tool: ${err.message}. Please output strictly valid JSON matching the format.`;
      }
    }

    return "Error: Reached maximum iterations without completing the task.";
  }

  /**
   * Return the underlying Server instance for binding to standard transports
   * (e.g. StdioServerTransport or SSEServerTransport).
   */
  public getServer(): Server {
    return this.server;
  }
}