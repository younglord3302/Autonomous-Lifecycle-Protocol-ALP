# ALP Specification — Syntax

**Version:** 2.0.0
**Status:** Stable

---

## 1. File Format

### 1.1 Encoding

ALP files MUST be encoded in UTF-8 without a byte order mark (BOM).

### 1.2 Extension

ALP files MUST use the `.alp` extension.

### 1.3 Line Endings

ALP parsers MUST accept both `\n` (LF) and `\r\n` (CRLF) line endings.

### 1.4 Indentation

ALP uses **2-space indentation** for nesting. Tabs are NOT permitted.

Indentation levels:
- Level 0: Block markers (`@type`)
- Level 1: Properties (`key: value`) — 2 spaces
- Level 2: Nested blocks or list items — 4 spaces
- Level 3: Deeply nested content — 6 spaces

### 1.5 Maximum Line Length

No enforced maximum. Parsers SHOULD handle lines of any length.

### 1.6 File Size

No enforced maximum. ALP files SHOULD be kept under 500 lines for readability. Large projects SHOULD split content across multiple files.

---

## 2. Syntax Elements

### 2.1 Comments

Comments begin with `//` and extend to the end of the line.

```
// This is a comment
@project
  id: my-project  // Inline comment
```

Comments are ignored by parsers. They exist for debugging and human annotation.

Block comments are NOT supported in v0.1.

### 2.2 Block Markers — `@type`

A block marker starts a new protocol object. It MUST appear at column 0 (no indentation) unless it is a nested block.

**Syntax:**
```
@<type> [<inline-id>]
```

**Rules:**
- `type` MUST be a valid core protocol object type OR a custom type defined via `@type_definition`
- `inline-id` is optional — a shorthand for setting the `id` property
- Block markers are case-sensitive and MUST be lowercase

**Examples:**
```
@project
  id: my-project

// Equivalent shorthand:
@project my-project
```

**Valid core block types:**
```
@project     @feature     @task        @workflow
@agent       @memory      @state       @artifact
@decision    @constraint  @verification @dependency
@resource    @event       @goal        @context
@rule        @plugin      @type_definition
```
Plus any custom types defined via `@type_definition`.

### 2.3 Properties — `key: value`

Properties define the fields of a protocol object. They MUST be indented by exactly 2 spaces relative to their parent block.

**Syntax:**
```
  <key>: <value>
```

**Rules:**
- `key` MUST be a valid identifier: lowercase letters, digits, and underscores (`[a-z][a-z0-9_]*`)
- A single colon followed by a space (`: `) separates key from value
- `value` can be a string, number, boolean, or null

**Value types:**

| Type | Examples |
|---|---|
| String | `name: My Project` or `name: "My Project"` |
| Quoted String | `description: "Contains: special chars"` |
| Number | `priority: 1` or `progress: 85.5` |
| Boolean | `required: true` or `required: false` |
| Null | `owner: null` |
| Date | `created: 2025-07-14` |
| DateTime | `created: 2025-07-14T18:00:00Z` |
| Duration | `estimated_time: 4h` or `timeout: 30m` or `deadline: 7d` |

**String quoting rules:**
- Quotes are optional for simple strings (no special characters)
- Quotes are REQUIRED when the value contains: `:`, `->`, `//`, `@`, `!`, `[`, `]`, `{`, `}`
- Both double quotes (`"`) and single quotes (`'`) are accepted
- Escape sequences within double quotes: `\"`, `\\`, `\n`, `\t`

### 2.4 Multi-Line Values — `|`

For long text values, use the pipe character followed by a newline. Subsequent indented lines are part of the value.

**Syntax:**
```
  <key>: |
    Line one of the value.
    Line two of the value.
    Line three of the value.
```

**Rules:**
- Content lines MUST be indented at least 2 spaces beyond the key's indentation
- Leading whitespace beyond the base indentation is preserved
- The value ends when a line appears at or before the key's indentation level
- Trailing newlines are stripped

**Example:**
```
@task
  id: task-api-design
  description: |
    Design the REST API for the user authentication module.
    Include endpoints for login, logout, registration, and
    password reset. Follow RESTful conventions.
```

### 2.5 Expression Interpolation — `${ }`

String values (both single-line and multi-line) can contain ALPEL expressions enclosed in `${ }`. These expressions are evaluated at runtime by the ALP parser/engine.

**Syntax:**
```
  <key>: "Some string with an ${ expression }"
```

