# ALP Specification — Engines

**Version:** 7.0.0
**Status:** Stable

---

## 1. Overview

ALP defines four engines that govern how agents interact with the protocol:

| Engine | Purpose |
|---|---|
| **Loop Engine** | Iterative improvement cycles |
| **Workflow Engine** | Sequential task orchestration |
| **Context Engine** | Intelligent context loading |
| **Verification Engine** | Quality gate enforcement |

Engines are not code — they are behavioral specifications. Any ALP-conformant agent MUST implement the behaviors described here.

---

## 2. Loop Engine

The Loop Engine is the heart of ALP. It defines an iterative improvement cycle that agents follow when working on features and tasks.

### 2.1 The Loop

```
Understand → Plan → Implement → Test → Review → Reflect → Improve → Repeat
    ↑                                                                   |
    └───────────────────────────────────────────────────────────────────┘
```

Every iteration of the loop produces incrementally better output.

### 2.2 Loop Stages

| Stage | Agent Action |
|---|---|
| **Understand** | Read context, review requirements, load relevant memory |
| **Plan** | Decide what to do in this iteration, update task status |
| **Implement** | Write code, create artifacts |
| **Test** | Run tests, check acceptance criteria |
| **Review** | Self-review or peer review the work |
| **Reflect** | Evaluate quality, identify improvements |
| **Improve** | Apply improvements discovered during reflection |

### 2.3 Loop Configuration

Loops are configured via directives within `@workflow` or `@task` blocks:

```
@workflow
  id: wf-implement-feature
  !max-iterations: 10
  !fail-strategy: rollback
  !checkpoint-per-iteration: true

  @loop
    completion_conditions:
      - All acceptance criteria met
      - All required verifications pass
      - Code coverage above threshold
    failure_conditions:
      - Max iterations reached
      - Critical error encountered
      - Agent reports inability to proceed
    rollback_strategy: "Revert to last passing checkpoint"
```

### 2.4 Loop Properties

| Property | Type | Required | Default | Description |
|---|---|---|---|---|
| `max_iterations` | Number | No | 10 | Maximum loop iterations |
| `completion_conditions` | List | Yes | — | Conditions that end the loop successfully |
| `failure_conditions` | List | No | Max iterations | Conditions that end the loop as failed |
| `checkpoint_per_iteration` | Boolean | No | true | Save checkpoint after each iteration |
| `rollback_strategy` | String | No | — | What to do on failure |
| `iteration_timeout` | Duration | No | 1h | Max time per iteration |

### 2.5 Loop State

Each loop tracks its state:

```
@loop-state
  iteration: 3
  max_iterations: 10
  status: running
  started: 2025-07-14T18:00:00Z
  last_checkpoint: "chk-iter-3"
  history:
    - { iteration: 1, result: "partial", duration: "12m", notes: "Basic structure implemented" }
    - { iteration: 2, result: "partial", duration: "18m", notes: "Tests added, 2 failing" }
    - { iteration: 3, result: "in_progress", duration: null, notes: "Fixing test failures" }
```

### 2.6 Loop Completion

A loop completes when:
1. ALL `completion_conditions` are met → status: `success`
2. ANY `failure_condition` is met → status: `failed`
3. Agent explicitly terminates → status: `terminated`

On completion, the loop MUST:
- Record final state
- Create a checkpoint
- Update task/feature status
- Emit a completion `@event`

---

## 3. Workflow Engine

The Workflow Engine orchestrates multi-step, multi-agent processes.

### 3.1 Workflow Execution Model

```
Start → Step 1 → Step 2 → Step 3 → ... → End
           ↓         ↓         ↓
       on_failure on_failure on_failure
           ↓         ↓         ↓
       [strategy] [strategy] [strategy]
```

### 3.2 Step Execution Rules

1. Steps execute in the order defined in the `steps` list
2. A step only begins when its preceding step completes successfully
3. Steps with `condition` are evaluated before execution — if false, the step is skipped. The condition is evaluated as an ALPEL expression (see the [Expressions Spec](12-expressions.md)).
4. Each step is assigned to an agent via `agent` reference
5. Each step maps to a task via `task` reference

### 3.3 Workspace Workflows (v1.2.0+)

Workflows can be defined at the workspace level (`.alp/workflows.alp`). When executing a workspace-level workflow, the engine resolves qualified references (`-> project-id::task-id`) by delegating execution to the respective member projects. 

If a workspace workflow contains a `@verification` with a `cwd` field (e.g., `cwd: "-> auth-service"`), the Workflow Engine changes the working directory to the target project's path before executing the command. This allows a central workflow to drive end-to-end testing and deployment across an entire distributed platform.

### 3.4 Failure Strategies

| Strategy | Behavior |
|---|---|
| `stop` | Halt the entire workflow, mark as failed |
| `skip` | Skip the failed step, continue to next |
| `rollback` | Revert to the last checkpoint, mark as failed |
| `retry` | Retry the failed step according to retry strategy |

### 3.5 Retry Strategy

```
@workflow
  id: wf-deploy
  retry_strategy:
    max_retries: 3
    delay: 30s
    backoff: exponential    // linear, exponential, fixed
    max_delay: 5m
```

**Backoff types:**

| Type | Behavior |
|---|---|
| `fixed` | Same delay every retry |
| `linear` | Delay increases by `delay` each retry (30s, 60s, 90s) |
| `exponential` | Delay doubles each retry (30s, 60s, 120s) |

### 3.6 Parallel Steps

