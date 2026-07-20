---
title: Releases
description: ALP release history — specification and toolchain versions
---

# Releases

ALP versioning tracks two independent axes:

- **Specification** (`spec/01-overview`) — the protocol grammar. Locked at **2.0.0 (Stable)**; strict semantic-versioning guarantees apply to implementations.
- **Toolchain** (`@alp/cli`, `@alp/sdk`, docs-site, integrations) — the implementation and packaging, released on its own cadence.

## Toolchain

### 10.0.0 — Locked Grammar 3.0.0 (V6 — The Governance Era)
- Formal grammar bumped to **3.0.0**: removed `@type_definition` (deprecated in v8, removed in v9) and added V5 governance objects (`@policy`, `@timeline`, `@contract`, `@vault`) as first-class block types. Promoted `@type` to explicit block status. `repo`, `swarm`, and `package` are now explicit. All parser/SDK version-negotiation references updated from `2.x` to `3.x`.
- Migration guide: `docs-site/MIGRATION-v10.md`.

### 9.0.0 — v9 Breaking Changes
- Removed deprecated `@type_definition` alias — `@type` is now the sole custom-type declaration (spec/11 §2.5).
- `[!]` (blocked) and `[?]` (human gate) status markers MUST carry a free-text reason; unannotated markers are a hard `SyntaxError` (promoted from v8 deprecation warning, spec/03 §4).

### 8.4.0 — Encrypted Secrets Vault (V5)
- `@vault` (spec/19, spec/03 §31): secrets sealed at rest with an age-style X25519 envelope + AES-256-GCM, recipient-scoped so only the matching private key unseals. `recipients` double as the registry trust root (spec/14 §4.2).
- New `Vault` engine in `parser/src/vault.ts` (Node built-in `crypto`) and `sdk/python/alp_sdk/vault.py` (optional `cryptography` dep, zero-dep fallback). `set` / `get` / `list` / `rotate` / `audit` APIs; `parser/tests/vault.test.ts` (8 cases) + `sdk/python/tests/test_vault.py` (8 cases, skip without `cryptography`).
- Fixed pre-existing missing `signing` imports in `registry.py` (2 registry test errors). Full Python suite: 179 pass.

### 8.3.0 — Contracts: Runtime Boundary Validation (V5)
- `@contract` (spec/18, spec/03 §29): least-privilege boundaries between two entities (agents/tasks/repos) with `requires` pre-conditions, `allows` / `denies` lists (glob `.*` deny patterns), and `on_violation` modes (`deny`/`warn`/`log`).
- `ContractEngine.check(contractId, context)` enforces boundaries at handoff points (task transfer, repo write, MCP tool call). New `parser/src/contract.ts` + `sdk/python/alp_sdk/contract.py`; `parser/tests/contract.test.ts` (9) + `sdk/python/tests/test_contracts.py` (9). Full Python suite: 171 pass.

### 8.2.0 — Scheduling Engine (V5)
- `@timeline` (spec/17, spec/03 §27): native scheduling without an external cron daemon. Standard 5-field `cron` expressions and one-shot ISO 8601 `at` triggers, evaluated by `TimelineEngine.evaluate(now)`.
- New `parser/src/schedule.ts` + `sdk/python/alp_sdk/schedule.py`; `parser/tests/schedule.test.ts` (6) + `sdk/python/tests/test_schedule.py` (6). CLI `alp schedule` (list / next / enable / disable / `--at`). Full Python suite: 162 pass.

### 8.1.0 — Policy v2 (V5)
- `@policy` gains three extensions: `allow_during` time-windows (actions outside every declared UTC window are denied — time-scoped least-privilege), `require_approval` (matching actions escalate to human-in-the-loop instead of auto-blocking), and `proposal` blocks (signed, auditable action proposals verified against a trust root with MCP-enforcement audit trail).
- `evaluate_proposal` / `evaluateProposal` APIs; `tests/test_policy_v2.py` (6) + `parser/tests/policy.test.ts` v8.1.0 block (3). CLI `alp policy` gains `--proposal <id>` + `--trust <pem>`. Full Python suite: 156 pass.

### 8.0.0 — Production-Grade Era (V5), three breaking changes
1. **`@type` is canonical** — the plugin model collapsed to a single `@type` declaration (spec/11 §2.5); `@type_definition` retained as a *deprecated alias* for one major, removed in v9.
2. **`!assert` is fail-closed** (spec/16 §4) — a false *or* unparseable `!assert` raises `DirectiveError`, and **unknown directives** raise a hard `SyntaxError` instead of being silently ignored.
3. **`[!]` / `[?]` must carry a reason** (spec/03 §4) — unannotated markers emit a deprecation warning in v8 and become a hard error in v9.
- Migration guide: `docs-site/MIGRATION-v8.md`. All sub-packages bumped to `8.0.0`.

