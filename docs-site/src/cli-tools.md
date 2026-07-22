# CLI Verification & Tools

The `@alp/cli` is more than a validator; it's a complete ecosystem manager. Here is the full suite of **38 CLI commands** available in `16.1.0`. New in v16.1: E2E integration tests, enriched examples, and expanded MCP tooling.

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
| `--registry` | *V4 Pillar 3.* Host the package registry over HTTP (`/api/registry/*`) |
| `--registry-token <t>` | *V4.1.0.* Require `Authorization: Bearer <t>` on registry requests. A bare token protects every namespace; a `ns=token` map protects only those namespaces (read + publish) |

## Terminal UI Dashboard (`alp tui`)

*New in `16.0.0`.* `alp tui` launches a real-time, interactive terminal UI dashboard directly in your terminal. It renders an ASCII progress bar, task status breakdowns (`[x]`, `[~]`, `[!]`, `[?]`, `[ ]`), active locks, and a live stream tail of runtime log events with keyboard controls.

```bash
alp tui
```

| Key | Description |
| :--- | :--- |
| `r` | Force refresh workspace state |
| `q` | Quit the terminal dashboard |
| `Ctrl+C` | Terminate |

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
| `/api/registry` | *V4 Pillar 3.* Marketplace listing (`?q=` for search); gated by a global token |
| `/api/registry/-/<ns>/<name>/meta.json` | *V4 Pillar 3.* Package metadata (all versions); gated per namespace |
| `/api/registry/-/<ns>/<name>/<version>/<file>` | *V4 Pillar 3.* Package file download; gated per namespace |
| `PUT /api/registry/-/<ns>/<name>` | *V4.1.0.* Publish a package (manifest + file contents); gated by the namespace token |

## Networked Swarms (`alp swarm`)

*New in V4 (Pillar 1).* A swarm can span multiple machines by coordinating
through an `alp serve` instance. Declare it with a `@swarm` object, then:

```bash
alp swarm join <id>            # register this node + start heartbeating
alp swarm roster <id>          # list live nodes and their current claims
alp swarm leave <id>           # deregister
alp run --swarm <id>           # execute tasks, negotiating claims via the coordinator
```

## Cross-Repository Orchestration (`alp repo`)

*New in V4 (Pillar 2).* A single workspace can span multiple Git repositories.
Declare each external repo with a `@repo` object, then:

```bash
alp repo ls                   # list declared @repo objects
alp repo fetch                # clone/update Git-backed repos into .alp/.cache/repos/<id>
alp repo resolve [--fetch]    # merge graphs and resolve -> repo::object references
alp repo graph                # print the merged cross-repo node/edge graph
```

Cross-repo references (`-> billing::task-stripe`) are **read-only**: an agent
may read another repo's objects but must not modify its `.alp/`. Dangling
references are reported so the federation fails fast.

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

### Policy v2 — time-windows, approvals & signed proposals (*v8.1.0*)

`@policy` is extended for least-privilege operation:

```bash
# Verify a signed action proposal against a trust root
alp policy --proposal prop-deploy-prod --trust maintainer.pub

# Time-scoped least privilege: a policy with `allow_during` denies actions
# outside every declared UTC window. `require_approval` escalates a matching
# action to a human instead of auto-blocking it.
```

| Flag | Description |
| :--- | :--- |
| `--proposal <id>` | *v8.1.0.* Verify a signed `proposal` block by id against the workspace's `proposals` list |
| `--trust <pem>` | *v8.1.0.* Trust root (PEM / fingerprint) for proposal signature verification |

## Scheduling (`alp schedule`) — *v8.2.0*

Native scheduling without an external cron daemon. Declare `@timeline`
objects (standard 5-field `cron` or one-shot `at` ISO-8601 triggers) and
discover what's due:

```bash
alp schedule                 # list every @timeline and its next fire time
alp schedule next            # list only timelines due now
alp schedule enable  tl-daily-standup
alp schedule disable tl-retro
alp schedule --at "2026-07-20T09:00:00Z"   # evaluate as of a fixed time (testing)
```

Evaluated by `TimelineEngine.evaluate(now)` and by agents through the Loop
Engine (spec/17).

