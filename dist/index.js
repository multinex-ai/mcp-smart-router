import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
export class SmartRouterMCP {
    config;
    server;
    childTools = new Map();
    constructor(config, serverName = "multinex-smart-router", serverVersion = "1.0.0") {
        this.config = config;
        this.server = new Server({ name: serverName, version: serverVersion }, { capabilities: { tools: {} } });
        this.setupHandlers();
    }
    /**
     * Registers a child tool internally. These tools are NOT exposed directly
     * to the IDE, bypassing the 50-tool limitation.
     */
    registerTool(tool) {
        this.childTools.set(tool.name, tool);
    }
    setupHandlers() {
        // Expose only ONE high-level tool to the IDE/Client
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "execute_intelligent_task",
                        description: "An intelligent agentic router that can autonomously utilize hundreds of internal tools to accomplish complex tasks. Use this for ANY multi-step process, analysis, or action.",
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
                const { prompt, context } = request.params.arguments;
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
    async routeAndExecute(prompt, context) {
        let finalAnswer = "Task completed.";
        for await (const event of this.executeTaskStream(prompt, context)) {
            if (event.type === "final_answer") {
                finalAnswer = event.text;
            }
            else if (event.type === "error") {
                return `Error: ${event.message}`;
            }
        }
        return finalAnswer;
    }
    /**
     * Streaming Agentic Loop:
     * Yields execution state events back to the caller for UI rendering (e.g. SSE)
     */
    async *executeTaskStream(prompt, context) {
        const tools = Array.from(this.childTools.values()).map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
        }));
        const systemPrompt = `You are the Multinex Smart Router. You have access to a set of internal tools. 
Your job is to solve the user's task using the tools provided. If no tools are needed or you have finished, provide the final answer. Keep your final answer concise and helpful.`;
        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt + (context ? `\nContext: ${context}` : "") }
        ];
        let maxIterations = 5;
        let iteration = 0;
        while (iteration < maxIterations) {
            iteration++;
            try {
                const aiPayload = { messages };
                if (tools.length > 0) {
                    aiPayload.tools = tools;
                }
                const response = await this.config.env.AI.run(this.config.defaultModel, aiPayload, { gateway: { id: this.config.gatewayId } });
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
                        }
                        else {
                            try {
                                // Workers AI tool calls might return arguments as object or string
                                const args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments;
                                const rawResult = await tool.handler(args || {});
                                toolResultStr = JSON.stringify(rawResult);
                                yield { type: "tool_result", tool: call.name, result: rawResult };
                            }
                            catch (e) {
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
                }
                else if (response.response) {
                    // Model provided a final text answer
                    yield { type: "final_answer", text: response.response };
                    return;
                }
                else {
                    yield { type: "error", message: "Unexpected empty response from model." };
                    return;
                }
            }
            catch (err) {
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
    getServer() {
        return this.server;
    }
}
