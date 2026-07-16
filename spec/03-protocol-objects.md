# ALP Specification — Protocol Objects

**Version:** 2.0.0
**Status:** Stable

---

## 1. Common Fields

Every protocol object MUST have these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique identifier within its object type |
| `version` | String | No | Semantic version of this object (default: `0.1.0`) |
| `created` | DateTime | No | When this object was created |
| `updated` | DateTime | No | When this object was last modified |
| `tags` | List | No | Arbitrary key-value tags for filtering |
| `description` | String | No | Human/agent-readable description |

**Example:**
```
@<type>
  id: my-object
  version: 1.0.0
  created: 2025-07-14T18:00:00Z
  updated: 2025-07-14T20:30:00Z
  tags:
    - { key: "team", value: "backend" }
    - { key: "sprint", value: "3" }
  description: "A sample protocol object"
```

---

## 2. Project — `@project`

The root object. Every ALP project MUST have exactly one `@project` object, defined in `.alp/project.alp`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Project identifier |
| `name` | String | Yes | Human-readable project name |
| `version` | String | Yes | Project version (semver) |
| `workspace` | Ref | No | Reference to parent workspace (v0.5.0+) |
| `description` | String | No | Project description |
| `state` | Enum | Yes | Current project state (see State Engine) |
| `language` | String | No | Primary programming language |
| `framework` | String | No | Primary framework |
| `repository` | String | No | Repository URL |
| `goals` | List | No | Project-level goals (inline or `-> goal-id`) |
| `features` | List[Ref] | No | References to features |
| `agents` | List[Ref] | No | References to agents |
| `constraints` | List[Ref] | No | References to constraints |
| `rules` | List[Ref] | No | References to rules |

**Example:**
```
!alp-version: 0.1.0

@project
  id: healthcare-platform
  name: "Healthcare Management Platform"
  version: 0.1.0
  description: |
    A comprehensive healthcare platform for managing patients,
    doctors, appointments, and billing.
  state: development
  language: typescript
  framework: next.js
  repository: "https://github.com/org/healthcare-platform"
  goals:
    - -> goal-mvp-launch
    - -> goal-hipaa-compliance
  features:
    - -> feat-auth
    - -> feat-patients
    - -> feat-appointments
    - -> feat-billing
  agents:
    - -> agent-planner
    - -> agent-frontend
    - -> agent-backend
  constraints:
    - -> constraint-hipaa
    - -> constraint-performance
  rules:
    - -> rule-typescript-strict
    - -> rule-test-coverage
```

---

## 3. Feature — `@feature`

A feature is a high-level capability of the project. Features contain tasks and progress through the lifecycle.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Feature identifier |
| `name` | String | Yes | Feature name |
| `description` | String | No | What this feature does |
| `lifecycle_stage` | Enum | Yes | Current lifecycle stage |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `tasks` | List[Ref] | No | Tasks that implement this feature |
| `depends_on` | List[Ref] | No | Features this depends on |
| `acceptance_criteria` | List | No | Conditions for feature completion |
| `goals` | List[Ref] | No | Goals this feature contributes to |
| `constraints` | List[Ref] | No | Constraints on this feature |
| `progress` | Number | No | Percentage complete (0-100) |

**Lifecycle stages:**
`discover` → `understand` → `plan` → `design` → `implement` → `test` → `review` → `refactor` → `verify` → `complete`

**Example:**
```
@feature
  id: feat-auth
  name: "User Authentication"
  description: |
    Complete user authentication system with login, registration,
    password reset, and session management.
  lifecycle_stage: implement
  priority: critical
  progress: 35
  depends_on: []
  tasks:
    - -> task-login-ui
    - -> task-register-ui
    - -> task-auth-api
    - -> task-db-users
    - -> task-jwt-service
  acceptance_criteria:
    - Users can register with email and password
    - Users can log in and receive a JWT
    - Users can reset their password via email
    - Sessions expire after 24 hours
    - All auth endpoints are rate-limited
  goals:
    - -> goal-mvp-launch
  constraints:
    - -> constraint-hipaa
```

