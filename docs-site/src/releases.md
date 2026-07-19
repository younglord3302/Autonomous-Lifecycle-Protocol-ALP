---
title: Releases
description: ALP release history — specification and toolchain versions
---

# Releases

ALP versioning tracks two independent axes:

- **Specification** (`spec/01-overview`) — the protocol grammar. Locked at **2.0.0 (Stable)**; strict semantic-versioning guarantees apply to implementations.
- **Toolchain** (`@alp/cli`, `@alp/sdk`, docs-site, integrations) — the implementation and packaging, released on its own cadence.

## Toolchain

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
