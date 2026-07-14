# ALP Specification — Lifecycle

**Version:** 2.0.0
**Status:** Stable

---

## 1. Overview

ALP defines a deterministic lifecycle that every feature progresses through. The lifecycle ensures that work follows a structured, verifiable path from discovery to completion.

The lifecycle is NOT optional. Every `@feature` MUST declare its current `lifecycle_stage`. Agents MUST respect the lifecycle ordering when planning and executing work.

---

## 2. Lifecycle Stages

Every feature progresses through these 10 stages in order:

```
discover → understand → plan → design → implement → test → review → refactor → verify → complete
```

### 2.1 Stage Definitions

#### Stage 1: `discover`

**Purpose:** Identify what needs to be built.

| Property | Value |
|---|---|
| Inputs | User requirements, PRD, stakeholder needs |
| Outputs | Feature description, initial scope |
| Verification | Feature has a clear description and scope |
| Completion Rule | Feature is understood well enough to analyze |

**Agent actions:**
- Read project goals
- Identify the feature's purpose
- Define initial scope boundaries
- Create the `@feature` object

---

#### Stage 2: `understand`

**Purpose:** Deeply analyze requirements and context.

| Property | Value |
|---|---|
| Inputs | Feature description, project context, existing codebase |
| Outputs | Detailed requirements, edge cases, constraints |
| Verification | All requirements documented, no ambiguity |
| Completion Rule | Agent can explain the feature without external input |

**Agent actions:**
- Analyze existing code that relates to this feature
- Identify edge cases
- Document business rules
- Identify constraints and dependencies
- Create `@context` object for this feature
- Record unknowns in `@memory` entries

---

#### Stage 3: `plan`

**Purpose:** Break the feature into atomic tasks.

| Property | Value |
|---|---|
| Inputs | Detailed requirements, architecture, dependencies |
| Outputs | Task list with dependencies, estimates, assignments |
| Verification | All tasks have acceptance criteria and verification rules |
| Completion Rule | Task graph is complete and acyclic |

**Agent actions:**
- Create `@task` objects for each unit of work
- Define `depends_on` relationships
- Estimate time and difficulty for each task
- Assign agents to tasks
- Define acceptance criteria for each task
- Define verification rules for each task
- Build the dependency graph

---

#### Stage 4: `design`

**Purpose:** Design the technical approach.

| Property | Value |
|---|---|
| Inputs | Task list, architecture, constraints |
| Outputs | Technical design, API contracts, data models |
| Verification | Design reviewed, decisions documented |
| Completion Rule | All significant design decisions are recorded |

**Agent actions:**
- Define data models and schemas
- Design API contracts
- Choose implementation patterns
- Record decisions in `@decision` objects
- Update `@context` objects with architecture details
- Identify potential risks and document them

---

#### Stage 5: `implement`

**Purpose:** Write the code.

| Property | Value |
|---|---|
| Inputs | Task list, design, context |
| Outputs | Source code, configurations |
| Verification | Code compiles/lints, basic functionality works |
| Completion Rule | All tasks are implemented |

**Agent actions:**
- Execute tasks in dependency order
- Write source code
- Create `@artifact` objects for each file produced
- Update task status markers
- Record errors in `@memory` entries
- Checkpoint progress regularly

---

#### Stage 6: `test`

**Purpose:** Verify the implementation works correctly.

| Property | Value |
|---|---|
| Inputs | Implemented code, acceptance criteria |
| Outputs | Test results, coverage reports |
| Verification | All tests pass, coverage meets threshold |
| Completion Rule | All `@verify` blocks with `required: true` pass |

**Agent actions:**
- Write unit tests
- Write integration tests
- Run `@verify` commands
- Record test results
- Fix failing tests
- Update `@accept` criteria status markers

---

#### Stage 7: `review`

**Purpose:** Quality assurance and code review.

| Property | Value |
|---|---|
| Inputs | Implemented and tested code |
| Outputs | Review feedback, approval or revision requests |
| Verification | All review criteria satisfied |
| Completion Rule | Review approved by designated agent |

**Agent actions:**
- Review code for quality, patterns, and standards
- Check compliance with `@rule` objects
- Check compliance with `@constraint` objects
- Provide feedback
- Request changes if needed
- Approve when all criteria met

---

#### Stage 8: `refactor`

**Purpose:** Improve code quality without changing behavior.

| Property | Value |
|---|---|
| Inputs | Reviewed code, improvement suggestions |
| Outputs | Refactored code |
| Verification | All existing tests still pass |
| Completion Rule | Code meets quality standards, no regressions |

**Agent actions:**
- Improve code structure
- Reduce duplication
- Improve naming
- Optimize performance
- Ensure all tests still pass after changes

---

#### Stage 9: `verify`

**Purpose:** Final verification before marking complete.

| Property | Value |
|---|---|
| Inputs | Refactored code, all verification rules |
| Outputs | Final verification report |
| Verification | ALL verification rules pass (not just required ones) |
| Completion Rule | Zero failures in verification report |

**Agent actions:**
- Run ALL `@verify` blocks (required AND optional)
- Run security checks
- Run performance checks
- Run accessibility checks
- Generate verification report
- Record results in `@event` objects

---

#### Stage 10: `complete`

**Purpose:** Feature is done.

| Property | Value |
|---|---|
| Inputs | Verification report |
| Outputs | Updated project state, completion event |
| Verification | Verification report shows all pass |
| Completion Rule | Feature marked complete, state updated |

