# Research — Model Context Protocol (MCP)

## What Is MCP?

The Model Context Protocol (MCP), developed by Anthropic, is an open standard for connecting AI models to external data sources, tools, and services. It defines a client-server architecture where AI agents can discover and invoke tools through a standardized JSON-RPC interface.

## Key Design Decisions

| Decision | MCP's Approach |
|---|---|
| Format | JSON-RPC 2.0 over stdio/SSE/HTTP |
| Schema | JSON Schema for tool parameters |
| Tooling | Growing ecosystem: server SDKs (TypeScript, Python), client integrations |
| Adoption | Adopted by Claude, Cursor, Windsurf, and others |
| Governance | Anthropic (open-source) |

## How MCP and ALP Relate

MCP and ALP are **complementary, not competing** protocols:

| Layer | Protocol | Purpose |
|---|---|---|
| **Tool Communication** | MCP | "How does an agent call a tool?" |
| **Project Understanding** | ALP | "What should the agent build, and how?" |

An AI agent uses **MCP** to discover what tools are available (file read/write, web search, database queries). It uses **ALP** to understand *what work needs to be done*, in *what order*, with *what verification*.

## What ALP Borrows from MCP

1. **Protocol-first thinking.** MCP proved that standardizing the communication layer creates massive interoperability. ALP applies the same principle to project definition.
2. **Resource discovery.** MCP's resource listing concept (what data is available?) mirrors ALP's context engine (what project knowledge should be loaded?).
3. **JSON Schema validation.** MCP uses JSON Schema for tool parameters. ALP will use JSON Schema for protocol object validation.

## Where ALP Diverges

1. **Different layer of the stack.** MCP operates at the *tool invocation* layer. ALP operates at the *project comprehension* layer. They work together, not against each other.
2. **Stateful lifecycle.** MCP is stateless — each tool call is independent. ALP is deeply stateful — it tracks project state, agent memory, and checkpoint history across sessions.
3. **Verification and quality gates.** MCP has no concept of "verification." ALP requires that completed work passes defined quality gates before being marked done.
4. **Multi-agent orchestration.** MCP connects a single agent to tools. ALP coordinates multiple specialized agents (planner, architect, frontend, backend, QA) working on the same project.

## Integration Vision

In a mature ALP ecosystem, an agent would:
1. Read the `.alp/` directory to understand the project (ALP)
2. Use MCP to discover available tools (file I/O, testing, deployment)
3. Execute work according to ALP workflows
4. Report results back to ALP state

## Conclusion

MCP solved "how agents talk to tools." ALP solves "how agents understand projects." Together, they form a complete autonomous development stack.
