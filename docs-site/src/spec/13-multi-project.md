# ALP Specification — Multi-Project Support

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

ALP v0.1.0 through v0.4.0 treated each `.alp/` directory as an isolated, self-contained project. While this works well for single repositories, modern software is frequently composed of multiple interconnected projects — microservice architectures, monorepos with shared libraries, frontend/backend splits, and platform ecosystems.

ALP v0.5.0 introduces the **Workspace** model: a way to group multiple ALP projects under a single root, enabling cross-project references, shared agents, and unified dependency graphs.

### 1.1 Key Concepts

| Concept | Definition |
|---|---|
| **Workspace** | A collection of ALP projects grouped under a common root |
| **Member Project** | An individual ALP project that belongs to a workspace |
| **Qualified Reference** | A cross-project reference using the `-> project-id::object-id` syntax |
| **Shared Agent** | An agent declared at workspace level that can operate across member projects |
| **Workspace Root** | The directory containing `.alp/workspace.alp` |

### 1.2 Design Goals

- **Composability:** Independent ALP projects can be composed into workspaces without modification to their internal structure.
- **Opt-in:** Multi-project features are entirely optional. Single-project setups continue to work exactly as before.
- **Isolation by Default:** Projects within a workspace are isolated — cross-project access requires explicit declaration.
- **Local and Remote:** Workspace members can reside on the local filesystem or be fetched dynamically via Git (v1.1.0+).

---

## 2. Workspace Definition

### 2.1 The `@workspace` Protocol Object

A workspace is defined by a `@workspace` object in a `workspace.alp` file at the workspace root.

```alp
!alp-version: 0.5.0

@workspace
  id: healthcare-platform
  name: "Healthcare Platform"
  version: 1.0.0
  description: |
    A microservice-based healthcare platform consisting of
    an auth service, patient service, and web dashboard.
  projects:
    - { path: "services/auth-service", id: auth-service }
    - { path: "services/patient-service", id: patient-service }
    - { url: "git+https://github.com/org/web-dashboard.git", branch: "main", id: web-dashboard }
  shared_agents:
    - -> agent-devops
    - -> agent-reviewer
  shared_rules:
    - -> rule-typescript-strict
    - -> rule-test-coverage
  shared_constraints:
    - -> constraint-security-baseline
```

### 2.2 `@workspace` Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Workspace identifier |
| `name` | String | Yes | Human-readable workspace name |
| `version` | String | No | Workspace version (semver) |
| `description` | String | No | Workspace description |
| `projects` | List[Object] | Yes | Member project declarations |
| `shared_agents` | List[Ref] | No | Agents available to all member projects |
| `shared_rules` | List[Ref] | No | Rules enforced across all member projects |
| `shared_constraints` | List[Ref] | No | Constraints applied across all member projects |
| `shared_memory` | List[Ref] | No | Memory entries visible to all member projects |

### 2.3 Project Entry Fields

Each entry in the `projects` list:

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | String | No* | Relative path from workspace root to the project directory |
| `url` | String | No* | Git URL to fetch a remote project (v1.1.0+) |
| `glob` | String | No* | Glob pattern to discover projects automatically (v1.3.0+) |
| `branch` | String | No | Git branch to check out (only valid with `url`) |
| `commit` | String | No | Specific Git commit hash to check out (only valid with `url`) |
| `id` | String | No* | Project identifier. Required for `path`/`url`, forbidden for `glob`. |
| `description` | String | No | Brief description of this project's role |

