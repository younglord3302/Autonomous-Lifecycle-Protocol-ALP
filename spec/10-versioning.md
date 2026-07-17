# ALP Specification — Versioning

**Version:** 2.0.0
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

Starting with `v2.0.0`, ALP adheres strictly to Semantic Versioning (`MAJOR.MINOR.PATCH`). This provides strong guarantees to parser implementers and agent developers:

1. **PATCH (`2.0.x`)**: Bug fixes, typo corrections in documentation, and clarifications that do not change protocol behavior.
2. **MINOR (`2.x.0`)**: New backwards-compatible features (e.g., adding a new optional field to a core object).
3. **MAJOR (`3.0.0`)**: Breaking changes to the grammar or core object schemas.

### 3.1 Backward Compatibility

Within the same MAJOR version:
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
| Higher MAJOR | Error: "This file requires ALP v2.x, but this parser supports v1.x" |
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
- A feature or field MAY be marked as deprecated in any `MINOR` release (e.g., `2.1.0`).
- A deprecated feature MUST remain fully valid and supported by parsers for the remainder of that major version lifecycle.
- A deprecated feature MAY only be fully removed in the next `MAJOR` release (e.g., `3.0.0`).

When a feature is deprecated in a new version, use the `!deprecated` directive:

```alp
@task
  id: task-old-login
  !deprecated: "Replaced by task-new-login in v2.1.0"
```

Deprecated elements:
- MUST still be parseable for the remainder of the MAJOR version
- SHOULD produce a warning when parsed
- MUST include a migration note via the `!deprecated` directive

---

## 7. Version History

| Version | Date | Changes |
|---|---|---|
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

| Version | Planned Features |
|---|---|
| `4.0.0` | The Federation Era — networked/remote swarms, cross-repo orchestration, a hosted registry, and policy/permission governance for autonomous agents. |