---

## 4. Task — `@task`

Tasks are the atomic units of work. Every piece of implementation work is represented as a task.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Task identifier |
| `name` | String | Yes | Task name |
| `description` | String | No | Detailed description |
| `status` | Status | Yes | Current status marker |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `difficulty` | Enum | No | `trivial`, `easy`, `medium`, `hard`, `complex` |
| `estimated_time` | Duration | No | Estimated time to complete |
| `actual_time` | Duration | No | Actual time spent |
| `feature` | Ref | No | Parent feature reference |
| `owner` | Ref | No | Agent assigned to this task |
| `depends_on` | List[Ref] | No | Tasks that must complete first |
| `blocks` | List[Ref] | No | Tasks that this task blocks |
| `artifacts` | List[Ref] | No | Artifacts produced by this task |

**Nested blocks allowed:** `@accept`, `@verify`, `@artifact`

**Example:**
```
@task
  id: task-login-ui
  name: "Build Login Page"
  description: |
    Create a responsive login form component with email/password
    fields, form validation, error handling, and loading states.
  status: [~]
  priority: high
  difficulty: medium
  estimated_time: 4h
  feature: -> feat-auth
  owner: -> agent-frontend
  depends_on:
    - -> task-auth-api
    - -> task-design-system
  blocks:
    - -> task-dashboard-ui

  @accept
    - [ ] Login form renders with email and password fields
    - [ ] Client-side validation (email format, password min length)
    - [ ] Loading spinner during API call
    - [ ] Error message on invalid credentials
    - [ ] Redirect to dashboard on success
    - [ ] "Forgot password" link present

  @verify
    - type: test
      command: "npm test -- --filter=LoginForm"
      required: true
    - type: lint
      command: "eslint src/components/auth/LoginForm.tsx"
      required: true
    - type: accessibility
      check: "WCAG 2.1 AA - form labels, focus management"
      required: true

  @artifact
    id: art-login-component
    type: component
    path: "src/components/auth/LoginForm.tsx"
```

---

## 5. Workflow — `@workflow`

A workflow defines a sequence of steps to accomplish a goal. Workflows orchestrate tasks and agents.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Workflow identifier |
| `name` | String | Yes | Workflow name |
| `goal` | String | Yes | What this workflow accomplishes |
| `inputs` | List | No | Required inputs |
| `outputs` | List | No | Expected outputs |
| `steps` | List | Yes | Ordered steps to execute |
| `agents` | List[Ref] | No | Agents involved |
| `dependencies` | List[Ref] | No | Workflows that must run first |
| `fail_strategy` | Enum | No | `stop`, `skip`, `rollback`, `retry` |
| `retry_strategy` | Object | No | `max_retries`, `delay`, `backoff` |
| `completion_rules` | List | No | Conditions for workflow completion |

**Step object fields:**
- `name`: Step name
- `task`: Reference to a task
- `agent`: Reference to agent that executes this step
- `condition`: Optional condition for execution
- `on_success`: Next step or action
- `on_failure`: Failure handling action

**Example:**
```
@workflow
  id: wf-feature-implementation
  name: "Feature Implementation Workflow"
  goal: "Implement a feature from design to verified completion"
  !fail-strategy: rollback
  inputs:
    - Feature specification
    - Architecture context
    - Design system tokens
  outputs:
    - Implemented and tested feature
    - Updated documentation
    - Verification report
  agents:
    - -> agent-planner
    - -> agent-frontend
    - -> agent-backend
    - -> agent-qa
  steps:
    - name: "Analyze requirements"
      agent: -> agent-planner
      task: -> task-analyze-requirements
      on_success: "Create implementation plan"
      on_failure: "Request clarification"
    - name: "Create implementation plan"
      agent: -> agent-planner
      task: -> task-create-plan
      on_success: "Implement backend"
      on_failure: "Re-analyze requirements"
    - name: "Implement backend"
      agent: -> agent-backend
      task: -> task-implement-backend
      on_success: "Implement frontend"
      on_failure: "Debug and retry"
    - name: "Implement frontend"
      agent: -> agent-frontend
      task: -> task-implement-frontend
      on_success: "Run tests"
      on_failure: "Debug and retry"
    - name: "Run tests"
      agent: -> agent-qa
      task: -> task-run-tests
      on_success: "Complete"
      on_failure: "Fix and re-test"
  completion_rules:
    - All tasks completed
    - All tests passing
    - Code review approved
```