## Encrypted Secrets Vault (`alp vault`) — *v10.0.0*

Store secrets encrypted at rest (age-style X25519 envelope + AES-256-GCM),
recipient-scoped so only the matching private key can unseal them. The vault
`recipients` list doubles as the registry trust root (spec/19).

```bash
alp vault set db-password --value "$DB_PW" --recipient maintainer.pub
alp vault get db-password --key maintainer.key
alp vault list
alp vault rotate db-password --key maintainer.key
alp vault audit
```

> Encryption in the Python SDK requires the optional `cryptography` package
> (`pip install alp-sdk[vault]`); the TS SDK uses Node's built-in `crypto`, so
> encryption is always available there.

## Hosted Registry & Marketplace (`alp registry`)

*New in `4.0.0` (Pillar 3), hardened in `4.1.0`.* Packages are publishable,
discoverable units of autonomous knowledge (community templates, role packs,
workflow packs). The registry is a zero-dependency, filesystem-backed store that
can also be hosted over HTTP by `alp serve --registry`. Every published version
carries a sha256 integrity hash, verified on download.

```bash
# Publish the package in ./my-pack into the local store (.alp/registry)
alp registry publish ./my-pack

# Host a registry so other machines can install from it
alp serve --registry --port 4000

# Gate a private registry with a bearer token (spec/14 §4.2). A bare token
# protects every namespace; a `ns=token` map protects only those namespaces
# (read + publish). Clients present the token via `.alprc` auth, or
# `--url` + `--token`.
alp serve --registry --registry-token "$ALP_REGISTRY_TOKEN" --port 4000
alp serve --registry --registry-token "@demo=dsecret,@internal=isecret" --port 4000

# Publish over HTTP (requires the namespace token on the host)
alp registry publish ./my-pack --url http://127.0.0.1:4000 --token "$ALP_REGISTRY_TOKEN"

# Discover and install
alp registry list --url http://127.0.0.1:4000
alp registry search scrum --url http://127.0.0.1:4000
alp registry install @community/scrum-master@^1.0.0 --url http://127.0.0.1:4000
```

Version resolution supports semver ranges (`^1.0.0`, `~2.1.0`, `1.x`,
`>=1.2.0 <2.0.0`); the resolved version is pinned to `.alp/registry.lock.json`
on install so repeatable installs are reproducible. The legacy `alp install`
command is a thin wrapper around the same client.

### Registry hardening (4.1.0): per-namespace tokens & publish-time auth

- **Per-namespace tokens.** `--registry-token` accepts either one global token
  or a comma-separated map of `namespace=token` pairs (e.g.
  `@demo=demo-secret`). A namespace with a configured token is *private*: its
  reads and downloads require `Authorization: Bearer <token>`, while
  unconfigured namespaces stay public. A global token protects the marketplace
  listing/search endpoint too.
- **Publish-time auth.** Publishing is a `PUT /api/registry/-/<ns>/<name>` that
  carries the manifest and file contents inline. It is always gated by the
  target namespace's token, so unauthenticated clients cannot inject packages
  into any namespace — closing the publish hole that existed in `4.0.0`.
- **Path safety.** Server-side publish rejects path traversal outside the
  version directory and rejects a manifest whose namespace differs from the
  URL namespace.

### Package signing (4.2.0): supply-chain trust

Tokens prove *who can publish*; signatures prove *what was published was not
tampered with* after the token holder signed it. Maintainer signing is
**optional and backward compatible** — unsigned packages install normally, and
a signed package is verified only when the consumer configures a trust root.

```bash
# 1. Maintainer generates an Ed25519 keypair (registry.key is chmod 600).
alp keys generate
alp keys fingerprint registry.pub   # -> alp1<short-hash>

# 2. Publish, signing with the private key (env or --sign-key).
ALP_REGISTRY_SIGN_KEY=registry.key alp publish ./my-plugin

# 3. Consumer pins the maintainer's fingerprint in their trust root and
#    installs with --key (or ALP_REGISTRY_TRUST_KEY). A bad or missing
#    signature is rejected; without a trust root, installs stay unsigned.
alp install @ns/my-plugin --key registry.pub
```

