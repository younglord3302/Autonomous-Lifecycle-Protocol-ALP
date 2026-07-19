# ALP Specification — Plugin System

**Version:** 8.0.0
**Status:** Stable

---

## 1. Overview

The ALP format is designed to be extensible. While the core specification provides 17 standard protocol objects (e.g., `@task`, `@feature`, `@agent`), many teams use specific methodologies like Agile, Scrum, Kanban, or domain-specific objects that don't fit perfectly into the core protocol.

The ALP Plugin System (introduced in v0.2.0) allows projects to define **Custom Object Types** using the `@type` protocol object, and load them using the `!import` directive.

Starting with v0.4.0, plugins can also be **imported from remote HTTPS URLs**, enabling organizations and the community to share and distribute standardized ALP extensions without manual file copying.

> **v8.0.0 breaking change:** the two-object model (`@plugin` + `@type_definition`) is collapsed into a single **`@type`** declaration (§2). `@type_definition` is retained as a *deprecated alias* for one major (it registers identically to `@type` and emits a deprecation warning). In v9.0.0 `@type_definition` is removed.

---

## 2. Defining a Plugin

A plugin is simply an `.alp` file that contains a `@plugin` declaration and one or more `@type_definition` blocks.

```alp
!alp-version: 0.4.0

@plugin
  id: plugin-scrum
  name: "ALP Scrum Extension"
  version: 1.0.0
  description: "Adds Agile/Scrum object types like Epics and Sprints"
  types:
    - -> type-epic
    - -> type-sprint

---

@type_definition
  id: type-epic
  type_name: epic
  description: "A large body of work that can be broken down into specific tasks (or stories)"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "status", type: "Status", required: true }
    - { name: "features", type: "List[Ref]", required: false }
  allowed_nested:
    - "accept"
    - "verify"

---

@type_definition
  id: type-sprint
  type_name: sprint
  description: "A time-boxed iteration of work"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "start_date", type: "Date", required: true }
    - { name: "end_date", type: "Date", required: true }
    - { name: "tasks", type: "List[Ref]", required: false }
```

---

## 2.5. The `@type` Block (v8.0.0+)

As of **v8.0.0** the canonical way to declare a custom type is a single `@type` object. It replaces the former `@plugin` + `@type_definition` pair (which required two objects to ship one type). A `@type` block both **identifies** the type and **defines** its schema:

```alp
!alp-version: 8.0.0

@type
  id: type-epic
  type_name: epic
  description: "A large body of work broken into features or stories"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "status", type: "Status", required: true }
    - { name: "features", type: "List[Ref]", required: false }
  allowed_nested:
    - "accept"
    - "verify"
```

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Type definition identifier |
| `type_name` | String | Yes | The keyword used for the block marker (e.g., `epic` for `@epic`) |
| `description` | String | No | What this custom type represents |
| `properties` | List[Obj] | Yes | Schema definitions for properties (name, type, required) |
| `allowed_nested` | List[String] | No | Which blocks can be nested inside this type |

**Deprecated alias:** `@type_definition` is accepted through v8.x and registers identically to `@type`, but emits a parser deprecation warning. It is **removed in v9.0.0**. The `@plugin` object (with `id` / `name` / `version` / `dependencies`) is retained for declaring *plugin metadata and dependencies*; a plugin that exposes types SHOULD still declare a `@plugin` for its `dependencies`, but each type is now its own `@type` block.

---

To use a plugin in a project, you must import the `.alp` file that defines it. This is done using the file-level `!import` directive.

```alp
!alp-version: 0.4.0
!import: "plugins/scrum-plugin.alp"

@project
  id: my-project
  // ...
```

### 3.1 Local Import Resolution

- The `!import` path is resolved relative to the `.alp/` directory root, not relative to the current file.
- When an ALP parser encounters `!import`, it MUST immediately halt parsing of the current file, load and parse the imported file entirely (resolving its types into the global parser context), and then resume parsing the current file.
- Circular imports SHOULD be detected and result in a parsing error.

**Example:**
```alp
// Resolves to: .alp/plugins/scrum-plugin.alp
!import: "plugins/scrum-plugin.alp"
```

### 3.2 Remote Import Resolution

Starting with v0.4.0, the `!import` directive also supports importing `.alp` files from remote URLs.

**Syntax:**
```alp
!import: "https://example.com/plugins/scrum-plugin.alp"
!import: "https://github.com/org/alp-plugins/raw/main/kanban.alp"
```