**Example:**
```
  description: "Task for feature ${ task.feature.name }"
  path: "src/api/v${ project.version.major }/routes.ts"
```

For full details on expression syntax, see the [Expressions Specification](12-expressions.md).

### 2.6 Lists — `- item`

Lists are ordered sequences of values within a property.

**Syntax:**
```
  <key>:
    - <value>
    - <value>
    - <value>
```

**Rules:**
- List items are indented 2 spaces beyond their parent property
- Each item starts with `- ` (dash followed by a space)
- Items can be strings, numbers, references, or nested objects
- Empty lists are represented by omitting the property or using `<key>: []`

**Simple list:**
```
  goals:
    - Secure user authentication
    - Support OAuth2 providers
    - Implement rate limiting
```

**List of references:**
```
  depends_on:
    - -> task-db-schema
    - -> task-api-setup
```

**List of objects (inline):**
```
  tags:
    - { key: "priority", value: "high" }
    - { key: "team", value: "backend" }
```

### 2.6 References — `-> id`

References create links between protocol objects. They are the foundation of the ALP dependency graph.

**Syntax:**
```
  <key>: -> <target-id>
```

**Rules:**
- `->` MUST be followed by a space and then the target object's `id`
- References can appear as property values or within lists
- Referenced IDs MUST exist in the ALP project (validated by the reference validator)
- References are case-sensitive

**Single reference:**
```
  owner: -> agent-frontend
  feature: -> feat-auth
```

**List of references:**
```
  depends_on:
    - -> task-001
    - -> task-002
    - -> task-003
```

**Typed references:**
```
  dependencies:
    - -> task-001 | blocks
    - -> task-002 | requires
    - -> feat-auth | extends
```

The `|` after a reference adds a relationship type qualifier. Valid qualifiers depend on the context (see Dependency Graph specification).

### 2.7 Qualified References — `-> project::id`

In multi-project workspaces, references can target objects in other member projects using the **qualified reference** syntax.

**Syntax:**
```
  <key>: -> <project-id>::<target-id>
```

**Rules:**
- `project-id` MUST match a project `id` declared in the workspace's `@workspace` object.
- `::` is the project-scope delimiter — it separates the project identifier from the object identifier.
- Qualified references are only valid within a workspace context. Outside a workspace, they produce a parser error.
- Resolution: the parser looks up `target-id` in the specified project's `.alp/` directory.

**Example:**
```
@task
  id: task-auth-integration
  depends_on:
    - -> auth-service::task-auth-api | blocks
    - -> patient-service::feat-patient-records | uses
```

See the [Multi-Project Specification](13-multi-project.md) for full resolution rules.

### 2.8 Status Markers

Status markers indicate the current state of a task or feature.

**Syntax:**
```
  status: <marker>
```

**Markers:**

| Marker | Meaning | Description |
|---|---|---|
| `[ ]` | Pending | Not started |
| `[~]` | In Progress | Currently being worked on |
| `[x]` | Completed | Finished and verified |
| `[!]` | Blocked | Cannot proceed due to dependency |
| `[?]` | Needs Review | Completed but awaiting review |
| `[-]` | Skipped | Intentionally not done |

**Example:**
```
@task
  id: task-login-ui
  status: [~]
```

Status markers can also be used inline within acceptance criteria:

```
  @accept
    - [x] User can log in with email and password
    - [x] Invalid credentials show error message
    - [ ] Session persists across page refreshes
```

### 2.9 Directives — `!directive`

Directives are special instructions that control agent behavior. They appear at the file level (not inside blocks) or within specific blocks.

**Syntax:**
```
!<directive-name>: <value>
```

**File-level directives** (appear before any block):
```
!alp-version: 0.2.0
!context-scope: minimal
!agent-mode: autonomous
!import: "plugins/scrum-plugin.alp"
```

**Block-level directives** (appear inside a block):
```
@workflow
  id: wf-deploy
  !if: "project.state == 'production'"
  !assert: "task.feature != null"
  !max-iterations: 5
  !fail-strategy: rollback
  !retry-delay: 30s
```

**Core directives:**

