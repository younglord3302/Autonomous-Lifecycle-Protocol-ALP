# ALP Specification — Dependency Graph

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

ALP automatically builds a dependency graph from relationships declared across all `.alp` files. The graph is the foundation for:

- **Execution ordering** — determines which tasks must complete before others can start
- **Impact analysis** — when something changes, what else is affected
- **Context loading** — finding related objects for a given task
- **Progress tracking** — understanding what's blocking completion
- **Cycle detection** — preventing impossible dependency chains

---

## 2. Graph Structure

The dependency graph is a **directed acyclic graph (DAG)** where:

- **Nodes** are protocol objects (features, tasks, workflows, resources, etc.)
- **Edges** are typed relationships between objects

### 2.1 Edge Types

| Type | Symbol | Meaning | Execution Impact |
|---|---|---|---|
| `blocks` | `\|blocks` | Source cannot start until target completes | Hard ordering dependency |
| `requires` | `\|requires` | Source needs target to exist (not necessarily complete) | Soft ordering dependency |
| `extends` | `\|extends` | Source extends target's functionality | No ordering impact |
| `uses` | `\|uses` | Source uses target at runtime | No ordering impact |
| `implements` | `\|implements` | Source implements target's specification | No ordering impact |

### 2.2 Ordering Dependencies

Only `blocks` and `requires` edges affect execution ordering:

- **`blocks`**: Task A `blocks` Task B means B cannot start until A status is `[x]`
- **`requires`**: Task A `requires` Task B means B cannot start until A exists and has status `[~]` or `[x]`

All other edge types are informational — they build the relationship graph but don't constrain execution order.

---

## 3. Declaring Dependencies

Dependencies can be declared in two ways:

### 3.1 Inline Declaration (Simple)

Using `depends_on` within a task or feature:

```
@task
  id: task-login-ui
  depends_on:
    - -> task-auth-api
    - -> task-design-system
```

Inline `depends_on` creates `blocks` type edges by default.

### 3.2 Typed Inline Declaration

Using the `|` qualifier for specific relationship types:

```
@task
  id: task-login-ui
  depends_on:
    - -> task-auth-api | blocks
    - -> task-design-tokens | requires
```

### 3.3 Standalone Declaration (Detailed)

Using `@dependency` objects for rich relationship metadata:

```
@dependency
  id: dep-login-needs-api
  from: -> task-login-ui
  to: -> task-auth-api
  type: blocks
  description: "Login form needs auth API endpoints to call"
```

### 3.4 Cross-Type Dependencies

Dependencies can span object types:

```
// Feature depends on another feature
@feature
  id: feat-dashboard
  depends_on:
    - -> feat-auth | requires

// Task depends on a resource
@task
  id: task-api-setup
  depends_on:
    - -> res-postgres | requires

// Workflow depends on a feature
@workflow
  id: wf-deploy
  dependencies:
    - -> feat-auth | blocks
    - -> feat-dashboard | blocks
```

### 3.5 Cross-Project Dependencies

In a workspace, dependencies can span across member projects using qualified references:

```alp
@task
  id: task-auth-integration
  depends_on:
    - -> auth-service::task-auth-api | blocks
```

This ensures that execution ordering respects boundaries between distinct ALP projects. See the [Multi-Project Specification](13-multi-project.md) for full workspace graph rules.

---

## 4. Graph Construction

### 4.1 Algorithm

```
function buildDependencyGraph(alpProject, workspaceContext = null):
    graph = new DirectedGraph()
    
    // Step 1: Add all objects as nodes (prefixing with project ID if in workspace)
    prefix = workspaceContext ? (alpProject.id + "::") : ""
    for each object in alpProject.allObjects():
        graph.addNode(prefix + object.id, object.type)
    
    // Step 2: Add edges from inline depends_on
    for each object in alpProject.allObjects():
        if object.depends_on:
            for each dep in object.depends_on:
                edgeType = dep.qualifier OR "blocks"
                // Resolve target ID based on whether it's qualified
                targetId = dep.isQualified() ? dep.raw : (prefix + dep.target)
                graph.addEdge(targetId, prefix + object.id, edgeType)
    
    // Step 3: Add edges from standalone @dependency objects
    for each dep in alpProject.dependencies:
        sourceId = dep.from.isQualified() ? dep.from.raw : (prefix + dep.from.target)
        targetId = dep.to.isQualified() ? dep.to.raw : (prefix + dep.to.target)
        graph.addEdge(targetId, sourceId, dep.type)
    
    // Step 4: Add edges from feature → task relationships
    for each feature in alpProject.features:
        for each taskRef in feature.tasks:
            targetId = taskRef.isQualified() ? taskRef.raw : (prefix + taskRef.target)
            graph.addEdge(prefix + feature.id, targetId, "contains")
    
    // Step 5: Validate — no cycles in blocks/requires edges
    if graph.hasCycle(edgeTypes: ["blocks", "requires"]):
        error("Circular dependency detected")
    
    return graph
```