**Rules:**

1. **HTTPS Only.** Remote imports MUST use the `https://` scheme. Plain `http://` URLs MUST be rejected with a parsing error to prevent man-in-the-middle attacks. All other schemes (e.g., `ftp://`, `file://`) are invalid.

2. **Content-Type.** Parsers SHOULD verify that the response `Content-Type` is `text/plain` or `application/octet-stream`. Responses with `text/html` or other unexpected types SHOULD produce a warning.

3. **File Extension.** The resolved URL path MUST end with `.alp`. This is a safety check to prevent importing arbitrary content.

4. **Size Limit.** Parsers SHOULD enforce a maximum download size (recommended: 1 MB) to prevent denial-of-service via excessively large payloads.

5. **Timeout.** Parsers MUST enforce a network timeout for remote fetches (recommended: 30 seconds). A timeout MUST result in a parsing error unless a cached version is available (see Section 3.3).

6. **Recursive Remote Imports.** A remotely-imported `.alp` file MAY itself contain `!import` directives for other remote URLs. Parsers MUST enforce a maximum remote import depth (recommended: 5) to prevent infinite resolution chains. Local imports within a remotely-imported file are resolved relative to the remote URL's base path.

### 3.3 Caching

Remote imports MUST be cached locally to ensure:
- **Performance:** Plugins are not re-downloaded on every parse cycle or loop iteration.
- **Reliability:** Projects can be parsed offline after the first fetch.
- **Determinism:** The same plugin version produces the same behavior across multiple runs.

**Cache Location:**
```
.alp/
├── .cache/
│   └── remote/
│       └── <sha256-of-url>/
│           ├── plugin.alp        // The cached file content
│           └── metadata.json     // Cache metadata
```

**Cache Metadata (`metadata.json`):**
```json
{
  "url": "https://example.com/plugins/scrum-plugin.alp",
  "fetched_at": "2025-07-15T10:00:00Z",
  "etag": "\"abc123\"",
  "content_hash": "sha256:9f86d0818...",
  "ttl_seconds": 86400
}
```

**Cache Behavior:**

| Scenario | Behavior |
|---|---|
| Cache miss (first fetch) | Download, store in `.cache/remote/`, parse |
| Cache hit, TTL valid | Use cached version, no network request |
| Cache hit, TTL expired | Attempt re-fetch with `If-None-Match` / ETag. On `304 Not Modified`, extend TTL. On new content, update cache. On network failure, use stale cache with warning. |
| Offline, cache hit | Use cached version with info log |
| Offline, cache miss | Parsing error |

**Default TTL:** 24 hours. Parsers MAY allow configuration of TTL via a project-level setting.

**Cache Invalidation:** Running a parser with a `--refresh-cache` flag (or equivalent) SHOULD force re-download of all remote imports, ignoring TTL.

### 3.4 Integrity Verification

To prevent supply-chain attacks (where a remote plugin is silently modified after initial import), ALP supports optional integrity hashes on remote imports.

**Syntax:**
```alp
!import: "https://example.com/plugins/scrum-plugin.alp" !integrity: sha256:9f86d081884c...
```

**Rules:**

1. When `!integrity` is present, the parser MUST compute the SHA-256 hash of the downloaded content and compare it to the declared hash.
2. If the hashes do not match, the parser MUST reject the import with a fatal error.
3. If `!integrity` is NOT present, the parser SHOULD log a warning recommending that an integrity hash be added for security.
4. Integrity hashes are checked against the raw file content (bytes), not a parsed representation.
5. Parsers SHOULD provide a utility command (e.g., `alp hash <url>`) to compute the integrity hash of a remote file for easy inclusion in `!import` statements.

**Example with integrity:**
```alp
!alp-version: 0.6.0
!import: "https://registry.alp-protocol.org/plugins/scrum/1.0.0/plugin.alp" !integrity: sha256:e3b0c44298fc1c149afb
```

### 3.5 Registry Imports (v0.6.0+)

Starting with v0.6.0, parsers support importing plugins via registry aliases. This is the recommended approach for community and organizational plugins.

**Syntax:**
```alp
!import: "@alp/scrum@^1.0.0"
!import: "@internal/deploy@latest"
```

Registry imports automatically handle fetching, version resolution, and caching based on the [Plugin Registry Protocol](14-plugin-registry.md).

---

## 4. Using Custom Types