- `alp keys generate` writes `registry.key` (perms `600`) + `registry.pub` and
  prints the trust fingerprint.
- `alp keys fingerprint <file>` prints the fingerprint of any public key.
- `--sign-key <file>` (publish / `alp registry publish`) signs the version;
  `--key <file>` (install / `alp registry install`) requires + verifies a
  signature against that trusted public key.
- A hosted registry can also sign on the server with
  `alp serve --registry --registry-sign-key <file>`.
- The Python SDK exposes the same primitives (`alp_sdk.signing`) behind the
  optional `cryptography` dependency (`pip install alp-sdk[signing]`).

#### Persistent trust roots (4.3.0): `.alprc` `trustedKeys`

Passing `--key` on every install is tedious. Instead, pin a maintainer's
fingerprint (or public key) as a **trust root** in `.alprc`; `alp install`
then verifies signed packages automatically and rejects unsigned or
wrong-key packages for that namespace.

```bash
# Pin a maintainer fingerprint to a namespace (or '*' for global trust).
# Omit the leading '@' on the namespace — commander treats '@' as a file arg.
alp keys trust add demo alp1c0593b2f97ec8a92fa05e5bb
alp keys trust add '*' ./registry.pub        # trust every signed package

alp keys trust list                           # show configured roots

# Now installs are verified against the trust root with no --key needed.
alp install @demo/myplugin
```

`trustedKeys` maps a namespace (`@ns`) or `*` (global) to either an inline PEM
public key or a fingerprint (`alp1...`). A fingerprint is matched against the
signer key embedded in the package signature, so you never ship the public key
in cleartext. Unsigned installs stay allowed unless a trust root is configured
for that namespace (spec/14 §4.3).

### Registry configuration (`.alprc`)

Private and namespaced registries are configured with a `.alprc` (or
`.alprc.json`) file in the workspace root or your home directory. Namespace
routing sends each package to its mapped registry; `${ENV_VAR}` references in
auth tokens are expanded from the environment (spec/14 §4).

```json
{
  "registries": {
    "default": "https://registry.alp-protocol.org",
    "@internal": "https://alp-registry.internal.company.com"
  },
  "auth": {
    "https://alp-registry.internal.company.com": { "token": "${ALP_INTERNAL_TOKEN}" }
  }
}
```

All registry traffic MUST use HTTPS (loopback `http://127.0.0.1` is allowed for
local `alp serve --registry`); the client refuses plain HTTP for any other host.

| Subcommand | Description |
| :--- | :--- |
| `publish <dir>` | Add a package to the local store, or `--url <host>` to publish remotely (token-gated). `--sign-key <file>` signs the version (4.2.0) |
| `list` | List packages in the local store (or `--url` for a hosted registry) |
| `search <q>` | Substring search over name + description |
| `install <name>[@range]` | Download, verify integrity (and signature with `--key`), and pin to the lockfile |
| `serve` | Hint to start `alp serve --registry` |
| `verify <name>[@version]` | Audit a version's signature against the trust root, without installing. Works on the local store, or `--url <host>` to verify a remote package (4.5.0) |
| `keys <generate\|fingerprint\|trust>` | Manage package-signing Ed25519 keypairs & trust roots (4.2.0/4.3.0) |

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

## Event Sourcing (`alp replay`)

*New in `10.1.0`.* Inspect the immutable event log of workspace mutations.
Every status change, task claim, file mutation, and policy evaluation is
recorded at `.alp/.events/events.jsonl` with a schema-versioned payload so
you can replay history for incident forensics or audit.

```bash
alp replay
alp replay --type status_changed,object_created
alp replay --object-id task-login-ui
alp replay --from 2026-07-20T00:00:00Z --to 2026-07-20T23:59:59Z
```

Output:
```
📼 ALP Event Replay
===================
Total events:    42
Replayed:        12
Skipped:         30

[2026-07-20T09:00:00Z] status_changed(abc123-...) object_id=task-login-ui, old=[ ], new=[x]
```