---

## 6. Agent — `@agent`

Agents represent AI systems or specialized roles that work on the project.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Agent identifier |
| `name` | String | Yes | Agent display name |
| `role` | Enum | Yes | Agent role (see below) |
| `description` | String | No | What this agent does |
| `responsibilities` | List | Yes | What this agent is responsible for |
| `permissions` | List | Yes | What this agent is allowed to do |
| `tools` | List | No | Tools available to this agent |
| `goals` | List | No | Agent's current goals |
| `limits` | Object | No | Resource limits and constraints |
| `model` | String | No | AI model identifier (if applicable) |

**Roles:**
`planner`, `architect`, `frontend`, `backend`, `database`, `security`, `qa`, `reviewer`, `devops`, `documentation`, `fullstack`, `custom`

**Permissions:**
`read`, `write`, `execute`, `delete`, `deploy`, `approve`, `admin`

**Example:**
```
@agent
  id: agent-frontend
  name: "Frontend Engineer"
  role: frontend
  description: "Specializes in React/TypeScript UI development"
  responsibilities:
    - Build user interface components
    - Implement responsive designs
    - Handle client-side state management
    - Write component tests
    - Ensure accessibility compliance
  permissions:
    - read
    - write
    - execute
  tools:
    - react
    - typescript
    - css
    - jest
    - playwright
  goals:
    - Complete all assigned UI tasks
    - Maintain test coverage above 80%
    - Follow design system guidelines
  limits:
    max_files_per_task: 10
    max_lines_per_file: 500
    requires_review: true
```

---

## 7. Memory — `@memory`

Memory entries store persistent knowledge that survives across agent sessions.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Memory identifier |
| `type` | Enum | Yes | Memory type (see below) |
| `key` | String | Yes | Lookup key |
| `value` | String | Yes | Stored value (can be multi-line) |
| `scope` | Ref | No | Scoped to a specific object |
| `ttl` | Duration | No | Time-to-live before expiry |
| `importance` | Enum | No | `critical`, `high`, `medium`, `low` |
| `source` | String | No | What created this memory entry |

**Memory types:**
`project`, `architecture`, `feature`, `task`, `decision`, `error`, `agent`, `knowledge`, `conversation`, `context`

**Example:**
```
@memory
  id: mem-auth-strategy
  type: decision
  key: "authentication-strategy"
  value: |
    Using JWT with refresh tokens. Access tokens expire in 15 minutes.
    Refresh tokens expire in 7 days. Tokens stored in httpOnly cookies.
    Chose JWT over session-based auth for statelessness and scalability.
  scope: -> feat-auth
  importance: critical
  source: "agent-architect"

---

@memory
  id: mem-db-migration-issue
  type: error
  key: "prisma-migration-timestamp-bug"
  value: |
    Prisma migrations fail if the database timezone is not UTC.
    Workaround: Set DATABASE_TIMEZONE=UTC in .env before running migrations.
  scope: -> task-db-setup
  importance: high
  source: "agent-backend"
  ttl: 90d
```

---

## 8. State — `@state`

Tracks the overall project state and transition history.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | State identifier |
| `current` | Enum | Yes | Current project state |
| `previous` | Enum | No | Previous state |
| `checkpoint` | String | No | Last checkpoint identifier |
| `checkpoint_timestamp` | DateTime | No | When checkpoint was created |
| `history` | List | No | State transition history |

**Project states:**
`planning`, `architecture`, `development`, `testing`, `blocked`, `waiting`, `review`, `completed`, `archived`

