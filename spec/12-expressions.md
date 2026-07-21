# ALP Specification — Expressions (ALPEL)

**Version:** 10.3.0
**Status:** Stable

---

## 1. Overview

Starting with v0.3.0, ALP includes the **ALP Expression Language (ALPEL)**. ALPEL is a secure, sandboxed, and lightweight expression language used for conditional logic and string interpolation. 

ALPEL allows workflows, tasks, and engines to dynamically adapt based on the project's current state, without relying on external scripts.

---

## 2. Where Expressions Are Used

Expressions can be used in three primary contexts:

### 2.1 Interpolation (`${ }`)
Embedded within string values.
```alp
  description: "Deploying feature ${ task.feature.name } to ${ project.environment }"
```

### 2.2 Directives (`!if`, `!assert`)
Used to conditionally include blocks or enforce rules.
```alp
@task
  id: task-deploy
  !if: "project.state == 'production'"
  !assert: "agent.role == 'devops'"
```

### 2.3 Engine Conditions
Used by engines (like the Workflow engine) to branch logic.
```alp
    - name: "Run security scan"
      task: -> task-sec-scan
      condition: "task.feature.priority == 'critical'"
```

---

## 3. Syntax & Operators

ALPEL syntax is inspired by JavaScript and Python, designed to be intuitive for developers.

### 3.1 Primitives
- **Strings:** `'hello'`, `"world"`
- **Numbers:** `42`, `3.14`
- **Booleans:** `true`, `false`
- **Null:** `null`

### 3.2 Operators
- **Comparison:** `==`, `!=`, `<`, `>`, `<=`, `>=`
- **Logical:** `&&` (AND), `||` (OR), `!` (NOT)
- **Math:** `+`, `-`, `*`, `/`
- **Collection:** `in`, `contains`

### 3.3 Property Access
Use dot notation or bracket notation to access properties of ALP objects.
```alp
  task.priority
  feature.metadata['custom_key']
```

### 3.8 Collection Iteration (v1.4.0+)

ALPEL supports basic operations over lists to power `@macro` expansions:

| Function | Syntax | Description | Example |
|---|---|---|---|
| `map` | `list.map(var => expr)` | Transforms each item | `['a', 'b'].map(x => x + '1')` → `['a1', 'b1']` |
| `filter` | `list.filter(var => expr)` | Keeps matching items | `[1, 2, 3].filter(x => x > 1)` → `[2, 3]` |
| `contains` | `list.contains(val)` | True if value exists | `['a', 'b'].contains('c')` → `false` |

**Example:**
```alp
// Used in a macro to generate tasks for every feature tagged "core"
iterate_over: "project.features.filter(f => f.tags.contains('core')).map(f => f.id)"
```

---

## 4. Evaluation Context Variables

During evaluation, ALPEL provides access to the following built-in context variables:

| Variable | Description |
|---|---|
| `project` | The global `@project` object and its properties. |
| `task` | The current `@task` object (if the expression is evaluated within a task context). |
| `feature` | The current `@feature` object. |
| `agent` | The `@agent` currently executing the engine or assigned to the task. |
| `env` | Environment variables exposed to the ALP parser (e.g., `env.CI`). |
| `state` | The current `@state` object. |

---

## 5. Built-in Functions

ALPEL provides a small standard library of safe functions for common operations.

### 5.1 String Functions
- `length(str)`: Returns string length.
- `toUpper(str)`: Converts to uppercase.
- `toLower(str)`: Converts to lowercase.
- `startsWith(str, prefix)`: Boolean check.

### 5.2 List Functions
- `size(list)`: Number of items in a list.
- `isEmpty(list)`: True if list is empty.
- `hasStatus(tasks, status)`: E.g., `hasStatus(feature.tasks, '[x]')`

### 5.3 Standard Library v2 (v10.3.0+)

ALPEL v10.3.0 introduces four new namespaces with safe utility functions.

#### `date` Namespace

| Function | Signature | Description | Example |
|---|---|---|---|
| `now` | `date.now()` | Returns current UTC ISO timestamp | `date.now()` → `'2024-06-15T12:00:00.000Z'` |
| `formatDate` | `date.formatDate(date, fmt)` | Formats a date string; `fmt` is `'iso'`, `'date'`, or `'time'` | `date.formatDate('2024-01-15T10:30:00Z', 'date')` → `'2024-01-15'` |
| `parseDate` | `date.parseDate(str)` | Parses a date string to ISO format | `date.parseDate('2024-01-15')` → `'2024-01-15T00:00:00'` |
| `addDays` | `date.addDays(date, n)` | Adds `n` days to a date string, returns ISO | `date.addDays('2024-01-15T10:30:00Z', 5)` → `'2024-01-20T10:30:00.000Z'` |

