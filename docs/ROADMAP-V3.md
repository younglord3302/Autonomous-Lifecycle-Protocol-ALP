# Roadmap V3 (The Swarm Era)

With the successful execution of ALP Version 2.0.0 (The Execution Era), the protocol can now actively route context bundles to LLMs via `alp run` and safely mutate files using the MCP Server and Git Actions.

Version 3 of the Autonomous Lifecycle Protocol transitions the project from a **single-agent loop** to a **multi-agent swarm orchestration system**.

---

## Pillar 1: Concurrent Swarm Execution 🔜
**Target:** Upgrade the CLI to manage multiple agents working simultaneously.
- **Dependency Aware Orchestration:** The engine will spin up parallel agents for tasks that have no overlapping dependencies.
- **`alp run --concurrent 3`:** Spin up 3 LLM agents that read the graph, claim available tasks via `LockManager`, and execute them asynchronously.
- **Cross-Agent Communication:** Agents will write to `@state` and `@memory` blocks to pass payloads between each other (e.g. Architect passes architecture to Developer).

## Pillar 2: Sub-agent Delegation 🔜
**Target:** Enable agents to spawn other agents.
- **Task Decomposition:** An assigned `@agent` (e.g., Tech Lead) realizes a task is too big and autonomously breaks it down into sub-tasks inside the `.alp` folder.
- **MCP Delegation Tool:** An `alp_delegate` MCP tool that lets an agent assign a newly created task to a specific role (e.g., QA Engineer) and await its completion.

## Pillar 3: Human-in-the-Loop (HITL) Handoffs 🔜
**Target:** Seamless escalation from AI to Human.
- **`[?]` Review Status:** Introduce a new status marker where an agent submits a PR and marks the task `[?]` awaiting human code review.
- **Interactive Checkpointing:** `alp checkpoint --ask-human` pauses the execution loop and pings the human developer in VS Code or GitHub for a clarification.

## Pillar 4: Centralized State Server 🔜
**Target:** A local SQLite / WebSocket server for real-time visualization.
- **ALP Daemon:** `alp serve` runs a local dashboard showing all active agents, their logs, memory writes, and file mutations in real time.
- **Live Graph Viewer:** The dependency graph turns from a static markdown export into an interactive React Flow dashboard.

## Pillar 5: Self-Evolving Protocol 🔜
**Target:** Allow the AI swarm to optimize its own workflows.
- **Automatic Rule Extraction:** Agents evaluate a closed PR and automatically extract generic `@rule` blocks from code review comments.
- **Workflow Optimization:** Agents observe that a specific phase in a `@workflow` consistently fails and autonomously propose a patch to the workflow definition to add a safety check.

---

## Estimated Timeline (V3)

| Phase | Goal | Status |
|---|---|---|
| Pillar 1 | Concurrent Swarm Execution | 🔜 Next |
| Pillar 2 | Sub-agent Delegation | 🔜 |
| Pillar 3 | Human-in-the-Loop Handoffs | 🔜 |
| Pillar 4 | Centralized State Server | 🔜 |
| Pillar 5 | Self-Evolving Protocol | 🔜 |
