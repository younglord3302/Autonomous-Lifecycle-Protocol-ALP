# Roadmap V4 (The Federation Era)

With V3 complete (`3.1.0`), ALP can orchestrate a **local swarm** of autonomous
agents, observe them live via `alp serve`, and let the swarm propose its own
improvements via `alp evolve`.

Version 4 scales ALP from a **single machine / single repository** to a
**federated network of repositories and agents**. The unit of coordination
grows from one `.alp/` folder to many, working together under shared policy.

---

## Pillar 1: Remote & Networked Swarms
**Target:** Run the swarm across more than one machine.
- **`alp serve --cluster`:** Promote the State Server from a read-only dashboard
  into a coordination hub that remote workers connect to over WebSocket.
- **Distributed `LockManager`:** Replace file-based locks with a server-brokered
  lock so agents on different machines never claim the same task.
- **Worker registration:** `alp run --connect <url>` joins an existing cluster
  instead of spawning a local-only swarm.

## Pillar 2: Cross-Repository Orchestration
**Target:** One DAG spanning many repos.
- **Workspace federation:** Extend `@workspace` cross-project references
  (`-> ws::proj::obj`) so a task in repo A can depend on a task in repo B.
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
- **SQLite/embedded store:** Optional `alp serve --db` backing the event log for
  fast queries, metrics, and long-running clusters.
- **Analytics endpoints:** Cycle time per task, agent utilization, failure
  hotspots — feeding `alp evolve` with richer telemetry.

---

## Estimated Timeline (V4)

| Phase | Goal | Status |
|---|---|---|
| Pillar 4 | Policy & Permission Governance | ✅ Complete (toward 4.0.0) |
| Pillar 1 | Remote & Networked Swarms | 🔜 Next |
| Pillar 2 | Cross-Repository Orchestration | 🔜 |
| Pillar 3 | Hosted Registry & Marketplace | 🔜 |
| Pillar 5 | Persistent State Store | 🔜 |

> V4 is a **major** version: `@policy` and cross-repo references may introduce
> breaking changes to the workspace schema, gated behind the deprecation policy
> in [spec/10-versioning.md](../spec/10-versioning.md).