| Directive | Scope | Description |
|---|---|---|
| `!alp-version` | File | ALP specification version this file conforms to |
| `!context-scope` | File/Block | How much context to load: `minimal`, `normal`, `full` |
| `!agent-mode` | File | Agent autonomy level: `autonomous`, `supervised`, `manual` |
| `!import` | File | Registry alias (`@ns/name@ver`), local path, `https://` URL, or workspace path to an ALP file to load |
| `!if` | Block | Evaluates a boolean expression. If false, the block is ignored. |
| `!assert` | Block | Evaluates a boolean expression. If false, parsing fails with an error. |
| `!max-iterations` | Block | Maximum loop/retry iterations |
| `!fail-strategy` | Block | What to do on failure: `stop`, `skip`, `rollback`, `retry` |
| `!retry-delay` | Block | Wait time between retries |
| `!timeout` | Block | Maximum time for an operation |
| `!priority-override` | Block | Override calculated priority |
| `!read-only` | File | File should not be modified by agents |
| `!deprecated` | Block | Object is deprecated, include migration note |

**Implementation status (v6.1.0):** The following directives are actively evaluated by the reference parser:

- `!alp-version` — recorded; does not reject mismatched versions yet.
- `!if <expr>` — if the boolean expression is false, the **next top-level block** is skipped during parse.
- `!assert <expr>` — if the boolean expression is false, parsing fails with a `DirectiveError`.
- `!deprecated: "<msg>"` — records a non-fatal deprecation warning retrievable via `parser.warnings`.
- `!import <target>` — recognised and warned; full resolution is deferred to the V6.6 federation release.

Expressions (`<expr>`) support literals (`"string"`, `42`, `true`/`false`), identifiers resolved against the current object's scalar properties plus `alp_version`, comparisons (`==`, `!=`, `>`, `<`, `>=`, `<=`), logical `&&`/`||`/`!`, and parentheses. In v6.1.0 these are evaluated at **file scope** (top level); block-level evaluation is reserved for a later release.

The remaining directives (`!context-scope`, `!agent-mode`, `!max-iterations`, `!fail-strategy`, `!retry-delay`, `!timeout`, `!priority-override`, `!read-only`) are reserved and currently ignored by the reference parser (forward-compatible).

### 2.10 Nested Blocks

Some protocol objects can contain nested sub-blocks. Nested blocks are indented relative to their parent.

**Syntax:**
```
@<parent-type>
  id: parent-id
  key: value

  @<child-type>
    id: child-id
    key: value
```

**Rules:**
- Nested blocks are indented 2 spaces beyond the parent block's property level (4 spaces from column 0)
- Only specific nesting relationships are valid (see Section 3)
- Nested blocks inherit scope from their parent

**Valid nesting relationships:**

| Parent | Valid Children |
|---|---|
| `@task` | `@verify`, `@accept`, `@artifact` |
| `@feature` | `@task`, `@constraint`, `@goal` |
| `@workflow` | `@task`, `@verification` |
| `@project` | `@goal`, `@constraint`, `@rule` |

**Example:**
```
@task
  id: task-login-ui
  name: "Build login form"
  status: [~]
  owner: -> agent-frontend

  @accept
    - [x] Form renders with email and password fields
    - [ ] Form validates input before submission
    - [ ] Error messages display correctly

  @verify
    - type: test
      command: "npm test -- --filter=login"
      required: true
    - type: lint
      command: "eslint src/components/Login.tsx"
      required: true

  @artifact
    id: art-login-component
    type: component
    path: "src/components/Login.tsx"
```

### 2.11 Object Separators — `---`

Multiple protocol objects of the same type can appear in a single file, separated by `---`.

**Syntax:**
```
@task
  id: task-001
  name: "First task"

---

@task
  id: task-002
  name: "Second task"
```

**Rules:**
- `---` MUST appear on its own line with no leading or trailing whitespace (except optional newlines)
- `---` separates top-level blocks only — it does NOT separate nested blocks
- `---` is optional between blocks of different types (the `@type` marker is sufficient)

### 2.12 Inline Objects — `{ }`

Simple objects can be written inline using curly braces.

**Syntax:**
```
  metadata: { created: 2025-07-14, author: "agent-planner" }
```

**Rules:**
- Properties within `{ }` are separated by commas
- Nesting `{ }` within `{ }` is NOT supported in v0.1
- Inline objects are for simple key-value pairs only — complex objects SHOULD use full block syntax

### 2.13 Enums

Several properties accept only predefined values. These are documented per-object in the Protocol Objects specification.

**Example:**
```
  lifecycle_stage: implement    // Must be one of: discover, understand, plan, design, implement, test, review, refactor, verify, complete
  priority: high                // Must be one of: critical, high, medium, low
  difficulty: medium            // Must be one of: trivial, easy, medium, hard, complex
```

