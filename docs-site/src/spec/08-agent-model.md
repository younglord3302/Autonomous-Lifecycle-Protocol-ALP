# ALP Specification — Agent Model

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

ALP supports multiple specialized AI agents working on the same project. The Agent Model defines:

- How agents are declared and configured
- What roles and permissions exist
- How agents collaborate
- How work is assigned
- What limits constrain agent behavior

---

## 2. Agent Declaration

Agents are declared in `.alp/agents.alp`:

```
!alp-version: 0.1.0

@agent
  id: agent-planner
  name: "Project Planner"
  role: planner
  description: "Orchestrates project planning and task breakdown"
  responsibilities:
    - Analyze requirements
    - Break features into tasks
    - Define dependencies
    - Assign work to agents
    - Track overall progress
  permissions:
    - read
    - write
  tools:
    - project-analysis
    - task-decomposition
    - dependency-graphing
  limits:
    max_concurrent_tasks: 1
    requires_review: false
  workspace_access:
    - all
```

---

## 3. Agent Roles

### 3.1 Predefined Roles

| Role | Responsibility | Typical Lifecycle Stages |
|---|---|---|
| `planner` | Project planning, task breakdown, progress tracking | discover, understand, plan |
| `architect` | System design, technology decisions, patterns | understand, plan, design |
| `frontend` | UI components, client-side logic, styling | implement, test, refactor |
| `backend` | APIs, business logic, server-side code | implement, test, refactor |
| `database` | Schema design, migrations, queries | design, implement |
| `security` | Security reviews, vulnerability scanning | review, verify |
| `qa` | Testing, quality assurance, verification | test, verify |
| `reviewer` | Code review, standards compliance | review |
| `devops` | CI/CD, deployment, infrastructure | implement, verify |
| `documentation` | Docs, API references, guides | implement, review |
| `fullstack` | Both frontend and backend work | implement, test, refactor |
| `custom` | User-defined role | Any |

### 3.2 Role Capabilities

Each role has default capabilities that can be overridden:

```
planner:
  can_create: [feature, task, goal, workflow, decision]
  can_modify: [feature, task, goal, workflow, state]
  can_execute: false
  can_verify: false

architect:
  can_create: [decision, constraint, rule, resource, context]
  can_modify: [architecture, decision, constraint]
  can_execute: false
  can_verify: false

frontend:
  can_create: [artifact, memory]
  can_modify: [task, artifact, memory]
  can_execute: true
  can_verify: true

backend:
  can_create: [artifact, memory]
  can_modify: [task, artifact, memory]
  can_execute: true
  can_verify: true

qa:
  can_create: [verification, memory, event]
  can_modify: [task, verification]
  can_execute: true
  can_verify: true

reviewer:
  can_create: [decision, memory, event]
  can_modify: [task]
  can_execute: false
  can_verify: true
```

---

## 4. Agent Permissions

### 4.1 Permission Types

| Permission | Description |
|---|---|
| `read` | Read any `.alp` file and project source code |
| `write` | Create and modify source code files |
| `execute` | Run commands (tests, builds, scripts) |
| `delete` | Delete files |
| `deploy` | Deploy to environments |
| `approve` | Approve reviews and decisions |
| `admin` | Full access, can modify any `.alp` file |

### 4.2 Permission Assignment

```
@agent
  id: agent-frontend
  permissions:
    - read
    - write
    - execute
```

### 4.3 Permission Checking

Before an agent performs an action, the ALP runtime SHOULD verify permissions:

```
function checkPermission(agent, action, target):
    if "admin" in agent.permissions:
        return true
    if action in agent.permissions:
        return true
    return false  // Denied
```

### 4.4 Permission Inheritance

Agents do NOT inherit permissions from roles by default. All permissions must be explicitly declared.

---

## 5. Agent Limits

Limits constrain what an agent can do to prevent runaway behavior:

| Limit | Type | Description |
|---|---|---|
| `max_concurrent_tasks` | Number | Max tasks an agent works on simultaneously |
| `max_files_per_task` | Number | Max files an agent can create/modify per task |
| `max_lines_per_file` | Number | Max lines in a single file |
| `max_iterations` | Number | Max loop iterations |
| `timeout_per_task` | Duration | Max time per task |
| `requires_review` | Boolean | Whether work must be reviewed before completion |
| `allowed_directories` | List | File paths the agent can access |
| `blocked_directories` | List | File paths the agent cannot access |

**Example:**
```
@agent
  id: agent-junior-backend
  role: backend
  limits:
    max_concurrent_tasks: 1
    max_files_per_task: 5
    max_lines_per_file: 300
    max_iterations: 5
    timeout_per_task: 2h
    requires_review: true
    allowed_directories:
      - "src/api/"
      - "src/services/"
      - "tests/"
    blocked_directories:
      - "src/core/"
      - "infrastructure/"
      - ".alp/"
```

---

## 6. Task Assignment

### 6.1 Assignment Methods

Tasks are assigned to agents using the `owner` field:

```
@task
  id: task-login-ui
  owner: -> agent-frontend
```

### 6.2 Assignment Rules

1. A task SHOULD have exactly one `owner`
2. The owner's role SHOULD match the task's nature (frontend tasks → frontend agent)
3. Tasks without an `owner` can be claimed by any agent with appropriate role
4. An agent MUST NOT exceed its `max_concurrent_tasks` limit

