# ALP Specification — Versioning

**Version:** 3.0.0
**Status:** Stable

---

## 1. Format Version

Every `.alp` file SHOULD declare the ALP specification version it conforms to:

```
!alp-version: 0.1.0
```

If omitted, parsers SHOULD assume the latest version they support.

---

## 2. Version Numbering

ALP follows Semantic Versioning (semver):

```
MAJOR.MINOR.PATCH
```

| Component | Meaning | Example |
|---|---|---|
| **MAJOR** | Breaking changes to syntax or semantics | `1.0.0` → `2.0.0` |
| **MINOR** | New features, backward-compatible | `0.1.0` → `0.2.0` |
| **PATCH** | Bug fixes, clarifications | `0.1.0` → `0.1.1` |

---

## 3. Semantic Versioning Guarantees (2.x+)

Starting with `v3.0.0`, ALP adheres strictly to Semantic Versioning (`MAJOR.MINOR.PATCH`). This provides strong guarantees to parser implementers and agent developers:

1. **PATCH (`3.0.x`)**: Bug fixes, typo corrections in documentation, and clarifications that do not change protocol behavior.
2. **MINOR (`3.x.0`)**: New backwards-compatible features (e.g., adding a new optional field to a core object).
3. **MAJOR (`4.0.0`)**: Breaking changes to the grammar or core object schemas.

### 3.1 Backward Compatibility

Within the same MAJOR version (3.x):
- New object types MAY be added (parsers SHOULD ignore unknown types gracefully)
- New properties MAY be added to existing objects (with defaults)
- Existing properties MUST NOT be removed or renamed
- Existing syntax MUST NOT change meaning

### 3.2 Forward Compatibility

Parsers SHOULD handle unknown elements gracefully:
- Unknown block types (`@unknown`) → Warning, skip the block
- Unknown properties → Warning, ignore the property
- Unknown directives → Warning, ignore the directive
- Unknown enum values → Error (enum values are strict)

### 3.3 Breaking Changes (MAJOR version)

A MAJOR version increment indicates:
- Removed syntax elements
- Changed semantics of existing elements
- Renamed properties or types
- Changed parsing rules

Migration guides MUST be provided for MAJOR version changes.

---

## 4. Version Negotiation

When a parser encounters a file with a higher version than it supports:

| Scenario | Behavior |
|---|---|
| Same MAJOR, higher MINOR | Parse with warnings for unknown elements |
| Same MAJOR, higher PATCH | Parse normally |
| Higher MAJOR | Error: "This file requires ALP v3.x, but this parser supports v2.x" |
| No version declared | Parse with latest supported version |

---

## 5. Object Versioning

Individual protocol objects can have their own version:

```
@feature
  id: feat-auth
  version: 2.0.0    // This feature spec has been revised twice
```

Object versions are for tracking changes to the object's definition, NOT the ALP format version. They follow the same semver convention.

---

## 6. Deprecation Policy

To guarantee that agent parsers do not break unexpectedly, ALP enforces a strict major-version deprecation policy:
- A feature or field MAY be marked as deprecated in any `MINOR` release (e.g., `3.1.0`).
- A deprecated feature MUST remain fully valid and supported by parsers for the remainder of that major version lifecycle.
- A deprecated feature MAY only be fully removed in the next `MAJOR` release (e.g., `4.0.0`).

When a feature is deprecated in a new version, use the `!deprecated` directive:

```alp
@task
  id: task-old-login
  !deprecated: "Replaced by task-new-login in v3.1.0"
```

Deprecated elements:
- MUST still be parseable for the remainder of the MAJOR version
- SHOULD produce a warning when parsed
- MUST include a migration note via the `!deprecated` directive

---

## 7. Version History

