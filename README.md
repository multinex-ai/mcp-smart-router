# Multinex Smart Router MCP 🌐

[![NPM Version](https://img.shields.io/npm/v/@multinex/mcp-smart-router.svg)](https://npmjs.com/package/@multinex/mcp-smart-router)
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](https://opensource.org/licenses/MIT)

**A Stateful Agentic Orchestrator for the Model Context Protocol (MCP)**

The **Multinex Smart Router MCP** is a lightweight, edge-native orchestrator built on Cloudflare Workers AI. It solves the critical scalability issue of MCP clients (like IDEs or chat interfaces) crashing or degrading when exposed to too many tools (the 50+ tool limit).

Instead of exposing 100 individual tools to your client, the Smart Router exposes **a single high-level tool** (`execute_intelligent_task`). It securely aggregates and registers all your underlying child MCP servers. When invoked, it uses a powerful edge LLM (like `openai/gpt-5.5` via Cloudflare AI Gateway) to autonomously determine the intent, execute the necessary sub-tools, and synthesize a final response entirely on the server-side.

## Features

- 🚀 **Bypass Client Limits:** Expose 1 intelligent tool instead of 100+ micro-tools.
- 🧠 **Agentic Orchestration:** Powered by ReAct logic on the Cloudflare Edge.
- ⚡ **Edge Native:** Built for Cloudflare Workers, ensuring ultra-low latency.
- 🛡️ **Secure Aggregation:** Keep sensitive internal tools completely hidden from the client's context window.

## Installation

```bash
npm install @multinex/mcp-smart-router
# or
pnpm add @multinex/mcp-smart-router
# or
yarn add @multinex/mcp-smart-router
```

## Quick Start

```typescript
import { SmartRouterMCP } from "@multinex/mcp-smart-router";

// Initialize the Smart Router
const router = new SmartRouterMCP({
  gatewayId: "default",
  defaultModel: "openai/gpt-5.5",
  env: env // Your Cloudflare Worker environment binding containing `env.AI`
});

// Register underlying "child" tools that you want to keep hidden from the client
router.registerTool({
  name: "fetch_billing_data",
  description: "Fetches billing data for a given customer ID",
  inputSchema: { /* JSON Schema */ },
  handler: async (args) => {
    // Your local or remote tool execution logic
    return { status: "success", data: { ... } };
  }
});

// The router now exposes exactly one tool: `execute_intelligent_task`.
// Bind the router's server to your transport (e.g., stdio or SSE).
const mcpServer = router.getServer();
```

## How It Works

1. **Client Interaction:** The IDE or Chatbot calls `execute_intelligent_task(prompt: "Check billing status for user 123")`.
2. **Edge Processing:** The Smart Router sends the prompt and the internal tool definitions to Cloudflare AI (`gpt-5.5`).
3. **Autonomous Routing:** The LLM decides to invoke the `fetch_billing_data` tool.
4. **Execution & Synthesis:** The router executes the tool locally, feeds the result back to the LLM, and the LLM formulates a natural language answer.
5. **Return:** The client receives a clean, concise answer without ever knowing the underlying tool existed.

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/multinex-ai/mcp-smart-router/blob/main/CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License.

---
*Built with precision by the [Multinex AI](https://multinex.ai) Engineering Team.*