**Example:**
```
@state
  id: state-project
  current: development
  previous: architecture
  checkpoint: "chk-2025-07-14-001"
  checkpoint_timestamp: 2025-07-14T18:00:00Z
  history:
    - { from: "planning", to: "architecture", timestamp: "2025-07-01T10:00:00Z", reason: "Architecture design approved" }
    - { from: "architecture", to: "development", timestamp: "2025-07-10T14:00:00Z", reason: "Architecture review complete, ready to build" }
```

---

## 9. Artifact — `@artifact`

Artifacts are files or outputs generated by tasks.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Artifact identifier |
| `type` | Enum | Yes | Artifact type (see below) |
| `name` | String | No | Display name |
| `path` | String | Yes | File path relative to project root |
| `task` | Ref | No | Task that produced this artifact |
| `version` | String | No | Artifact version |
| `checksum` | String | No | SHA-256 hash of file contents |
| `status` | Enum | No | `draft`, `final`, `deprecated` |

**Artifact types:**
`component`, `api`, `migration`, `schema`, `test`, `documentation`, `diagram`, `configuration`, `script`, `stylesheet`, `asset`, `other`

**Example:**
```
@artifact
  id: art-login-component
  type: component
  name: "Login Form Component"
  path: "src/components/auth/LoginForm.tsx"
  task: -> task-login-ui
  version: 1.0.0
  status: final
```

---

## 10. Decision — `@decision`

Records important architectural or design decisions for future agents to understand.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Decision identifier |
| `title` | String | Yes | What was decided |
| `reason` | String | Yes | Why this decision was made |
| `alternatives` | List | No | Other options considered |
| `tradeoffs` | List | No | Known tradeoffs |
| `outcome` | String | No | Result of the decision |
| `decided_by` | Ref | No | Agent that made the decision |
| `scope` | Ref | No | Feature or task this relates to |
| `status` | Enum | No | `proposed`, `accepted`, `rejected`, `superseded` |

**Example:**
```
@decision
  id: dec-jwt-over-sessions
  title: "Use JWT tokens instead of server-side sessions"
  reason: |
    The application needs to scale horizontally across multiple servers.
    JWT tokens are stateless and don't require shared session storage.
  alternatives:
    - "Server-side sessions with Redis"
    - "OAuth2 only (no custom auth)"
    - "Session cookies with sticky sessions"
  tradeoffs:
    - "Cannot revoke individual tokens without a blacklist"
    - "Token payload increases request size"
    - "Must handle token refresh flow"
  outcome: "Accepted — implementing with 15-minute access tokens and 7-day refresh tokens"
  decided_by: -> agent-architect
  scope: -> feat-auth
  status: accepted
```

---

## 11. Constraint — `@constraint`

Constraints define boundaries and requirements that must be respected.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Constraint identifier |
| `name` | String | Yes | Constraint name |
| `type` | Enum | Yes | `technical`, `business`, `security`, `performance`, `legal`, `accessibility` |
| `description` | String | Yes | What this constraint requires |
| `severity` | Enum | Yes | `mandatory`, `recommended`, `optional` |
| `enforced_by` | Ref | No | Agent or verification that enforces this |
| `scope` | Ref | No | What this constraint applies to |

**Example:**
```
@constraint
  id: constraint-hipaa
  name: "HIPAA Compliance"
  type: security
  description: |
    All patient health information (PHI) must be encrypted at rest and
    in transit. Access logs must be maintained for all PHI access.
    Data retention policies must comply with HIPAA regulations.
  severity: mandatory
  scope: -> healthcare-platform
```

---

## 12. Verification — `@verification`

Defines how to verify that work meets quality standards. Can be standalone or nested within `@task`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes (standalone) | Verification identifier |
| `type` | Enum | Yes | `test`, `lint`, `security`, `performance`, `accessibility`, `documentation`, `formatting`, `custom` |
| `name` | String | No | Verification name |
| `command` | String | Yes (if script/test) | Shell command to execute |
| `cwd` | String | No | Directory to execute in (default: project root). Can be a project ref `-> id` (v1.2.0+) |
| `check` | String | Yes (if manual) | Description of the manual check |
| `expected_result` | String | No | What a passing result looks like |
| `required` | Boolean | Yes | Whether this must pass |
| `timeout` | Duration | No | Maximum execution time |
| `scope` | Ref | No | What this verifies |

