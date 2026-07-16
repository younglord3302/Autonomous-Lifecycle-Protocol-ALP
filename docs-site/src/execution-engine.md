# The Execution Engine (`alp run`)

In V2 of the Autonomous Lifecycle Protocol, ALP transitioned from a static schema validation tool into an active **Execution Engine**. In V3 it became a **multi-agent orchestrator** capable of running concurrent agent swarms.

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

## V3 Swarm Mode (concurrent execution)

In V3, `alp run` can orchestrate **multiple agents in parallel**. Pass
`--concurrent <n>` to spin up `n` worker loops that read the Dependency
Graph, claim available tasks via the `LockManager`, and execute
dependency-unblocked tasks asynchronously:

```bash
# Run up to 3 agents concurrently
alp run --concurrent 3
```

- **Dependency-aware**: a worker only claims a task once all of its
  blocking dependencies (`depends_on`, `blocked_by`, `requires`) are
  `[x]`. Reference links such as `feature:` or `owner:` do **not** block.
- **LockManager**: each claimed task is locked with the claiming agent's
  PID. A task locked by a live process cannot be double-executed;
  stale locks left by dead processes are auto-stolen.
- **Graceful shutdown**: workers exit once every task is done or none
  remain actionable.

### Native LLM execution

Instead of piping the context bundle to an external CLI, ALP can drive
an LLM directly. Supply a provider and model and the engine runs its
internal Loop Engine against the task:

```bash
alp run task-login-ui --provider anthropic --model claude-sonnet-4
```

Useful flags:

| Flag | Description |
| :--- | :--- |
| `--concurrent <n>` | Number of parallel agent loops (V3 swarm mode) |
| `--provider <p>` | LLM provider for native execution (`openai`, `anthropic`, `ollama`) |
| `--model <m>` | LLM model to use with the selected provider |
| `--agent <a>` | Override the assigned agent for the task |
| `--dry-run` | Preview the context bundle without executing |

## Integrating with AI Agents

Since `alp run` outputs standard Markdown to `stdout`, it is designed to be piped directly into your CLI-based AI tools:

```bash
alp run | claude-code
alp run | cursor-agent
```
