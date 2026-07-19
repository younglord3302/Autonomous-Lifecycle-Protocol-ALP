# ALP v8.0.0 Migration Guide

ALP **v8.0.0** (the *Production-Grade Era*, V5) introduces three
**breaking** changes. This guide covers what changed and how to update
existing `.alp` projects and parser/SDK integrations.

---

## 1. Plugin model collapsed to `@type` (breaking)

**Before (≤ v7.2):**
```alp
@plugin
  id: plugin-scrum
  name: "Scrum Extension"
  types:
    - -> type-epic

@type_definition
  id: type-epic
  type_name: epic
  properties:
    - { name: "id", type: "String", required: true }
```

**After (v8.0.0):** declare each type with a single `@type` block.
```alp
!alp-version: 8.0.0

@type
  id: type-epic
  type_name: epic
  properties:
    - { name: "id", type: "String", required: true }
```

- `@type_definition` is accepted through v8.x as a **deprecated alias**
  (registers identically, emits a warning). It is **removed in v9.0.0**.
- `@plugin` is retained for declaring **plugin metadata + dependencies**
  (`id`, `name`, `version`, `dependencies`). A plugin that exposes
  types now declares one `@type` per type alongside its `@plugin`.

**Parser/SDK:** `PluginResolver.types` is keyed by `type_name`
regardless of source; `registerType` now accepts a `warnings` array
carrying the deprecation notice.

---

## 2. `!assert` is fail-closed; unknown directives error (breaking)

- A `!assert` whose ALPEL expression is **false** still raises
  `DirectiveError` (unchanged).
- **New:** a `!assert` whose expression **fails to evaluate**
  (unknown identifier, syntax error) now raises `DirectiveError`
  instead of being silently ignored.
- **New:** an **unrecognised directive** (e.g. `!asret: ...`) is a
  **hard `SyntaxError`**. Previously unknown directives were silently
  skipped for forward compatibility; only *known* directives enjoy that
  tolerance now.

**Fix your files:** correct any mistyped directive names; ensure every
`!assert` expression is well-formed against the current object's context.

---

## 3. `[!]` / `[?]` status markers require a reason (breaking → phased)

- `[!]` = blocked by an external dependency; `[?]` = waiting on a human.
- **v8.0.0:** unannotated `[!]` / `[?]` emit a **deprecation
  warning** but still parse.
- **v9.0.0:** the missing reason becomes a **hard parse error**.

**Update now:**
```
  status: [!] upstream API v3 contract not published yet
  status: [?] needs security sign-off on token storage
```
The plain `[ ]`, `[~]`, `[x]`, `[-]` markers are unchanged.

---

## Checking your project

Run the compliance harness against the new fixtures
(`04-unknown-directive.alp`, updated `03-assert-fails.alp`):

```bash
alp test-harness
```

Bundle versions are `8.0.0` across `@alp/parser`, `@alp/cli`,
`@alp/mcp-server`, `alp_sdk` (Python), and the docs site.