**Example (standalone):**
```
@verification
  id: verify-test-suite
  type: test
  name: "Full Test Suite"
  command: "npm test -- --coverage"
  cwd: "-> auth-service"
  expected_result: "All tests pass, coverage > 80%"
  required: true
  timeout: 5m
  scope: -> healthcare-platform
```

---

## 13. Dependency — `@dependency`

Explicitly declares relationships between objects for the dependency graph.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Dependency identifier |
| `from` | Ref | Yes | The dependent object |
| `to` | Ref | Yes | The object being depended on |
| `type` | Enum | Yes | `blocks`, `requires`, `extends`, `uses`, `implements` |
| `description` | String | No | Why this dependency exists |

**Dependency types:**

| Type | Meaning |
|---|---|
| `blocks` | `from` cannot start until `to` is complete |
| `requires` | `from` needs `to` to exist but doesn't need it complete |
| `extends` | `from` extends the functionality of `to` |
| `uses` | `from` uses `to` at runtime |
| `implements` | `from` is an implementation of `to` |

**Example:**
```
@dependency
  id: dep-login-needs-api
  from: -> task-login-ui
  to: -> task-auth-api
  type: blocks
  description: "Login UI needs the auth API endpoints to exist"

---

@dependency
  id: dep-dashboard-uses-auth
  from: -> feat-dashboard
  to: -> feat-auth
  type: uses
  description: "Dashboard requires authentication to access"
```

> **Note:** Dependencies can also be declared inline using `depends_on` within tasks and features. Standalone `@dependency` objects provide more detail and enable typed relationships.

---

## 14. Resource — `@resource`

Describes external resources the project interacts with.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Resource identifier |
| `type` | Enum | Yes | `file`, `api`, `database`, `service`, `config`, `secret`, `cdn`, `storage` |
| `name` | String | Yes | Resource name |
| `path` | String | No | Path, URL, or connection string |
| `description` | String | No | What this resource is |
| `environment` | Enum | No | `development`, `staging`, `production`, `all` |

**Example:**
```
@resource
  id: res-postgres
  type: database
  name: "Primary PostgreSQL Database"
  path: "postgresql://localhost:5432/healthcare"
  description: "Stores all application data including users, patients, appointments"
  environment: development

---

@resource
  id: res-auth-api
  type: api
  name: "Authentication API"
  path: "/api/v1/auth"
  description: "REST API endpoints for user authentication"
```

---

## 15. Event — `@event`

Records significant events that occurred during the project lifecycle.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Event identifier |
| `type` | Enum | Yes | `state_change`, `task_complete`, `error`, `decision`, `checkpoint`, `deployment`, `milestone` |
| `name` | String | No | Event name |
| `payload` | String | No | Event data (structured or free-form) |
| `timestamp` | DateTime | Yes | When the event occurred |
| `source` | Ref | No | Agent or object that triggered this event |
| `related_to` | Ref | No | Object this event relates to |

**Example:**
```
@event
  id: evt-auth-complete
  type: milestone
  name: "Authentication Feature Complete"
  payload: |
    All 5 tasks completed. 23 tests passing. 92% code coverage.
    JWT implementation reviewed and approved.
  timestamp: 2025-07-14T20:30:00Z
  source: -> agent-qa
  related_to: -> feat-auth
```

---

## 16. Goal — `@goal`

High-level objectives the project aims to achieve.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Goal identifier |
| `name` | String | Yes | Goal name |
| `description` | String | Yes | What success looks like |
| `success_criteria` | List | Yes | Measurable criteria |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `deadline` | Date | No | Target completion date |
| `progress` | Number | No | Percentage complete (0-100) |
| `features` | List[Ref] | No | Features contributing to this goal |
| `status` | Status | No | Current status |

