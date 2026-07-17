# ALP Instructions for Claude Code / Cline

This repository is managed by the Autonomous Lifecycle Protocol (ALP). As an autonomous agent, you must synchronize your work with the `.alp/` directory.

## Core Directives

1. **Orientation:** Before modifying source code, read `.alp/project.alp`. It contains the central goal and architecture rules of the codebase.
2. **Task Graph:** Work is tracked via `@task` blocks. Run `npx alp graph` to view the topological execution order of tasks.
3. **Status Sync:** When you pick up a task, you MUST modify the corresponding `.alp` file to change its status from `[ ]` (Todo) to `[~]` (In Progress). If a task needs a human decision, set it to `[?]` (Awaiting review) to hand off via the Human-in-the-Loop loop instead of marking it `[x]`.
4. **Validation:** After making ANY changes to `.alp` files, you MUST run `npx alp validate` to ensure the schema and dependency graph remain valid. Do not leave the workspace in a broken protocol state.

## Syntax Rules for Modifying .alp Files
- Use 2 spaces for property indentation.
- Use 4 spaces for list item indentation.
- Use standard references (`-> id`) for dependencies.
- Use `| requires` or `| blocks` for edge directives.

## Sub-Agents & Handoff
If a task specifies `owner: -> agent-reviewer`, and you are `agent-developer`, you must NOT mark the task as `[x]`. You may mark it `[~]` and leave a comment for the reviewer.

## Execution (V3)
- Use `npx alp run` to compile the context bundle for the next available task and pipe it into your loop. In swarm mode, `npx alp run --concurrent N` spins up N parallel agents.
- When reporting progress, use `npx alp checkpoint <taskId> <status>` (e.g. `npx alp checkpoint task-login-ui in-progress`). To hand off for review, use `npx alp checkpoint <taskId> --ask-human "<message>"`, which marks the task `[?]`.
- Never claim a task whose blocking dependencies (`depends_on`, `blocked_by`, `requires`) are not `[x]`. Reference links such as `feature:` or `owner:` do NOT block a task.

## Federation (V4 — The Federation Era)
ALP 4.0.0 adds cross-machine and cross-repository coordination. Use these when
the workspace spans more than one machine or repo:
- **Networked swarms:** Join a coordinator with `npx alp swarm join <id>` and execute tasks across machines via `npx alp run --swarm <id>`. List live nodes with `npx alp swarm roster <id>`. The coordinator assigns task claims so no two nodes double-claim.
- **Cross-repo orchestration:** If the workspace references external repos via `@repo` objects, run `npx alp repo resolve --fetch` to merge their graphs and resolve `-> repo::object` references (read-only). Use `npx alp repo ls` / `npx alp repo graph` to inspect the federation.
- **Policy governance:** Respect `@policy` guardrails. Before running a shell command or editing a path, check it with `npx alp policy --command "…"` or `npx alp policy --path "…"`. A strict policy that denies an action means you MUST NOT perform it.
- **Registry & packages:** Install shared knowledge with `npx alp registry install @community/<pack>@<range>`. Publish your own with `npx alp registry publish ./my-pack`, or host a registry via `npx alp serve --registry`.
- **Live observability:** `npx alp serve` starts a dashboard (HTTP + SSE) showing task status, claims, and analytics in real time.
