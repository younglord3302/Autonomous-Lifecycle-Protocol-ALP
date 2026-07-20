# CLI Verification & Tools

The `@alp/cli` is more than a validator; it's a complete ecosystem manager. Here is the full suite of CLI tools available in `10.0.0` (The Production-Grade Era, V5/V6). New in v8: `alp schedule`, `alp vault`, and `alp policy --proposal` / `--trust`.

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