### 4.2 Edge Direction Convention

Edges point from **dependency** to **dependent**:

```
task-auth-api ──blocks──→ task-login-ui
```

This means: `task-auth-api` blocks `task-login-ui`. `task-login-ui` cannot start until `task-auth-api` is done.

---

## 5. Execution Ordering

### 5.1 Topological Sort

The execution order of tasks is determined by topological sort of the `blocks` and `requires` edges:

```
function getExecutionOrder(graph):
    // Only consider ordering edges
    orderingGraph = graph.filterEdges(types: ["blocks", "requires"])
    return orderingGraph.topologicalSort()
```

### 5.2 Parallel Execution Groups

Tasks at the same depth in the topological sort can execute in parallel:

```
Example graph:
    task-db-schema ──blocks──→ task-auth-api ──blocks──→ task-login-ui
    task-db-schema ──blocks──→ task-user-api ──blocks──→ task-register-ui
    task-design-system ──blocks──→ task-login-ui
    task-design-system ──blocks──→ task-register-ui

Execution order:
    Group 1 (parallel): task-db-schema, task-design-system
    Group 2 (parallel): task-auth-api, task-user-api
    Group 3 (parallel): task-login-ui, task-register-ui
```

### 5.3 Priority Within Groups

When multiple tasks are in the same execution group, they are ordered by:

1. `priority` (critical > high > medium > low)
2. Number of downstream dependents (more dependents = higher priority)
3. `estimated_time` (shorter tasks first, to unblock others faster)
4. Alphabetical by `id` (deterministic tiebreaker)

---

## 6. Cycle Detection

### 6.1 Mandatory Validation

ALP parsers MUST detect cycles in `blocks` and `requires` edges. Cycles make execution impossible.

### 6.2 Detection Algorithm

Use depth-first search (DFS) with three-color marking:

```
function detectCycles(graph):
    WHITE = 0  // Not visited
    GRAY = 1   // In current path
    BLACK = 2  // Fully processed
    
    colors = {}
    for each node in graph.nodes:
        colors[node] = WHITE
    
    for each node in graph.nodes:
        if colors[node] == WHITE:
            if dfs(node, colors, graph):
                return true  // Cycle found
    
    return false

function dfs(node, colors, graph):
    colors[node] = GRAY
    
    for each neighbor in graph.getNeighbors(node, types: ["blocks", "requires"]):
        if colors[neighbor] == GRAY:
            return true  // Cycle: we've found a back edge
        if colors[neighbor] == WHITE:
            if dfs(neighbor, colors, graph):
                return true
    
    colors[node] = BLACK
    return false
```

### 6.3 Cycle Error Reporting

When a cycle is detected, the error MUST include:
- The full cycle path (e.g., `A → B → C → A`)
- The file and line where each dependency is declared
- A suggestion for resolution

**Example error:**
```
ERROR: Circular dependency detected
  task-auth-api → task-user-service → task-auth-api

  Declared at:
    task-auth-api depends_on task-user-service  (features/auth.alp:15)
    task-user-service depends_on task-auth-api  (features/users.alp:22)
  
  Suggestion: Remove one of these dependencies or extract shared logic
  into a separate task that both can depend on.
```

---

## 7. Impact Analysis

### 7.1 Downstream Impact

When an object changes, find all objects that depend on it:

```
function getImpact(objectId, graph):
    return graph.getTransitiveDependents(objectId)
```

### 7.2 Upstream Dependencies

When starting work on an object, find everything it depends on:

```
function getDependencies(objectId, graph):
    return graph.getTransitiveDependencies(objectId)
```

### 7.3 Use Cases

| Scenario | Graph Query |
|---|---|
| "What can I work on now?" | Find tasks with no unresolved `blocks` dependencies |
| "What does this task unblock?" | Get downstream dependents of task |
| "Why is this task blocked?" | Get upstream dependencies with status ≠ `[x]` |
| "What's the critical path?" | Longest path in the graph |
| "What's affected if I change X?" | Transitive dependents of X |

---

## 8. Graph Visualization

ALP projects SHOULD support rendering the dependency graph as text:

```
┌─────────────────┐     ┌─────────────────┐
│ task-db-schema   │────→│ task-auth-api    │───┐
│ [x] completed    │     │ [~] in progress  │   │
└─────────────────┘     └─────────────────┘   │
                                               ↓
┌─────────────────┐     ┌─────────────────┐
│ task-design-sys  │────→│ task-login-ui    │
│ [x] completed    │     │ [ ] pending      │
└─────────────────┘     └─────────────────┘
```

---

## 9. Graph Persistence

The dependency graph is derived from the `.alp` files — it is NOT stored as a separate file. Every time `.alp` files are parsed, the graph is reconstructed.

This ensures the graph is always consistent with the declared relationships.
