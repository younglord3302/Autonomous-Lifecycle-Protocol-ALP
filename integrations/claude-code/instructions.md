# ALP Instructions for Claude Code / Cline

This repository is managed by the Autonomous Lifecycle Protocol (ALP). As an autonomous agent, you must synchronize your work with the `.alp/` directory.

> **CLI invocation:** the `@alp/cli` package is not yet published to npm. Build it from source (`npm ci && npm run build --workspace @alp/cli`) and invoke commands via `node cli/dist/index.js <command>` (e.g. `node cli/dist/index.js validate`). The examples below use that form.

## Core Directives

1. **Orientation:** Before modifying source code, read `.alp/project.alp`. It contains the central goal and architecture rules of the codebase.
2. **Task Graph:** Work is tracked via `@task` blocks. Run `node cli/dist/index.js graph` to view the topological execution order of tasks.
3. **Status Sync:** When you pick up a task, you MUST modify the corresponding `.alp` file to change its status from `[ ]` (Todo) to `[~]` (In Progress). If a task needs a human decision, set it to `[?]` (Awaiting review) to hand off via the Human-in-the-Loop loop instead of marking it `[x]`.
4. **Validation:** After making ANY changes to `.alp` files, you MUST run `node cli/dist/index.js validate` to ensure the schema and dependency graph remain valid. Do not leave the workspace in a broken protocol state.

## Syntax Rules for Modifying .alp Files
- Use 2 spaces for property indentation.
- Use 4 spaces for list item indentation.
- Use standard references (`-> id`) for dependencies.
- Use `| requires` or `| blocks` for edge directives.

## Sub-Agents & Handoff
If a task specifies `owner: -> agent-reviewer`, and you are `agent-developer`, you must NOT mark the task as `[x]`. You may mark it `[~]` and leave a comment for the reviewer.

## Execution (V3)
- Use `node cli/dist/index.js run` to compile the context bundle for the next available task and pipe it into your loop. In swarm mode, `node cli/dist/index.js run --concurrent N` spins up N parallel agents.
- When reporting progress, use `node cli/dist/index.js checkpoint <taskId> <status>` (e.g. `node cli/dist/index.js checkpoint task-login-ui in-progress`). To hand off for review, use `node cli/dist/index.js checkpoint <taskId> --ask-human "<message>"`, which marks the task `[?]`.
- Never claim a task whose blocking dependencies (`depends_on`, `blocked_by`, `requires`) are not `[x]`. Reference links such as `feature:` or `owner:` do NOT block a task.

## Federation & Supply Chain (V4 → V5)
ALP 4.0.0 adds cross-machine and cross-repository coordination; V5.0.0 hardens the SDK and adds registry signature verification. Use these when the workspace spans more than one machine, repo, or package:
- **Networked swarms:** Join a coordinator with `node cli/dist/index.js swarm join <id>` and execute tasks across machines via `node cli/dist/index.js run --swarm <id>`. List live nodes with `node cli/dist/index.js swarm roster <id>`. The coordinator assigns task claims so no two nodes double-claim.
- **Cross-repo orchestration:** If the workspace references external repos via `@repo` objects, run `node cli/dist/index.js repo resolve --fetch` to merge their graphs and resolve `-> repo::object` references (read-only). Use `node cli/dist/index.js repo ls` / `node cli/dist/index.js repo graph` to inspect the federation.
- **Policy governance:** Respect `@policy` guardrails. Before running a shell command or editing a path, check it with `node cli/dist/index.js policy --command "…"` or `node cli/dist/index.js policy --path "…"`. A strict policy that denies an action means you MUST NOT perform it.
- **Registry & packages:** Install shared knowledge with `node cli/dist/index.js registry install @community/<pack>@<range>`. Publish your own with `node cli/dist/index.js registry publish ./my-pack`, or host a registry via `node cli/dist/index.js serve --registry`.
- **Registry trust & verification:** Pin maintainer keys in `.alprc` `trustedKeys` (or via `node cli/dist/index.js keys trust add <ns|*> <fingerprint|file>`); installs are then verified automatically. Audit any package — local or remote — with `node cli/dist/index.js registry verify <name>[@version]` and `node cli/dist/index.js registry verify <name>[@version] --url <host>` without installing.
- **Live observability:** `node cli/dist/index.js serve` starts a dashboard (HTTP + SSE) showing task status, claims, and analytics in real time.