| Version | Date | Changes |
||---|---|
| `14.2.0` | 2026-07-21 | Compliance Certification (V10 — The Verifiable Era). `ComplianceCertifier` produces an attestation bundle (VC-signed) summarizing that a run satisfied a named compliance profile; `alp certify <run-id> --profile <p>` emits a portable certificate. Builds on 6.9.0 compliance harness. New `ComplianceCertifier` class in `parser/src/formal.ts` and `sdk/python/alp_sdk/formal.py`; tests in `parser/tests/provenance.test.ts` and `sdk/python/tests/test_provenance.py`. |
| `14.1.0` | 2026-07-21 | Zero-Knowledge Policy Proofs (V10 — The Verifiable Era). Extends 10.9.0 formal verification with `ZKPolicyProof`: an agent can prove a policy held for an action without revealing the underlying data, verified against the federation trust root. New `ZKPolicyProof` class in `parser/src/formal.ts` and `sdk/python/alp_sdk/formal.py`; tests in `parser/tests/formal.test.ts` and `sdk/python/tests/test_provenance.py`. |
| `15.2.0` | 2026-07-21 | Live Upgrade & Migration (V11 — The Ambient Era). `MigrationEngine` performs cross-major-version in-place migration using `UpgradeManifest` with pluggable strategies (`blue_green`, `rolling`, `canary`, `big_bang`); dry-run validation, automatic rollback on failure, version locks, and checkpoint persistence to `.alp/migrations/`. New `parser/src/migration.ts` and `sdk/python/alp_sdk/migration.py`; tests in `parser/tests/migration.test.ts` and `sdk/python/tests/test_migration.py`. |
| `15.1.0` | 2026-07-21 | Edge-Native Runtime (V11 — The Ambient Era). Consolidates CRDT edge nodes into a first-class `EdgeRuntime`: offline-first execution, resync on reconnect, locality-aware task placement. New `parser/src/crdt.ts` and `sdk/python/alp_sdk/crdt.py` with `LWWRegister`, `ORSet`, and `EdgeRuntime`; tests in `parser/tests/crdt.test.ts` and `sdk/python/tests/test_crdt.py`. |
| `15.0.0` | 2026-07-21 | Fully Autonomous Swarms (V11 — The Ambient Era). Introduces `AutonomyController` running long-lived swarms with safe self-modifying workflows, `WorkflowMutator` proposing/approving/rolling back edits behind policy gates, and `AdaptiveEngine` re-tuning execution from environment signals. New `parser/src/autonomy.ts` and `sdk/python/alp_sdk/autonomy.py`; tests in `parser/tests/autonomy.test.ts` and `sdk/python/tests/test_autonomy.py`. **Breaking**: autonomy APIs are new surface. Migration guide: `docs-site/MIGRATION-v15.md`. |
| `14.0.0` | 2026-07-21 | End-to-End Provenance (V10 — The Verifiable Era). Introduces `TraceSigner` (seals EventStore entries with X25519 envelope reusing vault), `ProvenanceStore` (queryable hash-linked lineage), `AuditLedger` (tamper-evident append-only log), and `VerifiableCredential` (W3C VC for agents). New `parser/src/provenance.ts` and `sdk/python/alp_sdk/provenance.py`; tests in `parser/tests/provenance.test.ts` and `sdk/python/tests/test_provenance.py`. **Breaking**: provenance APIs are new surface. Migration guide: `docs-site/MIGRATION-v14.md`. |
| `13.0.0` | 2026-07-21 | Multi-Agent Negotiation (V9 — The Collaborative Era). Introduces `Negotiator` for bilateral capability/cost negotiation producing `ContractDraft` instances, `ReputationStore` tracking per-agent trust scores from fulfilled/breached contracts, and `TeamComposer` assembling composable agent teams from capability queries. New `parser/src/negotiate.ts` and `sdk/python/alp_sdk/negotiate.py`; tests in `parser/tests/negotiate.test.ts` and `sdk/python/tests/test_negotiate.py`. **Breaking**: new negotiation surface. Migration guide: `docs-site/MIGRATION-v13.md`. |
| `12.0.0` | 2026-07-21 | AI-native Planning & Reasoning (V8 — The Cognitive Era). Introduces `GoalDecomposer` (turns objectives into DAGs of `@task`/`@workflow` objects), `Planner` (scores/ranks plans using `PredictiveEstimator` baselines), and `Reflector` (post-run self-critique emitting `@lesson` objects). New `parser/src/planner.ts` and `sdk/python/alp_sdk/planner.py`; tests in `parser/tests/planner.test.ts` and `sdk/python/tests/test_planner.py`. **Breaking**: plan/reflect APIs are new surface. Migration guide: `docs-site/MIGRATION-v12.md`. |
| `12.1.0` | 2026-07-21 | Memory-Augmented Reasoning (V8). Retrieval-augmented inference over the workspace knowledge graph: `MemoryReasoning` answers "why / what-if" queries against `MemoryStore` + event history, with citation spans back to source `@task`/`@artifact`. Extends `parser/src/planner.ts` reasoning hooks; tests in `parser/tests/planner.test.ts` and `sdk/python/tests/test_planner.py` (~12 cases each). |
| `12.2.0` | 2026-07-21 | Uncertainty & Confidence (V8). Confidence scoring for agent decisions: `ConfidenceEstimator` attaches calibrated probability to every `PolicyDecision` and plan step; low-confidence steps auto-route to `alp evolve --ai` or a human gate. Implemented in `parser/src/policy.ts` and `sdk/python/alp_sdk/policy.py`; CLI `alp confidence <task-id>`. |
| `10.3.0` | 2026-07-20 | ALPEL Standard Library v2 (V6 — The Intelligence Era). Extends the ALP Expression Language (`parser/src/alpel.ts`, `sdk/python/alp_sdk/alpel.py`) with four safe utility namespaces — `date` (`now`, `formatDate`, `parseDate`, `addDays`), `math` (`round`, `floor`, `ceil`, `min`, `max`, `abs`), `crypto` (`sha256`, `base64`, `base64Decode`), and `string` (`trim`, `replace`, `split`, `join`, `startsWith`, `endsWith`) — plus a lightweight module-import system (`registerModule` / `import()`) for sharing reusable constants and snippets across expressions. Documented in spec/12 §5.3–5.4; `parser/tests/alpel.test.ts` and `sdk/python/tests/test_alpel.py` cover every function and module lookup. Non-breaking: purely additive expression surface. |
| `10.2.0` | 2026-07-20 | Workflow Visualization (V6 — The Intelligence Era). Introduces `WorkflowVisualizer` in `parser/src/visualize.ts` and `sdk/python/alp_sdk/visualize.py` (parity): parse `@workflow` objects and render them as Mermaid `flowchart`, Graphviz `dot`, or structured JSON. New `alp visualize [id]` CLI (`--format mermaid|dot|json`, `--out <file>`) produces diagrams for any workflow, with subgraphs per workflow, parallel-group nodes, `wait_for` edges, and a completion node. Full Python suite parity. |
| `10.1.0` | 2026-07-20 | Event Sourcing & Deterministic Replay (V6 — The Intelligence Era). Introduces an immutable, schema-versioned event log (`EventStore` in `parser/src/event-store.ts` and `sdk/python/alp_sdk/event_store.py`) recording every workspace mutation at `.alp/.events/events.jsonl`. New `alp replay` CLI (`--from`, `--to`, `--type`, `--object-id`) re-emits the recorded history for inspection and incident forensics. Non-breaking: event logging is opt-in and integrates with the existing runtime log. |
| `10.0.0` | 2026-07-20 | Locked Grammar 3.0.0 (V6 — The Governance Era). The formal grammar is bumped to 3.0.0: removed `@type_definition` (deprecated in v8, removed in v9) and added V5 governance objects (`@policy`, `@timeline`, `@contract`, `@vault`) as first-class block types. Also promoted `@type` to explicit block status (previously only `identifier`). `repo`, `swarm`, and `package` are now explicit. All parser/SDK version-negotiation references updated from `2.x` to `3.x`. Migration guide: `docs-site/MIGRATION-v10.md`. |
| `9.0.0` | 2026-07-20 | v9 Breaking Changes: (1) Removed deprecated `@type_definition` alias — `@type` is now the sole custom-type declaration (spec/11 §2.5). (2) `[!]` (blocked) and `[?]` (human gate) status markers MUST carry a free-text reason; unannotated markers are a hard `SyntaxError` (promoted from v8 deprecation warning, spec/03 §4). |
| `8.4.0` | 2026-07-20 | Encrypted Secrets Vault (Production-Grade Era, V5). Introduces `@vault` (spec/03 §31 / spec/19): secrets sealed at rest with an age-style X25519 envelope + AES-256-GCM, recipient-scoped so only the matching private key unseals. `recipients` double as the registry trust root (spec/14 §4.2). New `Vault` engine in `parser/src/vault.ts` (Node built-in `crypto`) and `sdk/python/alp_sdk/vault.py` (optional `cryptography` dep, zero-dep fallback). `set`/`get`/`list`/`rotate`/`audit` APIs; `parser/tests/vault.test.ts` (8 cases) and `sdk/python/tests/test_vault.py` (8 cases, skip without `cryptography`) cover seal/unseal, no-plaintext-on-disk, unauthorized rejection, multi-recipient, rotation, and audit trail. Also fixed pre-existing missing `signing` imports in `registry.py` (2 registry test errors). Full Python suite: 179 pass. |
| `8.3.0` | 2026-07-20 | @contract Runtime Boundary Validation (Production-Grade Era, V5). Introduces declarative `@contract` objects (spec/03 §29) defining least-privilege boundaries between two entities (agents/tasks/repos) with `requires` pre-conditions, `allows`/`denies` lists (glob `.*` deny patterns), and `on_violation` modes (`deny`/`warn`/`log`). Enforced by `ContractEngine.check(contractId, context)` at handoff points (task transfer, repo write, MCP tool call). New `parser/src/contract.ts` and `sdk/python/alp_sdk/contract.py` mirror the TS engine; `parser/tests/contract.test.ts` (9 cases) and `sdk/python/tests/test_contracts.py` (9 cases) cover allow/deny, numeric & nested `requires`, unknown contracts, warn mode, and glob denial. Full Python suite: 171 pass. |
| `8.2.0` | 2026-07-20 | @timeline Scheduling Engine (Production-Grade Era, V5). Introduces native ALP scheduling without an external cron daemon: a declarative `@timeline` object (spec/03 §27) with standard 5-field `cron` expressions and one-shot ISO 8601 `at` triggers, evaluated by `TimelineEngine.evaluate(now)` returning `TimelineResult[]`. New `parser/src/schedule.ts` and `sdk/python/alp_sdk/schedule.py` mirror the TS engine; `parser/tests/schedule.test.ts` (6 cases) and `sdk/python/tests/test_schedule.py` (6 cases) cover cron matching, one-shot firing, disabled timelines, and listing. CLI `alp schedule` (spec/17) supports list/next/enable/disable/--at modes. Full Python suite: 162 pass. |
| `8.1.0` | 2026-07-20 | @policy v2 (Production-Grade Era, V5). The Python `alp_sdk` and TS `PolicyEngine` gain three extensions: (1) `allow_during` time-windows — actions outside every declared UTC window are denied (time-scoped least-privilege). (2) `require_approval` — matching actions escalate to a human-in-the-loop approval gate instead of auto-blocking. (3) `proposal` blocks — signed, auditable action proposals verified against a trust root with MCP-enforcement audit trail. New `evaluate_proposal` / `evaluateProposal` APIs; `tests/test_policy_v2.py` (6 cases) and `parser/tests/policy.test.ts` (v8.1.0 block, 3 cases) cover windows, approval, and proposal verification. CLI `alp policy` gains `--proposal <id>` and `--trust <pem>` flags. Full Python suite: 156 pass. |
| `8.0.0` | 2026-07-19 | The Production-Grade Era (V5) — three **breaking** changes: (1) Plugin model collapsed to a single `@type` declaration (spec/11 §2.5); `@type_definition` retained as a *deprecated alias* for one major, removed in v9. (2) `!assert` is now **fail-closed** (spec/16 §4): a false *or* unparseable `!assert` raises `DirectiveError`, and **unknown directives** raise a hard `SyntaxError` instead of being silently ignored. (3) `[!]` (blocked) and `[?]` (human gate) status markers **MUST carry a free-text reason** (spec/03 §4); unannotated markers emit a deprecation warning in v8 and become a hard error in v9. Migration guide: `docs-site/MIGRATION-v8.md`. `PluginResolver`/`PluginResolver` register `@type` canonically; all sub-packages bumped to `8.0.0`. |
| `7.2.0` | 2026-07-19 | Policy Federation (spec/03 §25, V4 Pillar). The Python `alp_sdk` gains a `policy_federation` module layering multi-source governance over the atomic `PolicyEngine`: `PolicyFederation` aggregates `PolicySource`s (local project, every member project via `from_workspace`, and hosted-registry namespaces via `add_registry_policies`) into one effective decision where `deny_*`/strict from ANY source wins (union of denials) while `enforcement: warn` only reports. Adds `FederatedDecision` (reasons/policies/per-source) and `audit_trail` for the V4 MCP-enforcement audit record. `tests/test_policy_federation.py` (12 cases) cover single/multi-source aggregation, registry namespaces, warn-vs-strict, neutral sources, and deny-only mode; full Python suite: 150 pass. |
| `7.1.0` | 2026-07-19 | Observability Parity (spec/05 §4, V3 Pillars 4/5). The Python `alp_sdk` gains an `observ` module mirroring the TypeScript runtime primitives: `RuntimeLog` (append-only JSONL event stream at `.alp/.runtime/log.jsonl`, mirroring `cli/src/runtime.ts`, best-effort/never-raises, typed `RUNTIME_EVENT_TYPES`) and `StateStore` (durable dependency-free snapshot at `.alp/.runtime/state.db.json`, `ingest` with timestamp+type+task_id+status de-duplication, `save`/`size`, `analytics()` reusing `analytics.compute_analytics`). Gives the Python SDK the same event-emission and durable-analytics surface as `alp serve`/`alp evolve`. `tests/test_observ.py` (11 cases) cover logging, reading (malformed-line skip), ingest/de-dup, persistence, and the runtime-log→state-store pipeline; full Python suite: 138 pass. |
| `7.0.0` | 2026-07-19 | Unified Execution Engine (spec/05). The Python `alp_sdk` gains an `engine` module implementing all four spec/05 engines with ALPEL-driven evaluation: `LoopEngine` (7-stage iterative cycle, checkpoint-per-iteration, event emitter `on`, `getState`/`getLastCheckpoint` — mirrors TS `parser/loop.ts`), `WorkflowEngine` (sequential steps, ALPEL `condition` skip, failure strategies `stop`/`skip`/`rollback`/`retry` with `RetryStrategy` backoff `fixed`/`linear`/`exponential`), `ContextEngine` (8-step `resolve` algorithm with `minimal`/`normal`/`full` scope gating), and `VerificationEngine` (policy-guarded `@verify` gates, `required`/`check` entries, `VerificationReport`). `tests/test_engines.py` (25 cases) cover every engine; full Python suite: 127 pass. |
| `6.9.0` | 2026-07-19 | Compliance v2 (spec/16). The Python `alp_sdk` gains a directive-aware reader (`!assert` raises `DirectiveError`, `!if` excludes the following top-level object via a throwaway `currentObjectSkipped` body), a new `DirectiveError`, and a `compliance` harness (`run_suite` / `HarnessResult` / `main`) mirroring `alp test-harness`: it runs `tests/compliance/{valid,invalid}` fixtures through `AlpParser.parse_and_validate` and asserts correct categorization (valid MUST parse, invalid MUST raise). `tests/test_compliance.py` covers assert/if directives and the harness; bundled `08-directives.alp` exercises `!assert`/`!if`. Full Python suite: 120 pass. |
| `6.8.0` | 2026-07-19 | Plugin Registry Protocol Parity (spec/14). The `alp_sdk` `RegistryClient` gains registry-alias parsing (`parse_registry_alias` for `@ns/name@range`, §2) and **Strict Singleton dependency resolution** (§6): `resolve_dependency_graph` / `RegistryClient.resolve_dependencies` walk transitive `dependencies`, intersect each package's version ranges via real `[min,max)` bound math, and pin exactly one version per package — raising `VersionConflictError` when two ranges have no intersection (e.g. `^1.0.0` vs `^2.0.0`). New `VersionConflictError` export; `tests/test_registry_deps.py` (10 cases) cover alias parsing, transitive resolution, compatible-range intersection, and conflict detection. Builds on the existing §3 API, §4.1 routing, §4.2 auth, §4.3 trust-root, and §5 HTTPS support already in `registry.py`. |
| `6.7.0` | 2026-07-19 | Workspace Model Parity (spec/13). The `alp_sdk` package gains a `WorkspaceLoader` mirroring `@alp/parser`'s `ExternalResolver`: walk-up discovery of `.alp/workspace.alp` (§3.2), loading of member projects via local `path` / Git `url` (cached in `.alp/.cache/projects`, pinned to `commit`) / `glob`, resolution of qualified `-> project::object` and fully-qualified `-> ws::project::object` references (§4, §9), and a cross-project dependency supergraph with cycle validation (§5.2). Enforces fatal errors for missing member `project.alp`, duplicate project IDs, and unknown project qualifiers. New `WorkspaceError` / `ProjectEntry` / `CrossProjectReference` exports; `tests/test_workspace.py` (12 cases) cover discovery, namespacing, reference resolution, supergraph edges, and cycle/error cases. |
| `6.6.0` | 2026-07-19 | ALPEL Engine Parity (spec/12). The `alp_sdk` package gains a full ALP Expression Language evaluator mirroring `@alp/parser`'s `alpel.ts`: sandboxed tokenizer + Pratt parser supporting primitives, dot/bracket property access, comparison/logical/math operators, `in`, built-ins (`length`, `toUpper`, `toLower`, `startsWith`, `size`, `isEmpty`, `contains`, `hasStatus`), and `${ }` string interpolation via `interpolate`. New `AlpelError` + `build_context`/`evaluate`/`evaluate_bool`/`interpolate` exports, with `tests/test_alpel.py` (29 cases) covering every spec/12 operator and the spec's own conditional/interpolation examples. |
| `6.5.0` | 2026-07-19 | Plugin System (spec/11). `!import` of local `.alp` files resolved relative to the `.alp/` root with circular-import detection and path-traversal guards; `@plugin` / `@type_definition` register custom object types; custom block markers parse and validate against their declared `properties` (required-field errors, unknown-property warnings). Remote HTTPS imports add caching + `!integrity` SHA-256 verification (§3.2–3.4); registry alias `@ns/name@version` imports resolve via the Plugin Registry Protocol (§3.5). `PluginResolver` + `RemoteFetcher` added to `@alp/parser` and `alp_sdk` (parity). |
| `6.4.0` | 2026-07-19 | Python Engine Parity. The `alp_sdk` package exposes `AlpGraph`, `MemoryStore`, and `PolicyEngine` mirroring the TypeScript `@alp/parser` engines, with `tests/test_engines.py` covering DAG build/cycle/topological-sort, persistent memory, and policy evaluation (deny-beats-allow, `enforcement: warn`). |
| `6.0.0` | 2026-07-18 | Integrations & CI hardening (v6). Added the missing `integrations/github/alp-validate.yml` PR workflow that builds the CLI from source and runs `alp validate` on every PR/push, failing the check on any schema-invalid `.alp` file or dependency-graph cycle. Drop-in GitHub Actions templates (`alp-sync`, `alp-pr-context`, `alp-report`) now document the correct CLI install path (build-from-source until `@alp/cli` is published to npm) instead of assuming a global install; removed a duplicate log line in `alp-sync.yml`. Agent instruction docs (`integrations/claude-code/instructions.md`, `integrations/cursor/.cursorrules`) are refreshed to the V5 surface — current-era section headers plus registry trust/verification (`alp keys trust add`, `alp registry verify [--url]`) guidance. |
| `5.0.0` | 2026-07-18 | SDK hardening & cross-SDK parity (v5). The Python SDK's `AlpReader` is brought into strict parity with the TypeScript `@alp/parser` `reader.ts`: it now rejects tab indentation, validates odd/unexpected indentation levels with `IndentationError`, requires lowercase `@[a-z_]+` block markers, and normalizes `!directive` properties — raising the same `SyntaxError`/`IndentationError` hierarchy as the TS parser. New `AlpParser` (with `parse` + `parse_and_validate`) and `error` module (`AlpError`/`SyntaxError`/`IndentationError`/`ValidationError`) mirror the TS API. A shared conformance test suite asserts the example workspace parses and validates identically across both SDKs. |
| `4.5.0` | 2026-07-18 | Remote package verification (v4.5). `alp registry verify <name>[@version] --url <host>` now audits a hosted package's signature against the trust root without downloading the entry, using the declared `integrity` as the canonical entry hash. Verification logic is extracted into a shared static `RegistryStore.verifyVersionSignature(name, version, info, trustRoots?, explicitTrustPem?)` reused by both local `verifyPackage` and remote `verifyRemote`, so remote and local checks enforce identical rules. `RegistryClient.install` is refactored to use the same helper for its signature policy. Python SDK gains parity: `verify_version_signature` + `RegistryClient.verify_remote` mirror the TS helpers, and the SDK `install` is refactored onto the shared verifier. |
| `4.4.0` | 2026-07-18 | Server-side signature enforcement + audit (v4.4). A hosted registry (`alp serve --registry`) whose `.alprc` declares a trust root for a namespace now rejects `PUT` uploads that are unsigned or signed by an untrusted key for that namespace, so a compromised publish token cannot inject untrusted packages (spec/14 §4.3). New `alp registry verify <name>[@version]` audits a stored version's signature against the local trust roots without installing. `RegistryStore` gains `trustRoots` + `isTrusted` + `verifyPackage`. Builds on 4.3.0 trust roots. |
| `4.3.0` | 2026-07-18 | Persistent signature trust roots (`.alprc` `trustedKeys`, spec/14 §4.3). Consumers pin a maintainer's public-key fingerprint or inline PEM per namespace (`@ns`) or globally (`*`) so signed installs are verified automatically and unsigned / wrong-key packages for that namespace are rejected — without passing `--key` each time. New `alp keys trust add <ns|*> <fingerprint|file>` and `alp keys trust list` manage the trust root; Python SDK gains `RegistryClient.resolve_trust_entry` / `is_trusted` parity. Builds on 4.2.0 signing. |
| `4.2.0` | 2026-07-18 | Registry trust hardening via package signing. New `alp keys generate` / `alp keys fingerprint` commands and Ed25519 detached signing (`cli/src/signing.ts`); published versions carry a public-key fingerprint + base64 signature, verified against a trust root (`.alprc` `trustedKeys` or `--key`). Signing is OPTIONAL and backward compatible: unsigned packages install normally, signed packages are verified only when a trust root is configured, and a bad signature is rejected. |
| `4.1.0` | 2026-07-18 | Registry hardening. Per-namespace bearer tokens (`--registry-token "ns=token,..."`) gate private namespace reads, downloads, and the marketplace; publish-time auth via `PUT /api/registry/-/<ns>/<name>` (manifest + files inline) required the namespace token, with path-traversal and namespace-mismatch rejection. `alp publish --url` and `alp registry publish --url` can now publish remotely; Python SDK `RegistryClient.publish` parity. |
| `4.0.0` | 2026-07-17 | The Federation Era. Completed all five V4 pillars: Remote & Networked Swarms (`@swarm`, `alp swarm`, `alp serve --registry` coordinator federation, `alp run --swarm`), Cross-Repository Orchestration (`@repo`, `ExternalResolver`, `alp repo`), the Hosted Registry & Marketplace (`alp registry` serve/publish/list/search/install, `/api/registry/*`, semver range resolution, `registry.lock.json`, sha256 integrity verification), Policy & Permission Governance (`@policy`, Policy Engine, `alp policy`, MCP enforcement + audit trail), and the Persistent State Store (`alp serve --db`, `/api/analytics`). |
| `3.1.0` | 2026-07-17 | The Observability Release. Completed V3 Pillars 4 & 5: `alp serve` (live State Server dashboard over HTTP + SSE, structured runtime event log) and `alp evolve` (failure telemetry + auto-proposed `@rule` safety checks). |
| `3.0.0` | 2026-07-15 | The Swarm Era. Concurrent multi-agent execution (`alp run --concurrent`, `LockManager`), sub-agent delegation (`alp_delegate`, `alp_decompose`), and Human-in-the-Loop handoffs (`[?]` status, `alp checkpoint --ask-human`). |
| `2.0.0` | 2025-07-15 | Final Release Candidate. Formal grammar locked. Strict semantic versioning and deprecation policies established. |
| `1.4.0` | 2025-07-15 | Dynamic object generation (`@macro`) and real-time multi-agent concurrency (file locking) |
| `1.3.0` | 2025-07-15 | Cross-Workspace References (`-> ws::proj::obj`) and automatic project discovery (`glob`) |
| `1.2.0` | 2025-07-15 | Workspace-level State, Workflows, and Checkpoints |
| `1.1.0` | 2025-07-15 | Remote Workspaces — member projects fetched dynamically via Git (`url`, `branch`, `commit`) |
| `1.0.0` | 2025-07-15 | Stable release, formal grammar (W3C EBNF), compliance test suite |
| `0.6.0` | 2025-07-15 | Plugin Registry Protocol (`@namespace/plugin@version`), plugin dependencies, and resolution strategy |
| `0.5.0` | 2025-07-15 | Multi-Project Workspaces (`@workspace`), shared agents, and qualified cross-project references (`-> project-id::object-id`) |
| `0.4.0` | 2025-07-15 | Remote Plugin Imports — `!import` now supports `https://` URLs, with local caching (`.alp/.cache/`) and optional `!integrity` hash verification |
| `0.3.0` | 2025-07-15 | Added Conditional Logic, `!if`, `!assert`, and ALPEL Expressions |
| `0.2.0` | 2025-07-15 | Added Plugin System, Custom Object Types (`@plugin`, `@type_definition`), and `!import` directive |
| `0.1.0` | 2025-07-14 | Initial specification — core syntax, all 17 objects, lifecycle, engines, memory, agents |