Invalid enum values MUST produce a parser error.

---

## 3. Formal Grammar

The formal grammar for ALP has been extracted into its own specification document using W3C EBNF notation.

Please refer to the [Formal Grammar Specification](15-formal-grammar.md) for the complete and authoritative language rules.

---

## 4. Parsing Rules

### 4.1 Parse Order

1. Read file as UTF-8 text
2. Split into lines
3. Process directives (lines starting with `!`). If `!import` is found, pause parsing this file and recursively parse the imported file.
4. Process blocks (lines starting with `@`)
5. For each block, process properties, nested blocks, and lists
6. Resolve all references (`->`) after full parse

### 4.2 Whitespace Handling

- Leading whitespace determines indentation level
- Trailing whitespace on any line is ignored
- Blank lines between blocks are ignored
- Blank lines within a block are ignored (they do NOT end the block)

### 4.3 Block Boundaries

A block ends when:
1. A new top-level block marker (`@type` at column 0) appears
2. A separator (`---`) appears
3. The end of file is reached

A block does NOT end at a blank line.

### 4.4 Error Handling

Parsers MUST produce clear error messages including:
- File path
- Line number
- Column number (when applicable)
- Expected vs. received value
- Suggestion for correction (when possible)

**Error categories:**

| Category | Severity | Example |
|---|---|---|
| Syntax error | Fatal | Invalid indentation, unclosed quote |
| Unknown type | Error | `@unknown` block type |
| Invalid value | Error | `priority: super_high` (not a valid enum) |
| Missing required field | Error | `@task` without `id` |
| Dangling reference | Warning | `-> task-999` where `task-999` doesn't exist |
| Deprecated syntax | Warning | Using a deprecated directive |

### 4.5 Encoding Errors

If a file is not valid UTF-8, parsers MUST reject it with a clear encoding error.

---

## 5. File-Level Structure

Every `.alp` file follows this structure:

```
[directives]        // Optional: !alp-version, !context-scope, etc.
[comments]          // Optional: file-level comments
[block 1]           // First protocol object
[---]               // Optional separator
[block 2]           // Second protocol object
...
```

**Example complete file:**
```
!alp-version: 0.1.0

// Authentication feature tasks

@task
  id: task-login-ui
  name: "Build login form"
  status: [~]
  priority: high
  difficulty: medium
  estimated_time: 4h
  feature: -> feat-auth
  owner: -> agent-frontend
  depends_on:
    - -> task-api-auth

  @accept
    - [ ] Form renders correctly
    - [ ] Validation works

  @verify
    - type: test
      command: "npm test login"
      required: true

---

@task
  id: task-api-auth
  name: "Build auth API endpoints"
  status: [ ]
  priority: high
  difficulty: hard
  estimated_time: 8h
  feature: -> feat-auth
  owner: -> agent-backend

  @accept
    - [ ] POST /auth/login returns JWT
    - [ ] POST /auth/register creates user
    - [ ] POST /auth/logout invalidates token

  @verify
    - type: test
      command: "npm test auth-api"
      required: true
    - type: security
      check: "No plaintext passwords in response"
      required: true
```

---

## 6. Reserved Characters

The following characters have special meaning in ALP and MUST be quoted when used literally in string values:

| Character | Meaning |
|---|---|
| `@` | Block marker |
| `:` | Key-value separator |
| `->` | Reference |
| `//` | Comment |
| `!` | Directive |
| `-` | List item (at start of line after indent) |
| `[` `]` | Status marker |
| `{` `}` | Inline object |
| `|` | Multi-line value / reference qualifier |
| `---` | Separator (when alone on a line) |
| `"` `'` | String delimiters |
| `#` | Reserved for future use |

---

## 7. Naming Conventions

### 7.1 Identifiers (IDs)

- MUST start with a letter
- May contain lowercase letters, digits, hyphens, and underscores
- SHOULD use kebab-case: `task-login-ui`, `feat-auth`, `agent-frontend`
- MUST be unique within their object type across the entire ALP project
- Maximum length: 128 characters

### 7.2 Property Keys

- MUST use snake_case: `estimated_time`, `depends_on`, `lifecycle_stage`
- MUST start with a lowercase letter
- Maximum length: 64 characters

### 7.3 File Names

- MUST use kebab-case: `task-management.alp`, `user-auth.alp`
- MUST use the `.alp` extension
- SHOULD be descriptive of their content