### 7.2.0 — Policy Federation & Engine Parity
- `policy_federation` layering multi-source governance over the atomic `PolicyEngine`: `PolicyFederation` aggregates `PolicySource`s (local, every member project, hosted-registry namespaces) into one effective decision where `deny_*` / strict from ANY source wins. Adds `FederatedDecision` + `audit_trail`. `tests/test_policy_federation.py` (12). Full Python suite: 150 pass.

### 7.1.0 — Observability Parity
- Python `observ.py` mirroring TS runtime primitives — `RuntimeLog` (append-only JSONL at `.alp/.runtime/log.jsonl`), best-effort / never-raises.

### 7.0.0 — Unified Execution Engine
- Python `engine.py` implementing all four spec/05 engines — `LoopEngine` (7 stages, checkpoint-per-iteration, event emitter), `WorkflowEngine` (retry strategies), `ContextEngine`, `VerificationEngine`.

### 6.5.0 — Plugin System (local + remote)
- Local plugin loading: file-level `!import "plugins/x.alp"` is resolved relative to the `.alp/` workspace root (spec/11 §3.1), with circular-import detection and path-traversal guards.
- `@plugin` + `@type_definition` blocks register custom object types; custom block markers (e.g. `@epic`) parse and validate against their declared `properties` (required-field + unknown-property warnings, §4.1).
- Remote HTTPS imports (§3.2–3.4): HTTPS-only, `.alp` extension check, 1 MB size cap, 30 s timeout, on-disk cache under `.alp/.cache/remote/<sha256>/` (24 h TTL, stale-on-error), and `!integrity: sha256:…` verification.
- Registry alias imports `@ns/name@version` (§3.5) resolve to a registry URL and reuse the same fetch/cache/integrity path.
- `PluginResolver` + `RemoteFetcher` added to both `@alp/parser` and the Python `alp_sdk`, covered by `parser/tests/{plugin,remote}.test.ts` and `sdk/python/tests/test_plugin.py`.

### 6.4.0 — Python Engine Parity
- Python `alp_sdk` gains three engines mirroring `@alp/parser` for full cross-SDK parity:
  - `AlpGraph` — DAG build, `-> ref` edge resolution, cycle detection, topological sort, impact/blocker queries.
  - `MemoryStore` — persistent scoped key-value memory backed by `.alp/.memory.json`.
  - `PolicyEngine` — evaluates path/command actions against declarative `@policy` objects (deny beats allow, `enforcement: warn` reports only).
- All three are exported from the `alp_sdk` top-level package and covered by `tests/test_engines.py`.

### 6.0.1 — 2026-07-18
- **Docs:** Homepage "How it works" example now uses canonical, indentation-based `.alp` syntax (no braces), matching the real `.alp/` example files.

### 6.0.0 — Integrations & CI hardening
- First-class agent-integration drop-ins: Cursor (`.cursorrules`), Claude Code / Cline (`instructions.md`), and GitHub Actions templates.
- Active CI workflow: TypeScript build + tests, Python SDK tests, and example-workspace validation.
- Documentation site restyle and expanded guides.

### 5.0.0 — SDK hardening & cross-SDK parity
- Official TypeScript and Python SDKs brought to parity.
- Registry signature verification available programmatically in both SDKs.

### 4.5.0 — Remote package verification & shared verifier
- Shared verification helper operating on a version's `PackageVersionInfo` + trust roots.
- Python `RegistryClient.verify_remote` parity with the TS CLI.

### 4.4.0 — Server-side signature enforcement
- Hosted registry enforces signatures on publish and verifies on install.

### 4.3.0 — Persistent signature trust roots
- `.alprc` `trustedKeys` for pinning maintainer keys.

### 4.2.0 — Registry package signing & supply-chain trust
- Signed registry packages and verification path.

### 4.1.0 — Per-namespace tokens + publish-time auth
- Registry hardening: per-namespace tokens, publish-time authentication.

### 4.0.0 — Cross-machine & cross-repository coordination
- Networked swarms, cross-repo `@repo` orchestration, and policy governance.

### 3.0.0 — Compliance suite
- Recursive SDK loader, CI hardening, and V2 docs.

## Specification

| Version | Status | Date |
|---|---|---|
| 2.0.0 | Stable (Final Release Candidate) | 2025-07-14 |
| 1.x | Superseded | — |

The formal grammar is locked at 2.0.0; production implementations MUST honor its strict semantic-versioning guarantees.
