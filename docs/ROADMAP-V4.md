# Roadmap V4 (The Federation Era)

With V3 complete (`3.1.0`), ALP can orchestrate a **local swarm** of autonomous
agents, observe them live via `alp serve`, and let the swarm propose its own
improvements via `alp evolve`.

Version 4 scales ALP from a **single machine / single repository** to a
**federated network of repositories and agents**. The unit of coordination
grows from one `.alp/` folder to many, working together under shared policy.

---

## Pillar 1: Remote & Networked Swarms ✅ (landed on main, toward 4.0.0)
**Target:** Run the swarm across more than one machine.
- **`@swarm` object:** Declares a networked swarm (coordinator URL, token, node id,
  heartbeat, peers). Validated by the same JSON-schema machinery as other objects.
- **`alp serve` coordinator:** The State Server gains `/api/swarm/*` endpoints
  (join, heartbeat, claim, release, roster). Dead nodes are reaped by timeout so
  their claims are freed — a server-brokered lock across machines.
- **`alp swarm` command:** `join` (register + heartbeat loop), `leave`, and
  `roster` (list live nodes and their current claims).
- **`alp run --swarm <id>`:** Runs the ordinary execution loop but negotiates
  task claims through the coordinator instead of the local `LockManager`, so
  multiple machines/CI runners work the same DAG without double-claiming.

## Pillar 2: Cross-Repository Orchestration ✅ (landed on main, toward 4.0.0)
**Target:** One DAG spanning many repos.
- **`@repo` object:** Declares an external repository (local `path`, Git `url`,
  pinned to `commit`/`branch`). Validated by the JSON-schema machinery.
- **`ExternalResolver`:** Discovers `@repo` declarations, fetches Git repos into
  `.alp/.cache/repos/<id>/`, merges each repo's `.alp` graph, and resolves
  `-> repo::object` references. Cross-repo refs are read-only.
- **`alp repo`:** `ls`, `fetch`, `resolve [--fetch]`, and `graph` to inspect the
  federation and surface dangling references.
- **Federated context bundles:** `alp run` pulls decisions/rules/memory from
  linked repositories, not just the local `.alp/`.
- **Atomic cross-repo checkpoints:** A feature that touches 3 repos is only
  marked `[x]` when all 3 verify.

## Pillar 3: Hosted Registry & Marketplace
**Target:** Graduate `alp install`/`alp publish` from a stub to a real service.
- **Signed packages:** Integrity + provenance for community templates
  (`@community/scrum-master`, role packs, workflow packs).
- **Versioned resolution:** Semver ranges and lockfiles for installed packages.
- **Discovery:** `alp search` against the hosted index.

## Pillar 4: Policy & Permission Governance ✅ (landed on main, toward 4.0.0)
**Target:** Make autonomous agents safe to run unattended.
- **`@policy` object:** ✅ Declarative guardrails — `allow_paths`/`deny_paths`
  (globs), `allow_commands`/`deny_commands` (prefixes), `budgets`, `enforcement`
  (`strict`/`warn`), and `applies_to` agent scoping. Schema-validated in both
  the TS and Python SDKs.
- **Policy Engine + `alp policy`:** ✅ Evaluate a proposed path/command/agent
  action; `deny` beats `allow`; exits non-zero on strict blocks (CI-friendly).
- **Enforcement in `alp verify`:** ✅ Verify commands that violate a strict
  policy are blocked and never executed.
- **Capability scoping (MCP):** ✅ The MCP server enforces policy on mutating
  tools (`alp_update_status`, `alp_delegate`, `alp_decompose`); denied path
  writes are rejected. Protocol-coordination files under `.alp/` are governed
  by deny rules only, so allow-lists like `src/**` don't block task creation.
- **Audit trail:** ✅ Every MCP mutation is appended to
  `.alp/.runtime/log.jsonl` (`source: mcp-server`), visible live in `alp serve`.

## Pillar 5: Persistent State Store
**Target:** Durable, queryable history beyond the JSONL tail.
- **Durable state store:** Optional `alp serve --db` ingests the runtime event
  log into a dependency-free JSON snapshot (`.alp/.runtime/state.db.json`) for
  fast queries, metrics, and clusters that outlive a single process.
- **Analytics endpoints:** `/api/analytics` returns cycle time per task, agent
  utilization, failure hotspots, and event throughput — feeding `alp evolve`
  with richer telemetry. The same computation runs against a raw JSONL tail via
  the `computeAnalytics()` pure function (TS + Python SDK).

---

## Estimated Timeline (V4)

| Phase | Goal | Status |
|---|---|---|
| Pillar 4 | Policy & Permission Governance | ✅ Complete (toward 4.0.0) |
| Pillar 5 | Persistent State Store | ✅ Complete (toward 4.0.0) |
| Pillar 1 | Remote & Networked Swarms | ✅ Complete (toward 4.0.0) |
| Pillar 2 | Cross-Repository Orchestration | ✅ Complete (toward 4.0.0) |
| Pillar 3 | Hosted Registry & Marketplace | 🔜 Next |

> V4 is a **major** version: `@policy` and cross-repo references may introduce
> breaking changes to the workspace schema, gated behind the deprecation policy
> in [spec/10-versioning.md](../spec/10-versioning.md).