---

## 8. Future Versions Roadmap

The roadmap below records delivered eras and looks ahead. Released versions
are authoritative in the table in §7; this section captures intent.

| Era | Versions | Delivered |
|---|---|---|
| V2 — Execution Engine | 2.0.0 | Context bundles, topological execution |
| V3 — Multi-Agent Orchestration | 3.0.0–3.1.0 | Concurrent swarms, live state server, self-evolving protocol |
| V4 — The Federation Era | 4.0.0–4.5.0 | Networked swarms, cross-repo `@repo`, hosted registry, package signing & trust roots |
| V5 — Production-Grade Era | 7.0.0–10.0.0 | Unified Python engine, policy federation, observability parity, v8/v9 hardening, and v10 locked grammar 3.0.0: canonical `@type`, fail-closed `!assert`, `@policy` v2 (time-windows / approvals / signed proposals), `@timeline` scheduling, `@contract` boundary validation, encrypted `@vault` secrets, removed `@type_definition` alias, mandatory `[!]`/`[?]` reasons, formalized V5 governance objects in grammar |

### Forward-looking (post-10.0.0)

| Era | Versions | Theme |
|---|---|---|
| V6 — The Intelligence Era | 10.1.0–10.10.0 | Observability, replay, visualization, smarter expressions, richer MCP, plugin DX, trust, metering, debugging, formal verification |
| V7 — The Autonomous Era | 11.0.0–11.9.0 | AI-native lifecycle, natural-language authoring, self-healing, adaptive governance, distributed runtime |
| V8 — The Cognitive Era | 12.0.0–12.x | AI-native planning & reasoning: goal decomposition, reflective self-critique, replan-on-failure, memory-augmented inference |
| V9 — The Collaborative Era | 13.0.0–13.x | Multi-agent negotiation, contracts-as-protocol, reputation & trust scoring, composable agent teams, capability marketplace |
| V10 — The Verifiable Era | 14.0.0–14.x | End-to-end provenance, signed execution traces, zero-knowledge policy proofs, tamper-evident audit ledger, agent Verifiable Credentials |
| V11 — The Ambient Era | 15.0.0–15.x | Fully autonomous long-running swarms, safe self-modifying workflows, environment-adaptive execution, edge-native runtime, human oversight |

