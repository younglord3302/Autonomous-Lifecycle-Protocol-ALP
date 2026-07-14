# ALP Syntax Cheatsheet

Quick reference for the `.alp` file format (v2.0.0).

---

## Blocks

```
@project                         // Block marker (top-level)
@feature my-feature              // Block with inline ID
@task                            // Start a new protocol object
```

**All block types:**
`@project` `@workspace` `@feature` `@task` `@workflow` `@agent` `@memory` `@state` `@artifact` `@decision` `@constraint` `@verification` `@dependency` `@resource` `@event` `@goal` `@context` `@rule` `@plugin` `@type_definition`

**Nested blocks (inside tasks):**
`@accept` `@verify` `@artifact`

---

## Properties

```
  name: "My Project"             // String value (quoted)
  name: My Project               // String value (unquoted)
  priority: high                 // Enum value
  progress: 85                   // Number
  required: true                 // Boolean
  owner: null                    // Null
  created: 2025-07-14            // Date
  created: 2025-07-14T18:00:00Z  // DateTime
  estimated_time: 4h             // Duration (s, m, h, d, w)
  description: "Target ${ project.version }" // Interpolation
```

---

## Multi-Line Values

```
  description: |
    First line of the description.
    Second line continues here.
    Indentation preserved.
```

---

## Lists

```
  goals:
    - Secure authentication
    - OAuth2 support
    - Rate limiting
```

## Core Objects (Macro)

```
@macro
  id: generate-tasks
  iterate_over: "['auth', 'billing']"
  as: "service"
  template:
    @task
      id: "task-deploy-${service}"
      name: "Deploy ${service}"
```

---

## References

```
  owner: -> agent-frontend                   // Local project reference
  feature: -> auth-service::feat-login       // Qualified (Cross-Project)
  depends_on:
    - -> ui-core::buttons::task-update-btn   // Fully Qualified (Cross-Workspace)
    - -> workspace-a::project-b::task-001    // Cross-Workspace reference
    - -> tasks::task-*                       // Glob pattern reference
  dependencies:
    - -> task-001 | blocks                 // Typed reference
    - -> task-002 | requires
```

---

## Status Markers

```
  status: [ ]      // Pending
  status: [~]      // In Progress
  status: [x]      // Completed
  status: [!]      // Blocked
  status: [?]      // Needs Review
  status: [-]      // Skipped
```

In acceptance criteria:
```
  @accept
    - [x] Login form renders correctly
    - [ ] Validation works
    - [!] API integration blocked
```

---

## Directives

```
!alp-version: 2.0.0             // File-level: ALP version
!context-scope: minimal         // File-level: context loading
!agent-mode: autonomous         // File-level: agent behavior
!import: "@alp/scrum@^1.0.0"    // File-level: registry plugin
!import: "plugins/my-plug.alp"  // File-level: local plugin
!import: "https://example.com/scrum.alp"           // File-level: remote import
!import: "https://example.com/s.alp" !integrity: sha256:abc123  // With integrity hash
!if: "project.state == 'prod'"  // Block-level: condition
!assert: "task.feature != null" // Block-level: assertion
!max-iterations: 10             // Block-level: loop limit
!fail-strategy: rollback        // Block-level: failure handling
!retry-delay: 30s               // Block-level: retry timing
!timeout: 5m                    // Block-level: max time
!read-only                      // File-level: don't modify
!deprecated: "Use X instead"    // Block-level: deprecation
```

---

## Comments

```
// This is a comment
@task
  id: my-task  // Inline comment
```

---

## Separators

```
@task
  id: task-001

---

@task
  id: task-002
```

---

## Inline Objects

```
  metadata: { author: "agent-planner", created: "2025-07-14" }
  tags:
    - { key: "team", value: "backend" }
```

---

## Nested Blocks

```
@task
  id: task-login-ui
  name: "Build Login Form"

  @accept
    - [ ] Form renders correctly
    - [ ] Validation works

  @verify
    - type: test
      command: "npm test login"
      required: true

  @artifact
    id: art-login
    type: component
    path: "src/components/Login.tsx"
```

---

## Enums Quick Reference

**Priority:** `critical` | `high` | `medium` | `low`

**Difficulty:** `trivial` | `easy` | `medium` | `hard` | `complex`

**Lifecycle:** `discover` → `understand` → `plan` → `design` → `implement` → `test` → `review` → `refactor` → `verify` → `complete`

**Project State:** `planning` | `architecture` | `development` | `testing` | `blocked` | `waiting` | `review` | `completed` | `archived`

**Agent Role:** `planner` | `architect` | `frontend` | `backend` | `database` | `security` | `qa` | `reviewer` | `devops` | `documentation` | `fullstack` | `custom`

**Dependency Type:** `blocks` | `requires` | `extends` | `uses` | `implements`

**Memory Type:** `project` | `architecture` | `feature` | `task` | `decision` | `error` | `agent` | `knowledge` | `conversation` | `context`

**Verification Type:** `test` | `lint` | `security` | `performance` | `accessibility` | `documentation` | `formatting` | `custom`

**Artifact Type:** `component` | `api` | `migration` | `schema` | `test` | `documentation` | `diagram` | `configuration` | `script` | `stylesheet` | `asset` | `other`

---

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| IDs | kebab-case | `task-login-ui` |
| Property keys | snake_case | `estimated_time` |
| File names | kebab-case.alp | `user-auth.alp` |

---

## Minimum Valid File

```
!alp-version: 2.0.0

@project
  id: my-project
  name: "My Project"
  version: 2.0.0
  state: planning
```