| Flag | Description |
| :--- | :--- |
| `--from <iso>` | Only events at or after this ISO timestamp |
| `--to <iso>` | Only events at or before this ISO timestamp |
| `--type <csv>` | Comma-separated event types to include |
| `--object-id <id>` | Only events whose payload references this object id |

## Workflow Visualization (`alp visualize`)

*New in `15.2.0`.* Render `@workflow` objects as Mermaid, Graphviz DOT, or
JSON diagrams. Visualize a single workflow or all workflows in the workspace.

```bash
alp visualize
alp visualize wf-standard
alp visualize --format dot --out docs/wf.dot
alp visualize --format mermaid --out docs/wf.mmd
```

| Flag | Description |
| :--- | :--- |
| `[id]` | Optional workflow id (all workflows if omitted) |
| `--format <fmt>` | `mermaid` (default), `dot`, or `json` |
| `--out <file>` | Write to a file instead of stdout |

## Cost Optimization (`alp cost --workflow`) — *v16.0.0*

Analyze a workflow graph and get AI-driven cost optimization suggestions.
`alp cost` already shows per-task token usage and compute cost; the new
`--workflow` flag analyzes the full workflow for savings opportunities.

```bash
# Show cost for a single task (historical)
alp cost task-login-ui

# Optimize a workflow and show savings
alp cost --workflow wf-standard
```

Output:
```
🔍 Cost Optimization for Workflow: wf-standard
==========================================
  Current cost:      $0.036000
  Optimized cost:    $0.018000
  Savings:           $0.018000 (50.0%)
  Suggestions:
    - [parallelization] Parallelize 1 independent step groups (saves $0.006000, confidence 80%)
    - [caching] Cache results for 2 deterministic steps (saves $0.012000, confidence 60%)
```

| Flag | Description |
| :--- | :--- |
| `[task-id]` | Task ID to inspect (defaults to latest metered task) |
| `--workflow <id>` | *v16.0.0.* Optimize a workflow and show cost savings (parallelization, caching, agent reassignment) |

## Universal Protocol Bridge (`alp bridge`) — *v17.0.0*

Export ALP workflows to external protocol descriptions, or import them back.

```bash
# Export the first @workflow in .alp/workflows.alp to OpenAPI 3.0
alp bridge openapi

# Import an OpenAPI spec back to an ALP workflow
alp bridge openapi --import api-spec.json

# Export to GraphQL SDL
alp bridge graphql

# Export to gRPC proto
alp bridge grpc

# Export to AsyncAPI
alp bridge asyncapi
```

Supported formats: `openapi`, `graphql`, `grpc`, `asyncapi`.

| Argument | Description |
| :--- | :--- |
| `<format>` | Target format: `openapi`, `graphql`, `grpc`, or `asyncapi` |
| `[file]` | Import from a JSON spec file instead of exporting the local workflow |

## Self-Sovereign Identity (`alp identity`) — *v18.0.0*

*New in V14 — The Sovereign Era.* W3C DID-based agent identity without a
central authority. Each agent owns a verifiable identity; the trust registry
maps DIDs to permission scopes.

```bash
# Generate a new DID + keypair
alp identity create agent-1

# Register a DID in the trust registry with scopes
alp identity register did:alp:agent-1:abc123 --scopes read,write --trust-level standard

# Verify a presentation
alp identity verify presentation.json --public-key ./agent.pub

# List registered DIDs
alp identity list

# Revoke a DID
alp identity revoke did:alp:agent-1:abc123
```

| Subcommand | Description |
| :--- | :--- |
| `create <agent-id>` | Generate a DID + keypair for an agent |
| `register <did>` | Register a DID with scopes and trust level |
| `verify <file>` | Verify a verifiable presentation against the trust registry |
| `list` | List all registered DIDs |
| `revoke <did>` | Revoke a DID from the trust registry |

## Decentralized Coordination (`alp p2p`) — *v18.1.0*

*New in V14 — The Sovereign Era.* P2P swarm coordination without a central
coordinator. Agents discover each other via DHT, negotiate directly, and form
ad-hoc federations using gossip-based state sync.

