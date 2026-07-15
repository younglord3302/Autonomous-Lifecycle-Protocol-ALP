# The Execution Engine (`alp run`)

In V2 of the Autonomous Lifecycle Protocol, ALP transitioned from a static schema validation tool into an active **Execution Engine**.

The `@alp/cli` provides the `alp run` command to natively orchestrate your autonomous workforce.

## How it works

When you execute `alp run`, the engine performs the following steps:

1. **Topological Sort**: It uses Kahn's Algorithm on the Dependency Graph to determine the execution order of all `@task` objects. It filters out tasks that are blocked (`[!]`), already done (`[x]`), or waiting on unresolved dependencies.
2. **Context Bundling**: Once the first available `[ ]` task is identified, ALP automatically compiles a "Context Bundle". This is a highly optimized Markdown payload containing:
   - The `@project` definition.
   - The `@agent` profile assigned to the task (so the LLM knows its persona and capabilities).
   - Any finalized `@decision`s (e.g., architecture choices).
   - Any absolute `@rule`s the agent must follow.
   - Relevant cross-session `@memory` blobs.
3. **Piping**: It outputs this bundle directly to stdout.

## Usage

```bash
# Auto-select the next available task
alp run

# Dry-run (preview the payload without executing)
alp run --dry-run

# Target a specific task manually
alp run task-login-ui
```

## Integrating with AI Agents

Since `alp run` outputs standard Markdown to `stdout`, it is designed to be piped directly into your CLI-based AI tools:

```bash
alp run | claude-code
alp run | cursor-agent
```
