# CLI Verification & Tools

The `@alp/cli` is more than a validator; it's a complete ecosystem manager. Here is the full suite of CLI tools available in V3.

## Execution Engine (`alp run`)

`alp run` compiles a context bundle for the next available task and
(orchestrates agents in V3) executes it:

```bash
# Auto-select the next available task (or pipe the bundle to an agent)
alp run

# Run up to 3 agents concurrently (V3 swarm mode)
alp run --concurrent 3

# Submit a task for human review (HITL handoff)
alp checkpoint task-login-ui --ask-human "please review the login UI"
```

| Flag | Description |
| :--- | :--- |
| `--concurrent <n>` | Number of parallel agent loops (V3 swarm mode) |
| `--provider <p>` | LLM provider for native execution (`openai`, `anthropic`, `ollama`) |
| `--model <m>` | LLM model to use with the selected provider |
| `--agent <a>` | Override the assigned agent for the task |
| `--dry-run` | Preview the context bundle without executing |

## Verification Engine (`alp verify`)

A task isn't done until its quality gates pass. The `alp verify` command executes the shell scripts defined in the `verify` array of a `@task`.

```yaml
@task
  id: task-auth
  verify:
    - "npm run test:auth"
    - "eslint src/auth/"
```

Running `alp verify task-auth` will execute those commands. If they succeed, ALP automatically updates the task status to `[x]` (Done). If they fail, it marks the task as `[!]` (Blocked), preventing the Execution Engine from moving forward.

## Style Enforcement (`alp lint`)

While `alp validate` checks raw JSON schema compliance, `alp lint` enforces community best practices:
- Enforces `kebab-case` for all object IDs.
- Warns on missing or insufficient `description` fields.
- Warns if a `@task` lacks `verify` gates.

## Environment Diagnostics (`alp doctor`)

Having issues? Run `alp doctor` to instantly diagnose your workspace health. It checks for:
- Proper `.alp/` directory structure.
- Orphaned `.alp` files outside the target directory.
- Parseability of all files.

## Data Interoperability (`alp export`)

Need to integrate ALP with a legacy system or internal dashboard?

```bash
alp export --format yaml --out state.yaml
```

This compiles your entire `.alp` graph into a single, structured YAML or JSON file, allowing tools that don't speak `.alp` to ingest your project state natively.

## Protocol Upgrades (`alp upgrade`)

As the ALP specification evolves, run `alp upgrade` to safely migrate your legacy `.alp` files (e.g. from `v1.0.0`) to the latest syntax conventions and update their `!alp-version` directives.