Steps can be marked for parallel execution:

```
@workflow
  id: wf-implement
  steps:
    - name: "Implement backend"
      agent: -> agent-backend
      task: -> task-backend
      parallel_group: "implementation"
    - name: "Implement frontend"
      agent: -> agent-frontend
      task: -> task-frontend
      parallel_group: "implementation"
    - name: "Integration test"
      agent: -> agent-qa
      task: -> task-integration
      wait_for: "implementation"    // Waits for all steps in this parallel group
```

Steps in the same `parallel_group` execute concurrently. Steps with `wait_for` block until the referenced group completes.

### 3.7 Conditional Steps

```
@workflow
  steps:
    - name: "Run security scan"
      agent: -> agent-security
      task: -> task-security-scan
      condition: "contains(feature.constraints, 'security') || feature.priority == 'critical'"
      on_skip: "Log: Security scan skipped, no security constraints"
```

---

## 4. Context Engine

The Context Engine determines what information an agent needs for a specific task, avoiding the need to load the entire project.

### 4.1 Context Loading Strategy

When an agent begins work on a task, the Context Engine:

1. **Reads the task's `@context` block** (if it exists)
2. **Traverses dependencies** to find related objects
3. **Loads relevant memory** scoped to the task and its feature
4. **Applies context scope directive** to determine depth

### 4.2 Context Scope Levels

Set via the `!context-scope` directive:

| Level | What Gets Loaded |
|---|---|
| `minimal` | Task, its acceptance criteria, its verification rules, direct dependencies only |
| `normal` | Minimal + feature context, related decisions, relevant rules, architecture notes |
| `full` | Normal + all project memory, all related features, complete dependency graph |

**Default:** `normal`

### 4.3 Context Resolution Algorithm

```
function resolveContext(task):
    context = {}
    
    // Step 1: Direct task context
    context.task = task
    context.accept = task.@accept
    context.verify = task.@verify
    
    // Step 2: Feature context
    context.feature = resolve(task.feature)
    
    // Step 3: Dependencies (follow -> references)
    context.dependencies = resolveDependencies(task.depends_on)
    
    // Step 4: Agent context
    context.agent = resolve(task.owner)
    
    // Step 5: Relevant memory
    context.memory = queryMemory(scope: task.id OR task.feature)
    
    // Step 6: Relevant rules
    context.rules = findRules(scope: task.feature OR project)
    
    // Step 7: Relevant decisions
    context.decisions = findDecisions(scope: task.feature)
    
    // Step 8: Explicit context object (if exists)
    if exists(@context for task):
        context.merge(@context)
    
    return context
```

### 4.4 Context Caching

Agents SHOULD cache resolved context for the duration of a task. Context SHOULD be invalidated when:
- A dependency's status changes
- New memory entries are added in the relevant scope
- A decision is updated

---

## 5. Verification Engine

The Verification Engine enforces quality gates. No task is complete until all required verifications pass.

### 5.1 Verification Types

| Type | What It Checks | Example Command |
|---|---|---|
| `test` | Unit/integration tests pass | `npm test -- --filter=LoginForm` |
| `lint` | Code style and quality | `eslint src/components/` |
| `security` | Security vulnerabilities | `npm audit` |
| `performance` | Performance benchmarks | `lighthouse --url=http://localhost:3000` |
| `accessibility` | Accessibility standards | `axe-core scan` |
| `documentation` | Docs exist and are current | `check-docs --coverage` |
| `formatting` | Code formatting | `prettier --check src/` |
| `custom` | Custom verification | Any command |

### 5.2 Verification Execution

```
function verifyTask(task):
    results = []
    
    for each rule in task.@verify:
        if rule.command:
            result = execute(rule.command, timeout: rule.timeout)
            results.add({
                type: rule.type,
                passed: result.exitCode == 0,
                output: result.stdout,
                duration: result.duration
            })
        else if rule.check:
            // Manual/descriptive check — agent evaluates
            result = agent.evaluate(rule.check)
            results.add({
                type: rule.type,
                passed: result,
                note: agent.explanation
            })
    
    // Check required verifications
    required_results = results.filter(r => r.required)
    all_passed = required_results.every(r => r.passed)
    
    return {
        passed: all_passed,
        results: results,
        timestamp: now()
    }
```

### 5.3 Verification Report

After verification, a report is generated:

```
@event
  id: evt-verify-task-login
  type: verification
  name: "Verification Report: task-login-ui"
  timestamp: 2025-07-14T20:30:00Z
  related_to: -> task-login-ui
  payload: |
    Results:
    ✓ test     | PASS | npm test -- --filter=LoginForm     | 3.2s
    ✓ lint     | PASS | eslint src/components/auth/         | 1.1s
    ✓ a11y     | PASS | axe-core form accessibility         | 0.8s
    ✗ perf     | FAIL | Lighthouse score 72 (threshold: 80) | 12.4s
    
    Required: 3/3 passed
    Optional: 0/1 passed
    Overall: PASS (required checks passed)
```

### 5.4 Verification Cascading

When a task is verified, the engine SHOULD also check:
1. All `@accept` criteria are marked `[x]`
2. All `@artifact` files exist at their declared paths
3. All downstream tasks that depend on this task are notified

### 5.5 Continuous Verification

Agents SHOULD run verification:
- After every implementation loop iteration
- Before marking a task as `[x]`
- Before transitioning a feature's lifecycle stage
- During the `verify` lifecycle stage (runs ALL checks, not just required)
