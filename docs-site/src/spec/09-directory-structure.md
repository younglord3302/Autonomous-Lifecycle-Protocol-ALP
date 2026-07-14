# ALP Specification — Directory Structure

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

Every ALP project has a `.alp/` directory at the project root. This directory is the single source of truth for the project's specification — agents look here first and only here for protocol information.

---

## 2. Required Structure

### 2.1 Minimum Valid Project

The absolute minimum for a valid ALP project:

```
my-project/
└── .alp/
    └── project.alp
```

A single `project.alp` file with a valid `@project` block is the minimum requirement. All other files are optional.

### 2.2 Standard Structure

A typical ALP project:

```
my-project/
├── .alp/
│   ├── project.alp          # Project definition (REQUIRED)
│   ├── architecture.alp     # Architecture decisions and patterns
│   ├── agents.alp            # Agent definitions
│   ├── state.alp             # Project state and checkpoints
│   ├── memory.alp            # Persistent memory entries
│   ├── workflows.alp         # Workflow definitions
│   ├── rules.alp             # Coding rules and standards
│   ├── resources.alp         # External resource definitions
│   └── features/             # Feature definitions (one file per feature)
│       ├── auth.alp
│       ├── dashboard.alp
│       ├── patients.alp
│       └── billing.alp
│
├── src/                      # Project source code (any structure)
├── tests/                    # Test files
├── package.json              # (or equivalent for the project's language)
└── README.md
```

### 2.3 Full Structure

A complete ALP project with all optional files:

```
my-project/
└── .alp/
    ├── project.alp           # Project definition
    ├── architecture.alp      # Architecture specification
    ├── agents.alp            # Agent definitions
    ├── state.alp             # Project & agent state, checkpoints
    ├── memory.alp            # Persistent memory store
    ├── workflows.alp         # Workflow definitions
    ├── rules.alp             # Coding rules and standards
    ├── resources.alp         # External resources
    ├── constraints.alp       # Project constraints
    ├── goals.alp             # Project goals
    ├── decisions.alp         # Decision log
    ├── events.alp            # Event history
    │
    ├── features/             # One .alp file per feature
    │   ├── auth.alp          # Contains: @feature, @task, @context, @verify blocks
    │   ├── dashboard.alp
    │   ├── patients.alp
    │   └── billing.alp
    │
    └── contexts/             # Optional: explicit context files
        ├── auth-context.alp
        └── dashboard-context.alp
```

---

## 3. File Descriptions

### 3.1 Core Files

| File | Required | Contains | Description |
|---|---|---|---|
| `workspace.alp`| No | `@workspace` | The workspace root definition (v0.5.0+). |
| `project.alp` | **Yes***| `@project` | The project definition. (*Required unless in workspace root). |
| `architecture.alp` | No | `@decision`, `@memory` | Architecture patterns, technology choices, system design notes |
| `agents.alp` | No | `@agent` | All agent definitions. At least one required for multi-agent projects |
| `state.alp` | No | `@state`, `@agent-state` | Current project state, checkpoints, resume information |
| `memory.alp` | No | `@memory` | Persistent memory entries, growing over project lifetime |
| `workflows.alp` | No | `@workflow` | Workflow definitions for complex multi-step processes |
| `rules.alp` | No | `@rule` | Coding standards, naming conventions, quality rules |
| `resources.alp` | No | `@resource` | External APIs, databases, services, config files |
| `constraints.alp` | No | `@constraint` | Business, technical, security, and legal constraints |
| `goals.alp` | No | `@goal` | High-level project objectives and success criteria |
| `decisions.alp` | No | `@decision` | Architectural decision records |
| `events.alp` | No | `@event` | Event history log |

### 3.2 Feature Files

Feature files live in `.alp/features/` and contain everything related to a single feature:

```
// .alp/features/auth.alp
!alp-version: 0.1.0

@feature
  id: feat-auth
  name: "User Authentication"
  lifecycle_stage: implement
  priority: critical
  ...

---

@task
  id: task-login-ui
  feature: -> feat-auth
  ...

---

@task
  id: task-auth-api
  feature: -> feat-auth
  ...

---

@context
  id: ctx-auth
  task: -> task-login-ui
  ...
```

**Convention:** Feature files are self-contained — they include the feature definition, all its tasks, contexts, and any feature-scoped verification rules.

### 3.3 Context Files (Optional)

For projects with complex contexts, dedicated context files can be placed in `.alp/contexts/`:

```
// .alp/contexts/auth-context.alp
@context
  id: ctx-task-login-ui
  task: -> task-login-ui
  relevant_files:
    - "src/components/auth/"
    - "src/hooks/useAuth.ts"
  ...
```

---

## 4. File Naming Rules

| Rule | Convention | Example |
|---|---|---|
| Extension | Always `.alp` | `project.alp`, not `project.yaml` |
| Case | Lowercase kebab-case | `user-auth.alp`, not `UserAuth.alp` |
| Feature files | Named after the feature | `auth.alp` for `feat-auth` |
| No spaces | Use hyphens | `patient-records.alp`, not `patient records.alp` |
| Descriptive | Name reflects content | `workflows.alp`, not `w.alp` |