```bash
# Join the swarm
alp p2p join --node n1 --agent agent-1 --capabilities build,test

# Leave the swarm
alp p2p leave --agent agent-1

# Gossip a message to peers
alp p2p gossip --topic task.assign --payload '{"task_id":"t1"}'

# Discover agents by capability
alp p2p discover build

# List all known peers
alp p2p peers
```

| Subcommand | Description |
| :--- | :--- |
| `join` | Register this node in the DHT and start gossiping |
| `leave` | Deregister from the DHT |
| `gossip` | Spread a message to fanout peers (best-effort rumor spreading) |
| `discover <capability>` | Find agents advertising a capability |
| `peers` | List all known peers and their capabilities |

## Cross-Domain Trust (`alp domain-trust`) — *v18.4.0*

*New in V14 — The Sovereign Era.* Establish bilateral trust between sovereign
ALP domains without a global CA. Each domain signs a trust root; links are
created, accepted, and revoked pairwise.

```bash
# Create a local domain trust root
alp domain-trust create-domain local <private-key>

# Link to a remote domain
alp domain-trust link local remote

# Accept an incoming link
alp domain-trust accept local <link-id>

# List all trust links
alp domain-trust list local

# Revoke a link
alp domain-trust revoke local <link-id>
```

| Subcommand | Description |
| :--- | :--- |
| `create-domain <domain-id> <private-key>` | Create a signed trust root for a domain |
| `link <local> <remote>` | Create a pending bilateral trust link |
| `accept <local> <link-id>` | Accept a pending link |
| `list [local]` | List all trust links for a domain |
| `revoke <local> <link-id>` | Revoke an active link |

## Multi-Tenant Isolation (`alp tenant`) — *v18.2.0*

*New in V14 — The Sovereign Era.* Cryptographic workspace boundaries: each
tenant's `.alp/` directory is sealed with a tenant-specific key, preventing
cross-tenant data leakage.

```bash
# Create a tenant
alp tenant create my-tenant

# List tenants
alp tenant list

# Manage secrets in a tenant vault
alp tenant vault my-tenant list
alp tenant vault my-tenant seal api-key "super-secret"
alp tenant vault my-tenant unseal api-key

# Delete a tenant
alp tenant delete my-tenant
```

| Subcommand | Description |
| :--- | :--- |
| `create <name>` | Create a new tenant with a generated keypair |
| `list` | List all registered tenants |
| `vault <id> list\|seal <secret> [value]\|unseal <secret>` | Manage tenant secrets |
| `delete <id>` | Delete a tenant |

## Autonomous Governance (`alp governance`) — *v18.3.0*

*New in V14 — The Sovereign Era.* Agents vote on policy changes through
cryptographic ballots. Quorum rules, signed votes, and tallied results ensure
transparent policy evolution.

```bash
# Open a new ballot
alp governance propose "Allow remote agents" policy-remote

# Cast a vote
alp governance vote <ballot-id> <voter-did> approve "Safe to proceed"

# Close and tally
alp governance close <ballot-id>

# List all ballots
alp governance list
```

| Subcommand | Description |
| :--- | :--- |
| `propose <description> [policy-id]` | Open a new ballot |
| `vote <ballot-id> <voter-did> <approve\|reject\|abstain> [rationale]` | Cast a signed vote |
| `close <ballot-id>` | Close ballot and tally results |
| `list` | List all ballots |

## Self-Healing Workflows (`alp healing`) — *v16.1.0*

*New in V12 — The Sentinel Era.* Inspect workflow healing history and recovery
reports. The `HealingEngine` automatically retries, skips, rolls back, or
escalates failed tasks based on configurable strategies.

```bash
# Show healing actions for a workflow
alp healing history wf-standard

# Show healing summary report
alp healing report wf-standard
```

| Subcommand | Description |
| :--- | :--- |
| `history [workflow-id]` | List past healing actions |
| `report [workflow-id]` | Show healing summary report |

## Swarm Resilience (`alp resilience`) — *v16.3.0*

*New in V12 — The Sentinel Era.* Monitor swarm resilience: active agents,
node replacements, and task redistributions. Standby agents are promoted
automatically when active agents fail heartbeat checks.