**Example:**
```
@goal
  id: goal-mvp-launch
  name: "MVP Launch"
  description: "Launch the minimum viable product with core features"
  priority: critical
  deadline: 2025-09-01
  progress: 25
  status: [~]
  success_criteria:
    - User authentication working (login, register, logout)
    - Patient management CRUD operations
    - Appointment scheduling
    - Basic dashboard with key metrics
    - Deployed to production
  features:
    - -> feat-auth
    - -> feat-patients
    - -> feat-appointments
    - -> feat-dashboard
```

---

## 17. Context — `@context`

Defines what information an agent needs to work on a specific task. Used by the context engine to load only relevant data.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Context identifier |
| `task` | Ref | Yes | Task this context is for |
| `relevant_files` | List | No | File paths the agent should read |
| `architecture` | String | No | Relevant architecture notes |
| `dependencies` | List[Ref] | No | Related dependency objects |
| `rules` | List[Ref] | No | Rules the agent must follow |
| `business_logic` | List | No | Relevant business rules |
| `decisions` | List[Ref] | No | Past decisions to be aware of |
| `knowledge` | List[Ref] | No | Related memory entries |

**Example:**
```
@context
  id: ctx-task-login-ui
  task: -> task-login-ui
  relevant_files:
    - "src/components/auth/"
    - "src/hooks/useAuth.ts"
    - "src/api/auth.ts"
    - "src/styles/forms.css"
  architecture: |
    The auth system uses JWT tokens stored in httpOnly cookies.
    The login form component communicates with the auth API via
    the useAuth hook. Form state is managed locally with useState.
  dependencies:
    - -> dep-login-needs-api
  rules:
    - -> rule-typescript-strict
    - -> rule-accessibility
  business_logic:
    - "Email must be validated with RFC 5322 regex"
    - "Password minimum 8 characters, 1 uppercase, 1 number"
    - "Lock account after 5 failed login attempts"
  decisions:
    - -> dec-jwt-over-sessions
    - -> dec-react-hook-form
  knowledge:
    - -> mem-auth-strategy
    - -> mem-design-system-tokens
```

---

## 18. Rule — `@rule`

Defines coding standards, architectural rules, or policies agents must follow.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Rule identifier |
| `name` | String | Yes | Rule name |
| `type` | Enum | Yes | `coding`, `architecture`, `security`, `naming`, `testing`, `documentation`, `performance`, `custom` |
| `description` | String | Yes | What the rule requires |
| `enforcement` | Enum | Yes | `error`, `warning`, `info` |
| `pattern` | String | No | Regex or glob pattern for automated checking |
| `scope` | Ref | No | What this rule applies to |
| `examples` | List | No | Good and bad examples |

**Example:**
```
@rule
  id: rule-typescript-strict
  name: "TypeScript Strict Mode"
  type: coding
  description: |
    All TypeScript files must compile with strict mode enabled.
    No use of 'any' type. No implicit returns. No unused variables.
  enforcement: error
  pattern: "tsconfig.json -> strict: true"
  examples:
    - { good: "const name: string = getName()", bad: "const name: any = getName()" }
    - { good: "function add(a: number, b: number): number { return a + b }", bad: "function add(a, b) { return a + b }" }

---

@rule
  id: rule-test-coverage
  name: "Minimum Test Coverage"
  type: testing
  description: "All modules must maintain at least 80% test coverage"
  enforcement: error
  pattern: "coverage >= 80%"

---

@rule
  id: rule-component-naming
  name: "Component File Naming"
  type: naming
  description: "React components must use PascalCase file names"
  enforcement: warning
  pattern: "src/components/**/*.tsx -> PascalCase"
  examples:
    - { good: "LoginForm.tsx", bad: "loginForm.tsx" }
    - { good: "PatientCard.tsx", bad: "patient-card.tsx" }
```

---

## 19. Workspace — `@workspace`