Once a type is defined and imported, you can use its `type_name` as a block marker, exactly like a core object.

```alp
!alp-version: 0.6.0
!import: "@alp/scrum@^1.0.0"

// We can now use @epic because it was defined in the scrum plugin!

@epic
  id: epic-q3-auth
  name: "Q3 Authentication Revamp"
  status: [~]
  features:
    - -> feat-auth
    - -> feat-sso
  
  // Custom types can even support standard nested blocks if allowed
  @accept
    - [ ] All auth features deployed to production
```

### 4.1 Parser Behavior with Custom Types

When a parser encounters a custom block marker (e.g., `@epic`):
1. It checks the global registry of defined types.
2. If the type is found, it validates the properties against the schema defined in the `@type_definition`'s `properties` list.
3. If a required property is missing, or a property has the wrong type, it throws a validation error.
4. Unrecognized properties within a custom type SHOULD generate a warning, not a fatal error.
5. If the type is NOT found (i.e., the plugin wasn't imported), the parser falls back to the forward-compatibility rule (Warning: skip the block).

---

## 5. Standard Property Types

When defining a custom type in `@type_definition`, the following values are valid for the `type` field in the `properties` schema:

- `String`
- `Number`
- `Boolean`
- `Date`
- `DateTime`
- `Duration`
- `Status` (Accepts `[ ]`, `[x]`, etc.)
- `Ref` (A reference to another object, e.g., `-> task-1`)
- `List` (A generic list)
- `List[Ref]` (A list of references)
- `List[String]` (A list of strings)
- `Enum[val1, val2]` (e.g., `Enum[high, medium, low]`)

---

## 6. Distributing Plugins

### 6.1 Local Distribution

The simplest way to use plugins is to include them directly in the project:

1. Copy the plugin's `.alp` file into a `plugins/` directory inside your `.alp/` directory.
2. Import it in `project.alp` (or any other file that needs it).
3. Commit the plugin file to your project's version control.

```
my-project/
└── .alp/
    ├── project.alp
    └── plugins/
        └── scrum-plugin.alp
```

### 6.2 Remote Distribution

Starting with v0.4.0, plugins can be hosted at any HTTPS endpoint. Common strategies include:

1. **Git repositories:** Host plugins in a public or private Git repo and import via raw file URLs.
   ```alp
   !import: "https://github.com/my-org/alp-plugins/raw/v1.0.0/scrum.alp"
   ```

2. **Plugin registries:** The recommended approach (v0.6.0+) is to use the [Plugin Registry Protocol](14-plugin-registry.md) for versioned, alias-based resolution.
   ```alp
   !import: "@alp/scrum@1.0.0"
   ```

3. **Self-hosted:** Organizations can host plugins on internal servers for private use.
   ```alp
   !import: "https://internal.example.com/alp/compliance-plugin.alp" !integrity: sha256:abc123...
   ```

**Best Practices for Remote Distribution:**

- **Pin versions.** Always include a version identifier in the URL (e.g., `/v1.0.0/` or `/raw/v1.0.0/`). Avoid importing from `main` or `latest` in production projects.
- **Use integrity hashes.** Always add `!integrity` for production projects to prevent silent changes.
- **Commit the cache.** Consider committing the `.alp/.cache/` directory to version control so that all team members and CI systems use the exact same plugin versions without requiring network access.

---

## 7. Plugin Dependencies (v0.6.0+)

Plugins can depend on other plugins. This allows ecosystem developers to build composable extensions (e.g., an `Agile-Metrics` plugin extending the base `Agile` plugin).

Dependencies are declared in the `@plugin` object:

```alp
@plugin
  id: plugin-scrum-advanced
  name: "Advanced Scrum Metrics"
  version: 1.0.0
  dependencies:
    - { plugin: "@alp/scrum", version: "^1.0.0" }
```

### 7.1 Resolution Strategy

ALP uses a **Strict Singleton** resolution strategy for plugins to ensure custom types are unambiguous.

1. Only ONE version of a given plugin namespace/name can be loaded in an ALP project.
2. The parser calculates the intersection of all requested version ranges for a plugin.
3. If the intersection is valid, the parser loads the highest available version satisfying the intersection.
4. If the intersection is empty (e.g., Plugin A wants `^1.0.0` and Plugin B wants `^2.0.0`), the parser MUST fail with a fatal **Version Conflict Error**.
5. The parser flattens the dependency graph and loads all required plugins before parsing the rest of the `.alp` project files.