### 6.3 Automatic Assignment

When no `owner` is specified, agents can self-assign based on:

1. Role compatibility (does the agent's role match the task type?)
2. Current workload (is the agent under its `max_concurrent_tasks`?)
3. Permission compatibility (does the agent have required permissions?)
4. Priority (higher priority tasks are assigned first)

```
function autoAssign(task, agents):
    candidates = agents.filter(a => 
        a.role matches task.type AND
        a.currentTasks < a.limits.max_concurrent_tasks AND
        a.hasPermissions(task.requiredPermissions)
    )
    if candidates.isEmpty():
        task.status = [!]  // Blocked — no agent available
        return null
    
    // Pick the least-loaded compatible agent
    return candidates.sortBy(a => a.currentTasks).first()
```

---

## 7. Multi-Agent Collaboration

### 7.1 Collaboration Model

Multiple agents can work on the same project following these rules:

1. **No concurrent modification**: Two agents MUST NOT modify the same file simultaneously
2. **Dependency respect**: Agents MUST wait for blocking dependencies to resolve
3. **Communication via memory**: Agents communicate by writing `@memory` entries
4. **Event notification**: Agents emit `@event` objects when they complete significant work
5. **State synchronization**: All agents read from and write to the same `.alp/` directory

### 7.2 Communication Protocol

Agents communicate indirectly through ALP objects:

| Communication Need | Mechanism |
|---|---|
| "I made a design decision" | Create `@decision` object |
| "I discovered a bug" | Create `@memory` entry (type: error) |
| "I finished my task" | Update task status to `[x]`, create `@event` |
| "I'm blocked" | Update task status to `[!]`, record reason |
| "I need help" | Create `@memory` entry (type: conversation) |

### 7.3 Handoff Protocol

When one agent's task produces output that another agent needs:

1. First agent marks task as `[x]`
2. First agent creates `@artifact` with the output path
3. First agent creates `@event` announcing completion
4. Second agent's blocking dependency resolves
5. Second agent loads context, including first agent's artifacts and memory
6. Second agent begins work

### 7.4 Cross-Project Handoff Protocol (Workspaces)

In a multi-project workspace, agents can collaborate across project boundaries if they have shared access.

1. Agent A in `project-1` marks task as `[x]`
2. Agent A creates `@event` announcing completion
3. Agent B in `project-2` sees its cross-project dependency (`-> project-1::task-1`) is resolved
4. Agent B loads context from both projects
5. Agent B begins work on dependent task in `project-2`

---

## 8. Single-Agent Mode

Most projects will run with a single agent that fulfills all roles. In single-agent mode:

- The agent MAY have role `fullstack` or `custom`
- The agent has `admin` permissions
- Task assignment is implicit (all tasks belong to the single agent)
- Collaboration rules still apply (checkpointing, memory, events)

**Minimal single-agent setup:**
```
@agent
  id: agent-main
  name: "Primary Agent"
  role: fullstack
  permissions:
    - admin
  responsibilities:
    - All project tasks
```

---

## 9. Agent State

Each agent's current state is tracked:

```
@agent-state
  agent: -> agent-frontend
  status: active
  current_tasks:
    - -> task-login-ui
  completed_tasks:
    - -> task-design-tokens
    - -> task-button-component
  session_started: 2025-07-14T18:00:00Z
  last_checkpoint: "chk-agent-fe-003"
```

Agent state is stored in `.alp/state.alp` alongside project state.

---

## 10. Workspace-Scoped Agents

Introduced in v0.5.0, agents can be declared at the workspace level (in `.alp/agents.alp` at the workspace root).

### 10.1 Workspace Access Control

The `workspace_access` field defines which member projects an agent can operate on:

- `["auth-service", "web-dashboard"]` — Agent is restricted to these specific projects.
- `["all"]` — Agent can operate on any project in the workspace.
- (omitted) — Defaults to `["all"]`.

### 10.2 Agent Overrides

A member project can restrict a workspace agent's capabilities locally by defining an `@agent-override` block in its own `agents.alp`:

```alp
@agent-override
  agent: -> agent-devops
  restricted_directories:
    - "src/core/crypto/"
```

---

## 11. Multi-Agent Concurrency (v1.4.0+)

When multiple agents run in real-time, they may attempt to write to the same `.alp` files simultaneously. ALP uses **Strict File Locking** with exponential backoff to prevent data corruption.

### 11.1 File Locking Convention

Before modifying an `.alp` file, an agent MUST attempt to create a `.lock` file alongside the target file (e.g., `.alp/project.alp.lock`). 

If the `.lock` file already exists, the agent MUST NOT write to the file.

### 11.2 Lock Expiration

To prevent deadlocks (e.g., if an agent crashes while holding a lock), all `.lock` files MUST include a timestamp inside the file:
```
agent: agent-frontend
timestamp: 2025-07-15T02:00:00Z
```
Locks older than 60 seconds are considered **Stale** and MAY be forcefully overridden by another agent.

### 11.3 Write Retry Strategy

If an agent encounters a valid lock, it MUST use an exponential backoff retry strategy before failing:
1. Wait 500ms
2. Wait 1s
3. Wait 2s
4. Wait 4s
5. Wait 8s
6. Fail (Transition agent state to `blocked`)