#### `math` Namespace

| Function | Signature | Description | Example |
|---|---|---|---|
| `round` | `math.round(n)` | Rounds to nearest integer | `math.round(3.7)` → `4` |
| `floor` | `math.floor(n)` | Rounds down | `math.floor(3.7)` → `3` |
| `ceil` | `math.ceil(n)` | Rounds up | `math.ceil(3.1)` → `4` |
| `min` | `math.min(a, b)` | Returns the smaller value | `math.min(3, 7)` → `3` |
| `max` | `math.max(a, b)` | Returns the larger value | `math.max(3, 7)` → `7` |
| `abs` | `math.abs(n)` | Absolute value | `math.abs(-5)` → `5` |

#### `crypto` Namespace

| Function | Signature | Description | Example |
|---|---|---|---|
| `sha256` | `crypto.sha256(str)` | SHA-256 hex digest | `crypto.sha256('hello')` → `'2cf24dba...'` |
| `base64` | `crypto.base64(str)` | Base64 encode | `crypto.base64('hello')` → `'aGVsbG8='` |
| `base64Decode` | `crypto.base64Decode(str)` | Base64 decode | `crypto.base64Decode('aGVsbG8=')` → `'hello'` |

#### `string` Namespace

| Function | Signature | Description | Example |
|---|---|---|---|
| `trim` | `string.trim(str)` | Trim whitespace | `string.trim('  hi  ')` → `'hi'` |
| `replace` | `string.replace(str, old, new)` | Replace substring | `string.replace('ab', 'a', 'z')` → `'zb'` |
| `split` | `string.split(str, delim)` | Split into array | `string.split('a,b,c', ',')` → `['a','b','c']` |
| `join` | `string.join(arr, delim)` | Join array with delimiter | `string.join(['a','b'], '-')` → `'a-b'` |
| `endsWith` | `string.endsWith(str, suffix)` | Boolean suffix check | `string.endsWith('file.txt', 'txt')` → `true` |

#### Module Imports

ALPEL v10.3.0 adds a lightweight module system for sharing reusable constants and snippets across expressions. A module is a named map of values registered by the host runtime:

```ts
// TypeScript
registerModule('helpers', { VERSION: '1.2.3', GREETING: 'hi' });
```

```python
# Python
register_module('helpers', { 'VERSION': '1.2.3', 'GREETING': 'hi' })
```

Expressions then load the module with the `import()` built-in and access its members via property access:

```alp
@task
  id: task-about
  tag: "${ import('helpers').VERSION }"
  !if: "string.endsWith(import('helpers').GREETING, 'i')"
```

Modules are read-only value maps — they cannot mutate the surrounding context, preserving the ALPEL sandbox guarantees (§6). Accessing a member that does not exist returns `null`; importing an unregistered module is an error.

**Namespace Usage Examples:**
```alp
@task
  id: task-deploy
  !if: "math.max(feature.priority_score, 0) > 50"
  tag: "${ string.trim(project.name) }-v${ date.formatDate(date.now(), 'date') }"
```

---

## 6. Execution Sandbox

ALPEL MUST be evaluated in a strict sandbox.
1. **No Mutation:** Expressions cannot change the value of any variable. They are strictly read-only.
2. **No Side Effects:** Expressions cannot make network requests, read the filesystem, or execute shell commands.
3. **Deterministic:** Given the same context state, an expression must always return the same result.
4. **Timeout:** Parsers MUST enforce an execution time limit (e.g., 100ms) per expression to prevent infinite loops (though ALPEL intentionally lacks looping constructs).

---

## 7. Examples

**Conditional Workflow Step:**
```alp
@workflow
  steps:
    - name: "Optional QA"
      task: -> task-qa
      condition: "feature.priority == 'critical' && !isEmpty(feature.tasks)"
```

**Assertion in a Task:**
```alp
@task
  id: task-deploy
  !assert: "project.state == 'testing'"
  // Task will fail to parse if the project is not in 'testing' state
```

**Complex String Interpolation:**
```alp
@artifact
  id: art-build
  path: "dist/build-${ toLower(project.name) }-v${ project.version }.tar.gz"
```
