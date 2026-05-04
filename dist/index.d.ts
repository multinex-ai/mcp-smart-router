import { Server } from "@modelcontextprotocol/sdk/server/index.js";
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
export type RouterEvent = {
    type: "tool_call";
    tool: string;
    input?: any;
} | {
    type: "tool_result";
    tool: string;
    result: any;
} | {
    type: "final_answer";
    text: string;
} | {
    type: "error";
    message: string;
};
export declare class SmartRouterMCP {
    private config;
    private server;
    private childTools;
    constructor(config: SmartRouterConfig, serverName?: string, serverVersion?: string);
    /**
     * Registers a child tool internally. These tools are NOT exposed directly
     * to the IDE, bypassing the 50-tool limitation.
     */
    registerTool(tool: ChildTool): void;
    private setupHandlers;
    /**
     * Core Agentic Loop:
     * Uses Cloudflare AI to evaluate the prompt against the registered child tools,
     * decides which tools to call, executes them locally, and synthesizes a final response.
     * This is a convenience method that exhausts the stream and returns the final answer.
     */
    private routeAndExecute;
    /**
     * Streaming Agentic Loop:
     * Yields execution state events back to the caller for UI rendering (e.g. SSE)
     */
    executeTaskStream(prompt: string, context?: string): AsyncGenerator<RouterEvent, void, unknown>;
    /**
     * Return the underlying Server instance for binding to standard transports
     * (e.g. StdioServerTransport or SSEServerTransport).
     */
    getServer(): Server;
}
//# sourceMappingURL=index.d.ts.map