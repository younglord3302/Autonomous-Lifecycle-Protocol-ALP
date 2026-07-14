# ALP Specification — Memory Model

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

ALP Memory is a persistent, scoped key-value storage system that allows agents to retain knowledge across sessions. Memory eliminates the need for agents to re-derive information they have already discovered.

**Core principle:** An agent should never have to figure out the same thing twice.

---

## 2. Memory Types

| Type | Purpose | Example |
|---|---|---|
| `project` | Project-wide knowledge | "This project uses npm workspaces" |
| `architecture` | Architectural decisions and patterns | "We use a layered architecture: API → Service → Repository" |
| `feature` | Feature-specific knowledge | "Auth uses JWT with refresh tokens" |
| `task` | Task-specific notes | "The login form needs to handle OAuth redirect" |
| `decision` | Why something was decided | "Chose PostgreSQL over MongoDB for ACID compliance" |
| `error` | Known bugs, workarounds, gotchas | "Prisma migration fails if DB timezone isn't UTC" |
| `agent` | Agent-specific preferences or state | "Agent-frontend prefers functional components" |
| `knowledge` | General technical knowledge | "Next.js 14 App Router uses server components by default" |
| `conversation` | Key takeaways from agent interactions | "User wants dark mode as default" |
| `context` | Contextual information for tasks | "This component must match the Figma mockup at /designs/login.fig" |

---

## 3. Memory Entry Structure

Every `@memory` object has:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique identifier |
| `type` | Enum | Yes | One of the 10 memory types |
| `key` | String | Yes | Lookup key (unique within type + scope) |
| `value` | String | Yes | The stored knowledge |
| `scope` | Ref | No | Object this memory is scoped to (feature, task, etc.) |
| `importance` | Enum | No | `critical`, `high`, `medium`, `low` (default: `medium`) |
| `source` | String | No | What created this entry (agent ID or process) |
| `ttl` | Duration | No | Time-to-live before auto-expiry |
| `created` | DateTime | No | When created |
| `updated` | DateTime | No | When last updated |

---

## 4. Memory Storage

Memory is stored in `.alp/memory.alp`:

```
!alp-version: 0.1.0

// Project-level memories
@memory
  id: mem-001
  type: project
  key: "package-manager"
  value: "This project uses pnpm, not npm"
  importance: high
  source: "agent-planner"

---

@memory
  id: mem-002
  type: architecture
  key: "api-pattern"
  value: |
    All API routes follow the pattern:
    /api/v1/{resource}
    Controllers → Services → Repositories
    Validation happens at the controller level using Zod schemas.
  importance: critical
  source: "agent-architect"

---

@memory
  id: mem-003
  type: error
  key: "prisma-timezone-bug"
  value: "Prisma migrations fail if DATABASE_TIMEZONE != UTC. Set it in .env."
  scope: -> task-db-setup
  importance: high
  source: "agent-backend"
  ttl: 90d

---

@memory
  id: mem-004
  type: decision
  key: "state-management"
  value: "Using Zustand for client state. Server state via React Query. No Redux."
  scope: -> feat-dashboard
  importance: critical
  source: "agent-architect"
```

---

## 5. Memory Operations

### 5.1 Write

Agents write memory when they discover something worth remembering:

| Trigger | Memory Type | Example |
|---|---|---|
| Making a decision | `decision` | "Chose Zustand over Redux" |
| Encountering an error | `error` | "Port 3000 conflict with existing process" |
| Learning about architecture | `architecture` | "DB uses soft deletes, never hard delete" |
| Completing a task | `task` | "Login form uses react-hook-form v7" |
| User provides information | `conversation` | "User wants SSO support in phase 2" |

### 5.2 Read

Agents read memory when starting work:

```
1. Load all memory where scope matches current task
2. Load all memory where scope matches current feature
3. Load all memory with type = "project" or type = "architecture"
4. Load all memory with importance = "critical"
5. Filter by relevance to current task context
```

### 5.3 Query

Memory can be queried by:

| Query | Syntax | Example |
|---|---|---|
| By type | `memory.type == "error"` | Get all known errors |
| By scope | `memory.scope == feat-auth` | Get all auth-related memory |
| By importance | `memory.importance == "critical"` | Get critical knowledge |
| By key | `memory.key == "api-pattern"` | Get specific entry |
| By source | `memory.source == "agent-backend"` | Get backend agent's memories |
| Combined | Type + scope | Errors related to auth feature |

### 5.4 Update

When knowledge changes, agents SHOULD update the existing memory entry rather than creating a new one:

```
@memory
  id: mem-004
  type: decision
  key: "state-management"
  value: "Using Zustand for client state. Server state via TanStack Query v5. No Redux."
  scope: -> feat-dashboard
  importance: critical
  source: "agent-architect"
  updated: 2025-07-15T10:00:00Z    // Updated
```

### 5.5 Delete / Prune

- Entries with `ttl` are automatically expired after the duration
- Agents MAY explicitly delete memory entries that are no longer relevant
- The `prune` operation removes all expired entries

---

## 6. Memory Scoping Rules

### 6.1 Scope Hierarchy

```
Project (global)
  └── Feature
       └── Task
```

Memory scoped to a task is visible to:
- That task only

Memory scoped to a feature is visible to:
- That feature and all its tasks

Memory with no scope (or scoped to project) is visible to:
- Everything in the project

### 6.2 Scope Inheritance

When querying memory for a task, an agent receives:
1. Memory scoped directly to the task
2. Memory scoped to the task's parent feature
3. Memory scoped to the project (no scope / scope = project)
4. Memory with `importance: critical` regardless of scope

### 6.3 Scope Conflicts

If two memory entries have the same `key` at different scopes, the narrower scope wins:

```
// Project-level
@memory
  type: architecture
  key: "database"
  value: "PostgreSQL"

// Feature-level (narrower scope wins for this feature)
@memory
  type: architecture
  key: "database"
  value: "SQLite for local caching"
  scope: -> feat-offline-mode
```

---

## 7. Memory Best Practices

### 7.1 When to Create Memory

- **Always** after making a non-obvious decision
- **Always** after encountering and solving an error
- **Always** when user provides project-specific information
- **Consider** after learning something about the codebase
- **Consider** after discovering a pattern or convention

### 7.2 When NOT to Create Memory

- Information already in the `@context` object
- Information derivable from the code itself
- Temporary debugging notes (use `ttl` if needed)
- Duplicate of existing memory

### 7.3 Key Naming Convention

Memory keys SHOULD use kebab-case and be descriptive:

| Good | Bad |
|---|---|
| `authentication-strategy` | `auth` |
| `database-migration-workaround` | `db-fix` |
| `api-rate-limit-config` | `limits` |
| `user-preference-dark-mode` | `dm` |

### 7.4 Value Quality

Memory values SHOULD be:
- Complete enough to be useful without additional context
- Concise enough to not waste context window
- Actionable — telling the agent what to do, not just what happened
- Updated when the information changes

---

## 8. Memory Limits

To prevent unbounded memory growth:

| Limit | Default | Description |
|---|---|---|
| Max entries per project | 500 | Total memory entries |
| Max value length | 2000 chars | Length of a single value |
| Default TTL | None | Entries persist indefinitely unless TTL set |
| Max TTL | 365d | Maximum time-to-live |

When the entry limit is reached, agents SHOULD:
1. Prune expired entries
2. Remove `low` importance entries
3. Merge related entries
4. Archive old entries to a separate file