Groups multiple ALP projects together. Defined in `workspace.alp` at the workspace root.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Workspace identifier |
| `name` | String | Yes | Human-readable workspace name |
| `version` | String | No | Workspace version (semver) |
| `description` | String | No | Workspace description |
| `projects` | List[Obj] | Yes | Member project declarations (`path`, `url`, `glob`, `branch`, `commit`, `id`, `description`) |
| `workspaces` | List[Obj] | No | Linked remote or local workspaces (`path`, `url`, `id`) (v1.3.0+) |
| `shared_agents` | List[Ref] | No | Agents available to all member projects |
| `shared_rules` | List[Ref] | No | Rules enforced across all member projects |
| `shared_constraints`| List[Ref] | No | Constraints applied across all member projects |
| `shared_memory` | List[Ref] | No | Memory entries visible to all member projects |

**Example:**
```
@workspace
  id: healthcare-platform
  name: "Healthcare Platform"
  projects:
    - { glob: "services/*" }
    - { url: "git+https://github.com/org/billing.git", branch: "main", id: billing-service }
  workspaces:
    - { url: "git+https://github.com/org/design-system-ws.git", id: ui-core }
  shared_agents:
    - -> agent-devops
```

---

## 20. Macro — `@macro` (v1.4.0+)

Macros allow dynamic generation of multiple objects using ALPEL and an iterable data source. The parser expands macros into concrete protocol objects before dependency resolution.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Macro identifier |
| `name` | String | No | Macro description |
| `iterate_over` | ALPEL | Yes | ALPEL expression returning a list of items |
| `as` | String | No | The variable name to bind to the item (default: `item`) |
| `template` | Block | Yes | The template block that will be duplicated |

**Example:**
```alp
@macro
  id: generate-service-tasks
  iterate_over: "['auth', 'billing', 'notifications']"
  as: "service"
  template:
    @task
      id: "task-deploy-${service}"
      name: "Deploy ${service} service"
      owner: -> agent-devops
```

When parsed, this expands into three individual `@task` objects.

---

## 21. Plugin — `@plugin`

Declares an external plugin that extends the ALP parser with new capabilities or custom types.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Plugin identifier |
| `name` | String | Yes | Human-readable plugin name |
| `version` | String | Yes | Plugin version (semver format) |
| `description` | String | No | What this plugin provides |
| `author` | String | No | Author of the plugin |
| `types` | List[Ref] | No | References to `@type_definition` objects exported by this plugin |
| `dependencies` | List[Obj] | No | Plugins this plugin depends on (v0.6.0+) |

**Example:**
```
@plugin
  id: plugin-scrum
  name: "Scrum Extension"
  version: 1.0.0
  description: "Adds Agile/Scrum object types like Epics and Sprints"
  author: "ALP Community"
  dependencies:
    - { plugin: "@alp/core-types", version: "^1.0.0" }
  types:
    - -> type-epic
    - -> type-sprint
```

---

## 22. Type Definition — `@type_definition`

Defines a custom object type that extends the core ALP protocol.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Type identifier |
| `type_name` | String | Yes | The keyword used for the block marker (e.g., `epic` for `@epic`) |
| `description` | String | No | What this custom type represents |
| `properties` | List[Obj] | Yes | Schema definitions for properties (name, type, required) |
| `allowed_nested` | List[String] | No | Which blocks can be nested inside this type |

**Example:**
```
@type_definition
  id: type-epic
  type_name: epic
  description: "A large body of work that can be broken down into specific tasks (or stories)"
  properties:
    - { name: "id", type: "String", required: true }
    - { name: "name", type: "String", required: true }
    - { name: "status", type: "Status", required: true }
    - { name: "features", type: "List[Ref]", required: false }
  allowed_nested:
    - "accept"
    - "verify"
```

---

## 23. Accept — `@accept` (Nested Only)

Acceptance criteria nested within a `@task` block. Not a standalone object.

**Syntax:**
```
  @accept
    - [status] Criterion description
```

**Example:**
```
@task
  id: task-login-ui

  @accept
    - [x] Login form renders with email and password fields
    - [x] Client-side validation works
    - [ ] Error messages display on invalid credentials
    - [ ] Loading spinner shows during API call
```

Each criterion is a status-marked item. All criteria must be `[x]` for the task to be considered complete.

---

