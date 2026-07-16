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