---

## 5. File Relationships

### 5.1 Cross-File References

Objects in any `.alp` file can reference objects in any other `.alp` file using `->`:

```
// In .alp/features/auth.alp
@task
  id: task-login-ui
  owner: -> agent-frontend      // Defined in agents.alp
  depends_on:
    - -> task-design-system     // Defined in features/dashboard.alp
```

References are resolved project-wide — the parser scans ALL `.alp` files to build the ID registry.

### 5.2 ID Uniqueness

IDs MUST be unique **per object type** across the entire `.alp/` directory:

- No two `@task` objects can have the same `id`, even in different files
- A `@task` and a `@feature` CAN have the same `id` (different types)
- Recommended: use prefixes to avoid confusion (`task-login`, `feat-auth`, `agent-frontend`)

### 5.3 File Load Order

ALP parsers SHOULD load files in this order:

1. `project.alp` (always first)
2. `agents.alp`
3. `rules.alp`
4. `constraints.alp`
5. `goals.alp`
6. `resources.alp`
7. `workflows.alp`
8. `features/*.alp` (alphabetical order)
9. `contexts/*.alp`
10. `decisions.alp`
11. `memory.alp`
12. `state.alp` (always last — depends on everything else)
13. `events.alp`

This ordering ensures dependencies are available when references are resolved. However, since IDs are resolved in a second pass, file load order SHOULD NOT affect correctness.

---

## 6. Mutability Rules

### 6.1 Agent-Modifiable Files

Agents regularly update these files as they work:

| File | What Changes |
|---|---|
| `state.alp` | Project state, checkpoints |
| `memory.alp` | New knowledge, updated entries |
| `events.alp` | New events appended |
| `decisions.alp` | New decisions recorded |
| `features/*.alp` | Task status, lifecycle stage, progress |

### 6.2 Rarely-Changed Files

These files are typically set during project initialization and rarely modified:

| File | When It Changes |
|---|---|
| `project.alp` | Project state or version changes |
| `agents.alp` | New agents added or roles changed |
| `rules.alp` | New rules or rule updates |
| `constraints.alp` | New constraints discovered |
| `resources.alp` | New resources added |
| `workflows.alp` | Workflow refinement |

### 6.3 Append-Only Files

Some files are append-only — new entries are added but existing entries are rarely modified:

- `events.alp` — Events are historical records
- `decisions.alp` — Decisions may be `superseded` but not deleted
- `memory.alp` — Entries may be updated but not deleted (except pruning)

---

## 7. `.alpignore`

Projects MAY include a `.alpignore` file (similar to `.gitignore`) to exclude files from ALP context:

```
// .alpignore
node_modules/
dist/
.env
*.log
coverage/
```

Agents SHOULD respect `.alpignore` when scanning the project for relevant files.

---

## 8. Version Control

### 8.1 Git Integration

The `.alp/` directory SHOULD be committed to version control. This allows:

- Multiple developers/agents to share the same project state
- History of decisions and state transitions
- Rollback capability
- Branch-specific project states

### 8.2 `.gitignore` Considerations

Projects SHOULD NOT gitignore the `.alp/` directory. However, large event logs or memory files MAY be gitignored if they grow too large:

```
// .gitignore (if needed)
.alp/events.alp    # Optional: if event log grows very large
```

---

## 9. Directory Discovery

When an agent starts working on a project, it discovers the ALP directory by:

1. Looking for `.alp/workspace.alp` in the current working directory to identify a workspace root.
2. If not found, looking for `.alp/project.alp` in the current directory to identify a standalone project root.
3. If neither are found, walking up parent directories (like `.git` discovery) checking for either `workspace.alp` or `project.alp`.
4. If no `.alp/` directory is found with either file, the directory is not an ALP project.

---

## 10. Workspace Directory Structure

Introduced in v0.5.0, a workspace groups multiple `.alp` projects together. The workspace root has its own `.alp/` directory containing `workspace.alp` and any shared files (like agents or rules), but **no** `project.alp`.

Member projects live in subdirectories, each with their own `.alp/` directory containing a `project.alp`.

```
healthcare-platform/                  # Workspace root
├── .alp/
│   ├── workspace.alp                 # Workspace definition
│   └── agents.alp                    # Shared agents
│
├── services/
│   ├── auth-service/                 # Member project
│   │   ├── .alp/
│   │   │   ├── project.alp           # Member project definition
│   │   │   └── features/
│   │   └── src/
│   │
│   └── patient-service/              # Member project
│       ├── .alp/
│       │   ├── project.alp
│       │   └── features/
│       └── src/
│
└── apps/
    └── web-dashboard/                # Member project
        ├── .alp/
        │   ├── project.alp
        │   └── features/
        └── src/
```
