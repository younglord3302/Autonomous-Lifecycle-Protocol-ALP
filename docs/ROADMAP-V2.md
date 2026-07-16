# Roadmap V2 (The Execution Era)

With the successful release of ALP Version 1.0.0 (The Specification Era), the protocol is now stable, machine-readable, and thoroughly parsed by language SDKs.

Version 2 of the Autonomous Lifecycle Protocol transitions the project from a **passive tracking system** to an **active runtime environment**.

---

## Pillar 1: Language Server Protocol (LSP) ✅
**Target:** Upgrade the VS Code extension to implement a full Language Server.
- **Go To Definition:** Command-click on `-> task-id` to instantly open the file defining that task.
- **IntelliSense:** Autocomplete suggestions for agents, goals, and tasks based on the workspace graph.
- **Rename Tracking:** Global symbol renaming across the `.alp` workspace.

## Pillar 2: The Native Execution Engine ✅
**Target:** Add `alp run` to the CLI to orchestrate LLM agents natively.
- Connect the CLI to OpenAI/Anthropic/Local APIs.
- Allow developers to run `alp run --task "feat-auth"`. The CLI spins up the assigned `@agent`, provides context from the graph, executes the work in a sandbox, and handles verification loops until completion.

## Pillar 3: Model Context Protocol (MCP) Server ✅
**Target:** Release an `@alp/mcp-server` package.
- Allow any modern AI IDE (Cursor, Claude Desktop, Windsurf) to connect securely to the ALP workspace.
- Provide standardized MCP tools: `alp_get_graph`, `alp_read_task`, `alp_update_status`.

## Pillar 4: Git & CI Synchronization ✅
**Target:** Deeply integrate ALP state with human workflow tools.
- GitHub Action to automatically transition linked `.alp` task statuses to `[~] In Review` when a PR opens, and `[x] Done` when merged.
- Bi-directional sync with issue trackers (Linear, Jira, GitHub Issues).

## Pillar 5: The ALP Package Registry ✅
**Target:** Establish a community hub for sharing autonomous knowledge.
- A centralized registry (like npm/crates.io) for ALP components.
- Developers can run `alp install @community/scrum-master` to import highly-optimized agent definitions and workflows into their workspaces.

---

## Estimated Timeline (V2)

| Phase | Goal | Status |
|---|---|---|
| Pillar 1 | Language Server Protocol | ✅ Done |
| Pillar 2 | Execution Engine (`alp run`) | ✅ Done |
| Pillar 3 | MCP Server | ✅ Done |
| Pillar 4 | Git & CI Sync | ✅ Done |
| Pillar 5 | Package Registry | ✅ Done |