```bash
# List active agents
alp resilience agents default

# Show resilience report
alp resilience report default
```

| Subcommand | Description |
| :--- | :--- |
| `agents [swarm-id]` | List active agents and their capabilities |
| `report [swarm-id]` | Show resilience report with replacements and redistributions |

## Project Initialization (`alp init`)

Scaffold a new ALP workspace in the current directory. Creates the `.alp/`
directory with starter `project.alp`, `agents.alp`, and `workflows.alp` files.

```bash
# Initialize a new ALP workspace
alp init

# Initialize with a specific project name
alp init --name my-project
```

| Flag | Description |
| :--- | :--- |
| `--name <n>` | Set the project ID in the generated `project.alp` |

## Schema Validation (`alp validate`)

Validate all `.alp` files in the workspace against the JSON Schema definitions.
Reports syntax errors, unknown object types, and invalid field values.

```bash
# Validate the current workspace
alp validate

# Validate a specific directory
alp validate ./path/to/.alp
```

| Flag | Description |
| :--- | :--- |
| `--strict` | Treat warnings as errors |
| `--quiet` | Suppress per-file output, only show summary |

## Dependency Graph (`alp graph`)

Print the dependency graph as a topologically sorted execution order. Useful
for understanding task sequencing and detecting cycles.

```bash
# Print the sorted execution order
alp graph

# Output as JSON
alp graph --json
```

| Flag | Description |
| :--- | :--- |
| `--json` | Output the graph as a JSON array |

## Debug Inspector (`alp debug`)

Deep-inspect a single ALP object by ID. Shows the fully resolved object with
all inherited rules, computed dependencies, and effective policies.

```bash
# Inspect a specific object
alp debug task-auth

# Show the raw parsed AST
alp debug task-auth --ast
```

| Flag | Description |
| :--- | :--- |
| `--ast` | Show the raw abstract syntax tree |

## Project Status (`alp status`)

Display an overview of the project's current state — task counts grouped by
status marker (`[x]`, `[~]`, `[ ]`, `[!]`, `[?]`), active agents, and
project progress.

```bash
# Show project status
alp status

# Output as JSON
alp status --json
```

| Flag | Description |
| :--- | :--- |
| `--json` | Output status as JSON |

## Checkpoint & HITL (`alp checkpoint`)

Submit a task for human-in-the-loop review. Sets the task status to `[?]`
with a review message and optionally notifies via webhook.

```bash
# Submit for review
alp checkpoint task-login-ui --ask-human "Please review the login flow"

# Approve a checkpointed task
alp checkpoint task-login-ui --approve

# Reject with feedback
alp checkpoint task-login-ui --reject "Needs accessibility audit"
```

| Flag | Description |
| :--- | :--- |
| `--ask-human <msg>` | Submit task for human review with a message |
| `--approve` | Approve a checkpointed task (sets `[~]`) |
| `--reject <msg>` | Reject with feedback (sets `[!]`) |

## Key Management (`alp keys`)

Generate, inspect, and manage Ed25519 keypairs used for package signing,
registry trust roots, and identity verification.

```bash
# Generate a new keypair
alp keys generate

# Show fingerprint of a public key
alp keys fingerprint registry.pub

# Manage trust roots
alp keys trust add demo alp1c0593b2f97ec8a92fa05e5bb
alp keys trust list
alp keys trust remove demo
```

| Subcommand | Description |
| :--- | :--- |
| `generate` | Generate a new Ed25519 keypair (`registry.key` + `registry.pub`) |
| `fingerprint <file>` | Print the fingerprint of a public key file |
| `trust add <ns> <fp>` | Pin a fingerprint to a namespace in the trust root |
| `trust list` | List all configured trust roots |
| `trust remove <ns>` | Remove a namespace from the trust root |

## Plugin Management (`alp plugin`)

Install, list, and manage ALP plugins that extend the protocol with custom
object types and validation rules.

```bash
# List installed plugins
alp plugin list

# Install a plugin from the registry
alp plugin install @alp/plugin-jira

# Remove a plugin
alp plugin remove @alp/plugin-jira

# Show plugin details
alp plugin info @alp/plugin-jira
```