| Version | Theme | Planned Features |
|---|---|---|
| `10.3.0` | ALPEL Standard Library v2 (delivered) | Built-in date/time functions (`now`, `formatDate`, `parseDate`, `addDays`), math helpers (`round`, `floor`, `ceil`, `min`, `max`, `abs`), crypto helpers (`sha256`, `base64`), and string utilities (`trim`, `replace`, `split`, `join`, `startsWith`, `endsWith`); module import syntax for shared ALPEL snippets. Implemented in `parser/src/alpel.ts` and `sdk/python/alp_sdk/alpel.py`; tests in `parser/tests/alpel.test.ts` (+15 cases) and `sdk/python/tests/test_alpel.py` (+15 cases). |
| `10.4.0` | MCP Server v2 | New tools (`alp_create_task`, `alp_create_feature`, `alp_get_events`, `alp_get_analytics`, `alp_set_status`); MCP prompt templates for common workflows; resource subscriptions (SSE over MCP); structured error responses. Implemented in `mcp-server/src/index.ts`; new test suite `mcp-server/tests/server.test.ts` (~20 cases); new CLI command `alp mcp`. |
| `10.5.0` | Plugin Hot-Reload & Validation | Hot-reload plugins without restarting `alp serve`; plugin schema validation on load; transitive dependency graph checking; `alp plugin validate` and `alp plugin lint` commands. Implemented in `parser/src/plugin.ts` and new `cli/src/commands/plugin.ts`; Python parity in `sdk/python/alp_sdk/plugin.py`; tests in `parser/tests/plugin.test.ts` and `sdk/python/tests/test_plugin.py` (+10 cases each). |
| `10.6.0` | Cross-Federation Trust | Signed workspace manifests; trust bootstrapping between federations; federated `@policy` inheritance; `alp trust bootstrap <workspace-id>` and `alp trust list-federations` commands. Implemented in `parser/src/policy.ts` and `sdk/python/alp_sdk/policy_federation.py`; tests in `parser/tests/policy.test.ts` and `sdk/python/tests/test_policy_federation.py` (+8 cases each). |
| `10.7.0` | Resource Metering & Cost Governance | Per-agent/task token and operation counting; compute-cost estimation; rate-limiting and circuit-breaker rules in `@policy`; cost dashboards in `alp serve` (`/api/metering`). Implemented in `parser/src/state-store.ts` (`MeteringStore`) and `sdk/python/alp_sdk/observ.py` (`MeteringLog`, `CostAnalyzer`); tests in `parser/tests/metering.test.ts` and `sdk/python/tests/test_metering.py` (~12 cases each); CLI command `alp cost <task-id>`. |
| `10.8.0` | Time-Travel Debugging | Step-through execution simulation; state snapshots at each engine stage; `alp debug <run-id>` command with `--step`, `--to-stage`, and `--diff <a> <b>` flags; conditional breakpoints via `!if`. Implemented in new `parser/src/debug.ts` and `sdk/python/alp_sdk/debug.py`; `EventStore` gains `snapshot` event type; tests in `parser/tests/debug.test.ts` and `sdk/python/tests/test_debug.py` (~10 cases each). |
| `10.9.0` | Formal Verification | Math-based `@contract` precondition checking; model-checking for `@policy` safety properties; `alp verify --formal <policy-id>` command; proof-carrying execution traces. Implemented in new `parser/src/formal.ts` and `sdk/python/alp_sdk/formal.py`; tests in `parser/tests/formal.test.ts` and `sdk/python/tests/test_formal.py` (~8 cases each); `spec/18-contracts.md` updated with §4 formal checking. |
| `10.10.0` | The Distributed Runtime (V6 Preview) | Edge execution nodes; CRDT-based state synchronization (LWWRegister, ORSet); decentralized swarm consensus; `alp run --edge` and `alp swarm sync --crdt` commands. Implemented in new `parser/src/crdt.ts` and `sdk/python/alp_sdk/crdt.py`; `parser/src/swarm-client.ts` gains edge-node mode; tests in `parser/tests/crdt.test.ts` and `sdk/python/tests/test_crdt.py` (~15 cases each); `spec/06-memory.md` and `spec/04-lifecycle.md` updated for V6 preview. |
| `11.0.0` | The Intelligence Era (V6) | **Breaking:** `@policy` `warn` mode now emits structured `PolicySuggestion` objects; `alp evolve --apply` requires `--ai` for LLM-backed proposals. AI-native lifecycle hooks; self-healing workflows via `alp evolve --ai`; predictive estimation in `sdk/python/alp_sdk/analytics.py` (`PredictiveEstimator`); autonomous policy tuning via `alp policy auto-tune <id>`. Migration guide: `docs-site/MIGRATION-v11.md`. Tests expanded ~20 cases each. |
| `11.1.0` | Natural Language Workflow Authoring | Define `@workflow` objects from plain-English descriptions; LLM-assisted task decomposition from goals; `alp author "deploy feature X to staging" --out .alp/tmp/` command. Implemented in new `parser/src/author.ts` and `sdk/python/alp_sdk/author.py`; MCP tool `alp_author_workflow`; tests in `parser/tests/author.test.ts` and `sdk/python/tests/test_author.py` (~10 cases each). |
| `11.2.0` | Adaptive Policy & Continuous Governance | Policies that improve themselves from runtime evidence; anomaly detection in agent behavior (`AnomalyDetector` with statistical baselines); auto-generated policy suggestions from violation history; `@policy` versioning and rollback (`alp policy rollback <id> <version>`); `/api/policy/anomalies` feed in `alp serve` dashboard. Implemented in `parser/src/policy.ts` and `sdk/python/alp_sdk/policy.py`; tests in `parser/tests/policy.test.ts` and `sdk/python/tests/test_policy.py` (+12 cases each). |

---

### Next major versions (planned)

All planned versions from the original roadmap have now been delivered.
`15.2.0` (V11 — The Ambient Era) is the latest shipped major version.

| Version | Theme | Planned Features |
|---|---|
| `15.2.0` | Live Upgrade & Migration (delivered) | `MigrationEngine` performs cross-major-version in-place migration using `UpgradeManifest` with pluggable strategies (`blue_green`, `rolling`, `canary`, `big_bang`); dry-run validation, automatic rollback on failure, version locks, and checkpoint persistence to `.alp/migrations/`. Implemented in `parser/src/migration.ts` and `sdk/python/alp_sdk/migration.py`; tests in `parser/tests/migration.test.ts` and `sdk/python/tests/test_migration.py`. |
| `15.1.0` | Edge-Native Runtime (delivered) | Consolidates 10.10.0 CRDT edge nodes into a first-class `EdgeRuntime`: offline-first execution, resync on reconnect, locality-aware task placement. Implemented in `parser/src/crdt.ts` and `sdk/python/alp_sdk/crdt.py`. |