**Rules:**
- A project entry MUST have exactly one of: `path`, `url`, or `glob`.
- For `glob`, the parser walks the matched directories. Any directory containing `.alp/project.alp` is imported as a member project.
- For `glob`, the parser MUST read the `id` from the discovered project's `project.alp` file. If two discovered projects share the same `id`, it is a fatal `Duplicate Project ID` error.
- `path` is resolved relative to the workspace root directory (the directory containing the workspace's `.alp/`).
- `id` MUST be unique within the workspace.
- `id` MUST follow standard ALP identifier rules (lowercase, kebab-case).
- Each `path` MUST contain a valid `.alp/project.alp` file. If it does not, the parser MUST produce an error.

---

## 3. Remote Projects (v1.1.0+)

Workspaces can include projects fetched dynamically from the network via Git. This allows teams to share components, templates, and reference implementations without maintaining monorepos.

### 3.1 Fetching and Caching

When the parser encounters a remote project (using `url`), it:
1. Verifies if the project is already cached in `.alp/.cache/projects/<id>/`.
2. If not cached, it clones the repository using the provided `url`.
3. If `commit` is specified, it checks out the exact commit hash.
4. If `branch` is specified (and `commit` is not), it fetches the latest commit on that branch.
5. The cached repository acts exactly like a local project path from that point forward.

**Cache Directory:**
```
.alp/
└── .cache/
    └── projects/
        └── web-dashboard/      # Cloned from URL
            ├── .alp/
            └── src/
```

### 3.2 Immutability and Pinning

For reproducible environments, it is strongly RECOMMENDED to pin remote projects to a specific `commit`. If a `branch` like `main` is used, the parser MUST fetch updates (e.g., `git pull`) upon initialization.

Remote projects are **Read-Only**. Agents MUST NOT modify files within `.alp/.cache/projects/`. If a workspace needs to edit a remote project, it must be cloned locally and referenced via `path`.

---

## 4. Workspace Directory Structure

### 3.1 Layout

```
healthcare-platform/                  # Workspace root
├── .alp/
│   ├── workspace.alp                 # Workspace definition (REQUIRED)
│   ├── agents.alp                    # Workspace-level shared agents
│   ├── rules.alp                     # Workspace-level shared rules
│   ├── constraints.alp               # Workspace-level shared constraints
│   ├── state.alp                     # Workspace-level state (v1.2.0+)
│   └── workflows.alp                 # Workspace-level workflows (v1.2.0+)
│
├── services/
│   ├── auth-service/                 # Member project
│   │   ├── .alp/
│   │   │   ├── project.alp           # Standalone ALP project
│   │   │   ├── agents.alp
│   │   │   └── features/
│   │   │       └── auth.alp
│   │   └── src/
│   │
│   └── patient-service/              # Member project
│       ├── .alp/
│       │   ├── project.alp
│       │   └── features/
│       │       └── patients.alp
│       └── src/
│
└── apps/
    └── web-dashboard/                # Member project
        ├── .alp/
        │   ├── project.alp
        │   └── features/
        │       └── dashboard.alp
        └── src/
```

### 3.2 Discovery Rules

When an agent starts working, it discovers the workspace by:

1. Looking for `.alp/workspace.alp` in the current working directory.
2. If not found, walking up parent directories (like `.git` discovery).
3. If a `workspace.alp` is found, the agent loads the workspace context and discovers all member projects.
4. If no `workspace.alp` is found but a `project.alp` is found, the agent operates in single-project mode (backward compatible).

### 3.3 Workspace-Level Files

The workspace's `.alp/` directory MAY contain shared definitions:

| File | Contents | Scope |
|---|---|---|
| `workspace.alp` | `@workspace` definition | Required |
| `agents.alp` | `@agent` definitions | Available to all member projects |
| `rules.alp` | `@rule` definitions | Enforced across all member projects |
| `constraints.alp` | `@constraint` definitions | Applied across all member projects |
| `memory.alp` | `@memory` entries | Visible to all member projects |
| `state.alp` | `@state` entries | Tracks global workspace milestones (v1.2.0+) |
| `workflows.alp` | `@workflow` entries | Orchestrates cross-project tasks (v1.2.0+) |

**Important:** The workspace `.alp/` directory does NOT contain `project.alp`. The `workspace.alp` file takes its place as the root definition.

---

## 5. Qualified References

### 4.1 Syntax

Cross-project references use the **qualified reference** syntax:

```
-> project-id::object-id
```

The `::` delimiter separates the project identifier from the object identifier.

**Examples:**
```alp
// Reference a task in the auth-service project
depends_on:
  - -> auth-service::task-auth-api | blocks

// Reference a feature in another project
related:
  - -> patient-service::feat-patient-records | uses

// Reference a resource in another project
depends_on:
  - -> auth-service::res-auth-api | requires
```

### 4.2 Resolution Rules

1. **Unqualified references** (`-> object-id`) are resolved within the current project only. This is the existing behavior — unchanged.
2. **Qualified references** (`-> project-id::object-id`) are resolved in the specified member project.
3. The `project-id` MUST match an `id` declared in the workspace's `projects` list.
4. If the `project-id` does not match any known project, the parser MUST produce an error.
5. If the `object-id` does not exist in the target project, the parser MUST produce a dangling reference warning (same as unqualified dangling refs).
6. Qualified references are **read-only** — an agent working on Project A can reference objects in Project B, but MUST NOT modify Project B's `.alp/` files unless it has workspace-level permissions.

### 4.3 Self-Reference

A project MAY use its own project-id as a qualifier, but this is redundant:

```alp
// These are equivalent within the auth-service project:
-> task-login-api
-> auth-service::task-login-api
```

### 4.4 Workspace-Level References

Objects defined in the workspace's `.alp/` directory (e.g., shared agents) can be referenced from any member project using an unqualified reference:

```alp
// In auth-service/features/auth.alp
@task
  id: task-security-review
  owner: -> agent-reviewer    // Defined in workspace's agents.alp
```

Resolution priority:
1. **Local project scope** — check the current project first
2. **Workspace scope** — check workspace-level definitions
3. **Error** — unresolved reference

---

## 6. Cross-Project Dependencies

### 5.1 Declaring Cross-Project Dependencies

Use qualified references in `depends_on` to create cross-project dependencies:

```alp
// In apps/web-dashboard/.alp/features/dashboard.alp
@task
  id: task-auth-integration
  name: "Integrate auth service"
  depends_on:
    - -> auth-service::task-auth-api | blocks
    - -> patient-service::task-patient-api | requires
  owner: -> agent-frontend
```

Or using standalone `@dependency` objects:

```alp
@dependency
  id: dep-dashboard-needs-auth
  from: -> task-auth-integration
  to: -> auth-service::task-auth-api
  type: blocks
  description: "Dashboard auth integration requires auth API to be complete"
```

### 5.2 Cross-Project Graph Construction

The workspace-level dependency graph is a supergraph that merges the graphs of all member projects:

```
function buildWorkspaceGraph(workspace):
    graph = new DirectedGraph()
    
    // Step 1: Build each project's local graph
    for each project in workspace.projects:
        localGraph = buildDependencyGraph(project)
        graph.merge(localGraph, namespace: project.id)
    
    // Step 2: Resolve qualified cross-project edges
    for each project in workspace.projects:
        for each object in project.allObjects():
            if object.depends_on:
                for each dep in object.depends_on:
                    if dep.isQualified():
                        targetProject = workspace.getProject(dep.projectId)
                        targetObject = targetProject.getObject(dep.objectId)
                        graph.addEdge(
                            targetProject.id + "::" + targetObject.id,
                            project.id + "::" + object.id,
                            dep.qualifier OR "blocks"
                        )
    
    // Step 3: Validate — no cycles across project boundaries
    if graph.hasCycle(edgeTypes: ["blocks", "requires"]):
        error("Cross-project circular dependency detected")
    
    return graph
```

### 5.3 Cross-Project Execution Ordering

Cross-project `blocks` dependencies enforce ordering just like local dependencies:

```
Example:
  auth-service::task-auth-api ──blocks──→ web-dashboard::task-auth-integration

Meaning: web-dashboard's task-auth-integration cannot start until
         auth-service's task-auth-api status is [x].
```

Agents working on `web-dashboard` MUST check the status of `auth-service::task-auth-api` before starting `task-auth-integration`.

---

## 7. Shared Agents

### 6.1 Workspace-Level Agents

Agents defined in the workspace's `.alp/agents.alp` are available to all member projects:

```alp
// workspace .alp/agents.alp
@agent
  id: agent-devops
  name: "DevOps Engineer"
  role: devops
  permissions:
    - read
    - execute
    - deploy
  responsibilities:
    - CI/CD pipeline management
    - Cross-service deployment orchestration
    - Infrastructure monitoring
  workspace_access:
    - auth-service
    - patient-service
    - web-dashboard
```

### 6.2 The `workspace_access` Field

Workspace-level agents MUST declare which projects they can access via the `workspace_access` field:

| Value | Meaning |
|---|---|
| List of project IDs | Agent can operate on listed projects only |
| `all` | Agent can operate on all member projects |
| (omitted) | Agent can operate on all member projects (default) |

### 6.3 Project-Level Agent Overrides

A member project can restrict a workspace agent's access within its own scope:

```alp
// In auth-service/.alp/agents.alp
@agent-override
  agent: -> agent-devops
  restricted_directories:
    - "src/core/crypto/"
  max_files_per_task: 3
```

### 6.4 Agent Resolution

When a task references an agent:
1. Check the current project's `agents.alp` first.
2. If not found, check the workspace's `agents.alp`.
3. If found at workspace level, verify `workspace_access` includes the current project.
4. If not found at either level, produce an error.

---

## 8. Shared Resources

### 7.1 Shared Memory

Memory entries at the workspace level are visible to all member projects:

```alp
// workspace .alp/memory.alp
@memory
  id: mem-api-versioning-strategy
  type: architecture
  key: "api-versioning"
  value: |
    All services use URL-based versioning (e.g., /api/v1/).
    Breaking changes require a new major version.
    Old versions are supported for 6 months after deprecation.
  importance: critical
  source: "agent-architect"
```

### 7.2 Shared Rules and Constraints

Rules and constraints defined at the workspace level are enforced across all member projects. Project-level rules are additive (they add to, not replace, workspace rules).

---

## 8. Workspace-Level State & Workflows (v1.2.0+)

Starting in v1.2.0, workspaces can track global milestones and orchestrate pipelines that span across multiple member projects.

### 8.1 Workspace State

A `@state` defined in the workspace's `.alp/state.alp` represents a global milestone (e.g., `v2.0-platform-release`). 

Workspace state exists **concurrently** with member project state. A member project can reach its local milestone, but the global workspace milestone is only achieved when all cross-project criteria are met.

### 8.2 Cross-Project Workflows

A `@workflow` defined in the workspace's `.alp/workflows.alp` orchestrates tasks across the entire dependency supergraph using qualified references.

```alp
@workflow
  id: wf-platform-release
  name: "Platform v2.0 Release Orchestration"
  trigger: "manual"
  owner: -> agent-devops
  
  tasks:
    # 1. Update the auth service
    - -> auth-service::task-auth-v2-migration
    
    # 2. Update the billing service
    - -> billing-service::task-stripe-integration
    
    # 3. Finally, deploy the dashboard
    - -> web-dashboard::task-deploy-frontend
```

### 8.3 Execution Context (`cwd`)

When a workspace-level workflow executes verifications (or when agents run scripts), they often need to target a specific member project's directory. 

The `@verification` object (see Spec 03) supports a `cwd` field for this purpose:

```alp
@verification
  type: test
  command: "npm run test:e2e"
  cwd: "-> web-dashboard"    // Executes in the web-dashboard project root
  required: true
```

If `cwd` is omitted, the command executes in the workspace root.

---

## 9. Cross-Workspace References (v1.3.0+)

Starting in v1.3.0, a workspace can declare dependencies on entirely separate workspaces via the `workspaces` array in `workspace.alp`.

### 9.1 The Fully Qualified Reference Syntax

When referring to an object in a completely different workspace, use the **Fully Qualified Reference** syntax:

```
-> workspace-id::project-id::object-id
```

The parser determines the scope based on the number of `::` delimiters:
- **0 delimiters (`-> obj`)**: Unqualified (Local Project Scope)
- **1 delimiter (`-> proj::obj`)**: Qualified (Workspace Scope)
- **2 delimiters (`-> ws::proj::obj`)**: Fully Qualified (Global / Cross-Workspace Scope)

### 9.2 Resolution Rules

1. The `workspace-id` MUST match an ID declared in the current workspace's `workspaces` array.
2. The parser locates the target workspace (either local path, or remote Git URL cached locally).
3. The parser resolves the `project-id` within that target workspace.
4. The parser resolves the `object-id` within that target project.
5. All cross-workspace references are strictly **read-only**.

---

## 10. Parsing and Loading

### 8.1 Workspace Parse Order

1. Parse `workspace.alp` to discover member projects.
2. For each member project (in order of declaration):
   a. Parse the project's `.alp/project.alp`.
   b. Parse all other `.alp` files in standard order (see [09-directory-structure.md](09-directory-structure.md)).
3. Parse workspace-level shared files (`agents.alp`, `rules.alp`, etc.).
4. Resolve all qualified references.
5. Build the workspace-level dependency graph.
6. Validate: no dangling qualified references, no cross-project cycles.

### 8.2 Parse Errors

| Error | Severity | Cause |
|---|---|---|
| Missing member project | Fatal | A `path` in `projects` list has no `.alp/project.alp` |
| Duplicate project ID | Fatal | Two entries in `projects` have the same `id` |
| Unknown project qualifier | Error | `-> unknown-project::task-1` where `unknown-project` is not in workspace |
| Cross-project dangling ref | Warning | `-> auth-service::task-999` where `task-999` doesn't exist in auth-service |
| Cross-project cycle | Fatal | `A::task-1 → B::task-2 → A::task-1` cycle in `blocks`/`requires` edges |

### 8.3 Backward Compatibility

- A directory with `.alp/project.alp` but no `.alp/workspace.alp` is a single-project ALP project. All existing behavior is unchanged.
- A member project within a workspace is still a valid standalone ALP project. If parsed outside the workspace context, qualified references will produce errors (they require workspace context to resolve).

---

## 11. Limitations

The following are explicitly **out of scope** for the current version and may be addressed in future versions:

| Limitation | Planned Version |
|---|---|
| Dynamic object generation (macros) | v1.4.0+ |
| Real-time multiplayer conflict resolution | v1.4.0+ |
