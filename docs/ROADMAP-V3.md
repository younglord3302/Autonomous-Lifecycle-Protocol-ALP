# Roadmap V3 (The Swarm Era)

With the successful execution of ALP Version 2.0.0 (The Execution Era), the protocol can now actively route context bundles to LLMs via `alp run` and safely mutate files using the MCP Server and Git Actions.

Version 3 of the Autonomous Lifecycle Protocol transitions the project from a **single-agent loop** to a **multi-agent swarm orchestration system**.

---

## Pillar 1: Concurrent Swarm Execution ✅
**Target:** Upgrade the CLI to manage multiple agents working simultaneously.
- **Dependency Aware Orchestration:** The engine will spin up parallel agents for tasks that have no overlapping dependencies.
- **`alp run --concurrent 3`:** Spin up 3 LLM agents that read the graph, claim available tasks via `LockManager`, and execute them asynchronously.
- **Cross-Agent Communication:** Agents will write to `@state` and `@memory` blocks to pass payloads between each other (e.g. Architect passes architecture to Developer).

## Pillar 2: Sub-agent Delegation ✅
**Target:** Enable agents to spawn other agents.
- **Task Decomposition:** An assigned `@agent` (e.g., Tech Lead) realizes a task is too big and autonomously breaks it down into sub-tasks inside the `.alp` folder.
- **MCP Delegation Tool:** An `alp_delegate` MCP tool that lets an agent assign a newly created task to a specific role (e.g., QA Engineer) and await its completion.

## Pillar 3: Human-in-the-Loop (HITL) Handoffs ✅
**Target:** Seamless escalation from AI to Human.
- **`[?]` Review Status:** Introduce a new status marker where an agent submits a PR and marks the task `[?]` awaiting human code review.
- **Interactive Checkpointing:** `alp checkpoint --ask-human` pauses the execution loop and pings the human developer in VS Code or GitHub for a clarification.

## Pillar 4: Centralized State Server ✅ (v3.1.0)
**Target:** A local HTTP + SSE server for real-time visualization.
- **ALP Daemon:** `alp serve` runs a local dashboard showing all active agents, their logs, memory writes, and file mutations in real time.
- **Structured Runtime Log:** The swarm emits typed events (`task_claim`, `task_status`, `human_handoff`, ...) to `.alp/.runtime/log.jsonl`, which the daemon tails and streams to the browser.
- **Live Dashboard:** A dependency-free, self-contained HTML dashboard served at `/`, backed by `/api/state`, `/api/graph`, `/api/events`, and `/api/stream` (SSE).

## Pillar 5: Self-Evolving Protocol ✅ (v3.1.0)
**Target:** Allow the AI swarm to optimize its own workflows.
- **Failure Telemetry:** `alp evolve` analyzes the runtime event log to detect tasks/workflows that repeatedly fail or repeatedly escalate to a human.
- **Automatic Rule Extraction:** Recurring failures become candidate `@rule` safety checks, written to `.alp/evolved.alp` with `alp evolve --apply` for human review.
- **Workflow Optimization:** Chronic human handoffs are surfaced as under-specified tasks needing more context.

---

## Estimated Timeline (V3)

| Phase | Goal | Status |
|---|---|---|
| Pillar 1 | Concurrent Swarm Execution | ✅ Done (3.0.0) |
| Pillar 2 | Sub-agent Delegation | ✅ Done (3.0.0) |
| Pillar 3 | Human-in-the-Loop Handoffs | ✅ Done (3.0.0) |
| Pillar 4 | Centralized State Server | ✅ Done (3.1.0) |
| Pillar 5 | Self-Evolving Protocol | ✅ Done (3.1.0) |

**V3 is complete as of `3.1.0`.** The next major cycle is tracked in [ROADMAP-V4.md](ROADMAP-V4.md).
