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

## Live State Server (`alp serve`)

*New in `3.1.0`.* `alp serve` runs a local, zero-dependency dashboard that
visualizes your swarm in real time. It tails the structured runtime event log
(`.alp/.runtime/log.jsonl`) and streams updates to the browser over
Server-Sent Events.

```bash
alp serve --port 4000
alp serve --db          # persist a durable state store + analytics
```

| Flag | Description |
| :--- | :--- |
| `--port <n>` | Port to listen on (default `4000`) |
| `--host <host>` | Host to bind to (default `127.0.0.1`) |
| `--db` | *New in V4 (Pillar 5).* Persist a durable state store of runtime events to `.alp/.runtime/state.db.json` and expose `/api/analytics` |

Endpoints:

| Route | Description |
| :--- | :--- |
| `/` | Self-contained HTML dashboard |
| `/api/state` | Task status counts, agents, active locks, recent events |
| `/api/graph` | The dependency graph (nodes + edges) |
| `/api/events` | The full runtime event history |
| `/api/analytics` | *V4 Pillar 5.* Cycle time per task, agent utilization, failure hotspots, event throughput |
| `/api/stream` | Live SSE stream of new events |
| `/api/swarm/join` | *V4 Pillar 1.* Register a node with a swarm coordinator |
| `/api/swarm/heartbeat` | *V4 Pillar 1.* Report node liveness |
| `/api/swarm/claim` | *V4 Pillar 1.* Negotiate a task claim (server-brokered lock) |
| `/api/swarm/release` | *V4 Pillar 1.* Release a task claim |
| `/api/swarm/roster` | *V4 Pillar 1.* List live nodes and their claims |

## Networked Swarms (`alp swarm`)

*New in V4 (Pillar 1).* A swarm can span multiple machines by coordinating
through an `alp serve` instance. Declare it with a `@swarm` object, then:

```bash
alp swarm join <id>            # register this node + start heartbeating
alp swarm roster <id>          # list live nodes and their current claims
alp swarm leave <id>           # deregister
alp run --swarm <id>           # execute tasks, negotiating claims via the coordinator
```

## Self-Evolving Protocol (`alp evolve`)

*New in `3.1.0`.* `alp evolve` analyzes the runtime event log to detect tasks
that repeatedly fail (`[!]`) or repeatedly escalate to a human (`[?]`). It
proposes new `@rule` safety checks so the swarm stops making the same mistake.

```bash
# Print a self-evolution report
alp evolve

# Write proposed rules to .alp/evolved.alp for review
alp evolve --apply
```

By design this is a human-in-the-loop *proposal* engine: nothing is committed to
your workspace until you review `.alp/evolved.alp`.

## Policy Governance (`alp policy`)

*New in `4.0.0` (The Federation Era).* `@policy` objects declare guardrails for
autonomous agents — which file paths they may modify, which shell commands they
may run, and resource budgets. `alp policy` lists them or evaluates a proposed
action, exiting non-zero when a strict policy blocks it (usable as a CI gate).

```bash
# List policies in the workspace
alp policy

# Check whether an action is permitted
alp policy --path "src/auth/login.ts"
alp policy --command "rm -rf /"
alp policy --command "git push" --agent agent-developer
```

Policies are also enforced automatically by `alp verify`: a verification command
that violates a strict policy is blocked and never executed. `deny_*` rules
always take precedence over `allow_*`.

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
