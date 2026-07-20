# ALP v10.0.0 Migration Guide

ALP **v10.0.0** (*The Governance Era*, V6) introduces one major breaking
change: the formal grammar is bumped to **3.0.0**, removing the deprecated
`@type_definition` alias and promoting V5 governance objects to first-class
block types. This guide covers what changed and how to update existing
`.alp` projects and parser/SDK integrations.

---

## 1. Grammar 3.0.0 — `@type_definition` removed, V5 objects formalized (breaking)

**Before (≤ v9.0.0):**
```alp
@type_definition
  id: type-epic
  type_name: epic
  properties:
    - { name: "id", type: "String", required: true }
```

**After (v10.0.0):** use `@type` exclusively.
```alp
!alp-version: 10.0.0

@type
  id: type-epic
  type_name: epic
  properties:
    - { name: "id", type: "String", required: true }
```

- `@type_definition` was **removed in v9.0.0** and is no longer accepted
  by any parser or SDK. Using it now produces a hard `ValidationError`.
- The formal grammar (`spec/15-formal-grammar.md`) is now **3.0.0**.
  The `block_type` production includes the V5 governance objects as
  explicit alternatives: `@policy`, `@timeline`, `@contract`, `@vault`,
  plus `@repo`, `@swarm`, `@package`, and `@type`.

**Parser/SDK:** `PluginResolver` already rejects `type_definition` objects
with a hard error (since v9). The schema `type_definition.schema.json` has
been removed from `@alp/schemas`; use `type.schema.json` instead.

---

## 2. Version negotiation references updated

All parsers and SDKs now reference grammar version **3.x** in error
messages and version-negotiation logic:

- `AlpReader` / `AlpParser` accept `!alp-version: 3.x`
- Version-negotiation error messages read:
  `"This file requires ALP v3.x, but this parser supports v2.x"`

If your project pins `!alp-version: 2.0.0`, it will continue to parse
under v10 parsers (forward-compatible within the same major), but you
should update to `!alp-version: 3.0.0` to opt into the new grammar.

---

## 3. No other breaking changes

All v8 and v9 breaking changes remain in effect:

- `!assert` is fail-closed (v8.0.0)
- Unknown directives raise `SyntaxError` (v8.0.0)
- `[!]` / `[?]` require a trailing reason text (v9.0.0)
- `@type` is the sole custom-type declaration (v8.0.0+, enforced v9.0.0)

---

## Checking your project

```bash
node cli/dist/index.js validate
python -m unittest discover -s sdk/python/tests
```

Bundle versions are **10.0.0** across `@alp/parser`, `@alp/cli`,
`@alp/mcp-server`, `alp_sdk` (Python), and the docs site.