| Subcommand | Description |
| :--- | :--- |
| `list` | List installed plugins |
| `install <pkg>` | Install a plugin package |
| `remove <pkg>` | Remove an installed plugin |
| `info <pkg>` | Show plugin metadata and registered types |

## Test Harness (`alp test-harness`)

Run the ALP compliance test harness against your workspace. Validates that
your `.alp` files conform to the specification and all cross-references resolve.

```bash
# Run the full compliance suite
alp test-harness

# Run a specific test category
alp test-harness --category schema

# Output results as JSON
alp test-harness --json
```

| Flag | Description |
| :--- | :--- |
| `--category <c>` | Run only a specific test category (`schema`, `graph`, `policy`) |
| `--json` | Output test results as JSON |

## Data Import (`alp import`)

Import external data into the ALP workspace. Supports JSON, YAML, and CSV
formats for bulk-loading tasks, features, and decisions.

```bash
# Import tasks from a JSON file
alp import tasks.json

# Import from YAML with type override
alp import features.yaml --type feature

# Import from a URL
alp import https://example.com/backlog.json
```

| Flag | Description |
| :--- | :--- |
| `--type <t>` | Override the detected object type |
| `--merge` | Merge with existing objects instead of replacing |

## Package Removal (`alp uninstall`)

Remove a previously installed ALP package from the local registry store.

```bash
# Uninstall a package
alp uninstall @scope/my-package
```

| Flag | Description |
| :--- | :--- |
| `--force` | Remove even if other packages depend on it |

## Swarm Marketplace (`alp marketplace`)

*New in v36.0.0.* Autonomous swarm marketplace and skill registry for agent skills.

```bash
# Register an agent skill listing
alp marketplace register s1 agent-coder code-review --category analysis --cost 0.05

# Invoke a marketplace skill
alp marketplace invoke s1 agent-reader "Review this pull request"
```

## Event Mesh (`alp event-mesh`)

*New in v35.0.0.* Pub/sub event mesh topic routing and message dispatch for decoupled swarms.

```bash
# Subscribe an agent to a topic
alp event-mesh subscribe agent-1 telemetry.logs

# Publish an event payload
alp event-mesh publish telemetry.logs '{"level":"info","msg":"heartbeat"}'
```

## Code Transform (`alp code-transform`)

*New in v34.0.0.* AST refactoring and automated code transformation rules.

```bash
# Register a transform rule
alp code-transform register rule-1 "var-to-const" "Replace var with const"

# Apply transforms to source code
alp code-transform apply rule-1 "var x = 10;"
```

## Consensus Vote (`alp consensus-vote`)

*New in v33.0.0.* Multi-agent proposal creation, voting, and tallying.

```bash
# Propose a ballot
alp consensus-vote propose prop-1 "Deploy v2 to prod" 3

# Cast votes and tally
alp consensus-vote vote prop-1 agent-1 approve
alp consensus-vote tally prop-1
```

## Prompt Optimizer (`alp prompt-optimizer`)

*New in v32.0.0.* Automated prompt compression, instruction tuning, and token optimization.

```bash
# Optimize a prompt string
alp prompt-optimizer optimize "Please analyze this code carefully and thoroughly"
```

## Eval Suite (`alp eval-suite`)

*New in v31.0.0.* Automated LLM output evaluation and regression testing.

```bash
# Register an evaluation test case
alp eval-suite register eval-1 "Write a sort function" "def sort"

# Run evaluation suite
alp eval-suite run eval-1 "def sort(arr): return sorted(arr)"
```

## Code Index (`alp code-index`)

*New in v30.0.0.* AST symbol indexing, function mapping, and dependency search.

```bash
# Index a source file
alp code-index index src/auth.ts "export function authenticate() {}"

# Search indexed symbols
alp code-index search authenticate
```

## Edge Model (`alp edge-model`)

*New in v29.0.0.* Local/edge LLM routing and lightweight model execution management.

```bash
# Register an edge model route
alp edge-model register edge-1 llama-3-8b 0.001 8192

# Query best model route
alp edge-model route 4000
```