## 24. Verify — `@verify` (Nested Only)

Verification rules nested within a `@task` block. Not a standalone object.

**Syntax:**
```
  @verify
    - type: <verification-type>
      command: "<shell command>"
      required: <boolean>
```

**Example:**
```
@task
  id: task-login-ui

  @verify
    - type: test
      command: "npm test -- --filter=LoginForm"
      required: true
    - type: lint
      command: "eslint src/components/auth/LoginForm.tsx"
      required: true
    - type: accessibility
      check: "Form inputs have labels, focus management works"
      required: false
```

All `required: true` verifications must pass for the task to be marked `[x]`.

---

## 25. Policy — `@policy` (v4.0.0+)

Declarative guardrails that govern what autonomous agents may do. Introduced
in ALP v4 (The Federation Era) to make unattended swarms safe. Policies are
evaluated by the Policy Engine before an agent modifies a file or runs a
command; `deny_*` always takes precedence over `allow_*`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Policy identifier |
| `applies_to` | String \| List | No | Agent id(s) governed. `"*"` (or omit) = all agents |
| `allow_paths` | List (glob) | No | File paths agents may modify |
| `deny_paths` | List (glob) | No | File paths agents may never modify (wins over allow) |
| `allow_commands` | List (prefix) | No | Shell command prefixes agents may run |
| `deny_commands` | List (prefix) | No | Forbidden command prefixes (wins over allow) |
| `budgets` | Object | No | `max_iterations`, `max_tokens`, `max_seconds`, `max_cost_usd` |
| `enforcement` | Enum | No | `strict` (block, default) or `warn` (report only) |

**Precedence:** `deny_*` beats `allow_*`. If an `allow_*` list is present and
non-empty, the action must match it. If absent, the action is permitted unless
explicitly denied.

**Example:**
```
@policy
  id: policy-safe-swarm
  description: "Baseline safety guardrails for autonomous agents."
  applies_to: "*"
  enforcement: strict
  allow_paths:
    - "src/**"
    - "tests/**"
  deny_paths:
    - ".env"
    - ".alp/**"
  allow_commands:
    - "npm test"
    - "eslint"
  deny_commands:
    - "rm -rf"
    - "git push"
  budgets:
    max_iterations: 5
    max_seconds: 600
```

Enforced by `alp policy` (check an action) and by `alp verify` (verify
commands must comply before execution).

## 26. Swarm — `@swarm` (v4.0.0+)

Declares a **networked swarm**: a set of ALP nodes that coordinate through a
shared coordinator (an `alp serve` instance) instead of running in a single
process. Introduced in ALP v4 (The Federation Era, Pillar 1) so swarms can span
machines, containers, and CI runners while still respecting `@policy` and
`@lock`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Swarm identifier (unique per network) |
| `coordinator` | URL | No | Base URL of the `alp serve` coordinator (default `http://127.0.0.1:4000`) |
| `token` | String | No | Shared bearer token for the coordinator (if it requires one) |
| `node_id` | String | No | This node's name (auto-generated if omitted) |
| `heartbeat_seconds` | Number | No | How often to report liveness (default 5) |
| `pull_state` | Boolean | No | Pull merged task state from the coordinator before each claim (default true) |
| `peers` | List (URL) | No | Known peer coordinators for gossip/roster |

**Coordination model:** every node runs an ordinary `alp run` loop, but claims
are negotiated through the coordinator's `/api/swarm` endpoint rather than the
local `LockManager`. A node `join`s (registers + starts heartbeating), `sync`s
(pulls the merged graph), runs tasks, and `leave`s on shutdown. Locks acquired
remotely carry the `node_id` so dead nodes can be reaped by the coordinator.

**Example:**
```
@swarm
  id: swarm-ci-fleet
  coordinator: "http://coordinator.local:4000"
  token: "${SWARM_TOKEN}"
  node_id: "ci-runner-3"
  heartbeat_seconds: 5
  pull_state: true
```

Join a networked swarm with `alp run --swarm <id>` or inspect it with
`alp swarm roster <id>`.