**Agent actions:**
- Mark all tasks as `[x]`
- Update feature `lifecycle_stage` to `complete`
- Update feature `progress` to 100
- Update project state if needed
- Create milestone `@event`
- Update `@memory` with lessons learned
- Update `@state` checkpoint

---

## 3. State Transitions

### 3.1 Valid Transitions

The lifecycle is primarily linear, but the following backward transitions are allowed:

```
discover → understand → plan → design → implement → test → review → refactor → verify → complete
                                            ↑                  ↑
                                            └──── review ──────┘  (review can send back to implement)
                                            ↑         ↑
                                            └─ test ──┘  (test failures can send back to implement)
                                                               ↑
                                            refactor ──────────┘  (refactor can go back to test)
                                                                          ↑
                                            verify ───────────────────────┘  (verify can go back to refactor)
```

**Forward transitions:** Any stage can advance to the next stage in sequence.

**Backward transitions (allowed):**

| From | To | Reason |
|---|---|---|
| `test` | `implement` | Test failures require code changes |
| `review` | `implement` | Review feedback requires changes |
| `refactor` | `test` | Must re-verify after refactoring |
| `verify` | `refactor` | Final verification found issues |
| `verify` | `implement` | Critical issues found in final check |

**Invalid transitions (NOT allowed):**

| From | To | Why |
|---|---|---|
| `implement` | `discover` | Cannot go back to discovery after implementation |
| `complete` | Any | Completed features do not reopen (create a new feature) |
| `plan` | `implement` | Cannot skip design |
| `discover` | `implement` | Cannot skip planning and design |

### 3.2 Transition Recording

Every stage transition MUST be recorded in the feature's `@lifecycle` block or in an `@event` object:

```
@event
  id: evt-auth-to-implement
  type: state_change
  name: "feat-auth moved to implement"
  payload: |
    Previous stage: design
    New stage: implement
    Reason: Design review approved, ready to implement
    Tasks ready: 5
  timestamp: 2025-07-14T14:00:00Z
  source: -> agent-planner
  related_to: -> feat-auth
```

---

## 4. Project State Machine

Separate from the feature lifecycle, the project itself has a state:

```
planning → architecture → development → testing → review → completed
    ↓          ↓              ↓            ↓         ↓
  blocked    blocked        blocked      blocked   blocked
    ↓          ↓              ↓            ↓         ↓
  waiting    waiting        waiting      waiting   waiting
```

### 4.1 Project States

| State | Description | Entry Condition |
|---|---|---|
| `planning` | Initial planning phase | Project created |
| `architecture` | Defining architecture | Planning complete |
| `development` | Active development | Architecture approved |
| `testing` | Integration/system testing | Core features implemented |
| `review` | Final review before release | Testing complete |
| `completed` | Project is done | All features verified |
| `blocked` | Cannot proceed | External dependency or issue |
| `waiting` | Waiting for external input | Decision or resource needed |
| `archived` | No longer active | Post-completion or abandoned |

### 4.2 Valid Project State Transitions

| From | To | Condition |
|---|---|---|
| `planning` | `architecture` | Project goals and features defined |
| `architecture` | `development` | Architecture decisions documented |
| `development` | `testing` | Core features in `test` or `review` lifecycle stage |
| `testing` | `review` | All critical tests passing |
| `review` | `completed` | Final verification passed |
| `completed` | `archived` | Project archived |
| Any | `blocked` | Blocking issue identified |
| Any | `waiting` | Waiting for external input |
| `blocked` | Previous state | Blocking issue resolved |
| `waiting` | Previous state | Input received |

---

## 5. Checkpoint System

Checkpoints capture project state at a point in time, enabling recovery after interruption.

### 5.1 When to Checkpoint

Agents SHOULD create a checkpoint:
- After completing any task
- After a lifecycle stage transition
- Before any risky operation
- At the end of any agent session

### 5.2 Checkpoint Format

Checkpoints are recorded in `.alp/state.alp`:

```
@state
  id: state-project
  current: development
  checkpoint: "chk-2025-07-14-003"
  checkpoint_timestamp: 2025-07-14T20:30:00Z
```

### 5.3 Resuming from Checkpoint

When an agent begins a new session, it SHOULD:

1. Read `.alp/state.alp` to find the latest checkpoint
2. Read `.alp/memory.alp` to load relevant memory
3. Identify incomplete tasks (status `[~]` or `[ ]`)
4. Resume work from the highest-priority incomplete task
5. Respect dependency ordering

---

## 6. Lifecycle Compliance

### 6.1 Mandatory Rules

1. Features MUST NOT skip lifecycle stages (forward)
2. Features in `complete` MUST NOT be reopened
3. All tasks in a feature MUST be `[x]` before the feature can reach `complete`
4. All `required: true` verifications MUST pass before `complete`
5. Backward transitions MUST record the reason in an `@event`

### 6.2 Agent Responsibilities

| Lifecycle Stage | Responsible Agent Role |
|---|---|
| `discover` | `planner` |
| `understand` | `planner`, `architect` |
| `plan` | `planner` |
| `design` | `architect` |
| `implement` | `frontend`, `backend`, `fullstack` |
| `test` | `qa`, implementing agent |
| `review` | `reviewer` |
| `refactor` | implementing agent |
| `verify` | `qa` |
| `complete` | `planner` (marks complete) |
