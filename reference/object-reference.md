# ALP Object Reference

Comprehensive reference of all ALP protocol objects and their fields.

---

## `@project`
The root project definition. Exactly one per project, located in `.alp/project.alp`.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique project identifier |
| `name` | String | Yes | Human-readable project name |
| `version` | String | Yes | Project version (semver format) |
| `state` | Enum | Yes | Current project state (e.g., `planning`, `development`) |
| `description` | String | No | Detailed project description |
| `language` | String | No | Primary programming language |
| `framework` | String | No | Primary framework |
| `repository` | String | No | URL to the source code repository |
| `goals` | List[Ref] | No | References to `@goal` objects |
| `features` | List[Ref] | No | References to `@feature` objects |
| `agents` | List[Ref] | No | References to `@agent` objects |
| `constraints` | List[Ref] | No | References to `@constraint` objects |
| `rules` | List[Ref] | No | References to `@rule` objects |

---

## `@feature`
A high-level capability of the project containing tasks.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique feature identifier |
| `name` | String | Yes | Human-readable feature name |
| `lifecycle_stage`| Enum | Yes | Current stage (e.g., `plan`, `implement`) |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `description` | String | No | Detailed feature description |
| `tasks` | List[Ref] | No | References to `@task` objects |
| `depends_on` | List[Ref] | No | Features this feature depends on |
| `acceptance_criteria`| List | No | High-level conditions for feature completion |
| `goals` | List[Ref] | No | Goals this feature contributes to |
| `constraints` | List[Ref] | No | Constraints specific to this feature |
| `progress` | Number | No | Percentage complete (0-100) |

---

## `@task`
Atomic unit of work assigned to an agent.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique task identifier |
| `name` | String | Yes | Short task name |
| `status` | Status | Yes | `[ ]`, `[~]`, `[x]`, `[!]`, `[?]`, `[-]` |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `description` | String | No | Detailed task description |
| `difficulty` | Enum | No | `trivial`, `easy`, `medium`, `hard`, `complex` |
| `estimated_time` | Duration | No | Estimated time to complete (e.g., `4h`) |
| `actual_time` | Duration | No | Actual time spent |
| `feature` | Ref | No | Parent `@feature` this task belongs to |
| `owner` | Ref | No | The `@agent` assigned to this task |
| `depends_on` | List[Ref] | No | Tasks that must complete before this one |
| `blocks` | List[Ref] | No | Tasks waiting on this one |
| `artifacts` | List[Ref] | No | Files/outputs produced by this task |

**Nested Blocks:** `@accept`, `@verify`, `@artifact`

---

## `@workflow`
Orchestrates a sequence of steps or tasks across multiple agents.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique workflow identifier |
| `name` | String | Yes | Human-readable name |
| `goal` | String | Yes | What this workflow accomplishes |
| `steps` | List[Obj] | Yes | Ordered list of steps (see Step Object) |
| `inputs` | List | No | Required inputs to start workflow |
| `outputs` | List | No | Expected outputs upon completion |
| `agents` | List[Ref] | No | Agents involved in this workflow |
| `dependencies` | List[Ref] | No | Workflows that must run first |
| `fail_strategy` | Enum | No | `stop`, `skip`, `rollback`, `retry` |
| `retry_strategy` | Object | No | Configuration for retries (`max_retries`, `delay`) |
| `completion_rules`| List | No | Conditions for workflow success |

**Step Object Fields:** `name`, `task` (Ref), `agent` (Ref), `condition`, `on_success`, `on_failure`, `parallel_group`, `wait_for`

---

## `@agent`
Represents an AI system, role, or actor.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique agent identifier |
| `name` | String | Yes | Agent display name |
| `role` | Enum | Yes | `planner`, `frontend`, `backend`, `qa`, etc. |
| `responsibilities`| List | Yes | What the agent is responsible for |
| `permissions` | List | Yes | `read`, `write`, `execute`, `admin`, etc. |
| `description` | String | No | Detailed agent description |
| `tools` | List | No | Tools or commands the agent can use |
| `goals` | List | No | Agent's current objectives |
| `limits` | Object | No | Restrictions (e.g., `max_concurrent_tasks`) |
| `model` | String | No | Underlying AI model identifier |

---

## `@memory`
Persistent key-value storage for project knowledge.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique memory identifier |
| `type` | Enum | Yes | `project`, `architecture`, `decision`, `error`, etc. |
| `key` | String | Yes | Lookup key |
| `value` | String | Yes | Stored knowledge content |
| `scope` | Ref | No | Object this memory applies to |
| `importance` | Enum | No | `critical`, `high`, `medium`, `low` |
| `source` | String | No | Agent or process that created the memory |
| `ttl` | Duration | No | Time-to-live before expiration |

---

## `@state`
Tracks overall project state and checkpoints.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique state identifier |
| `current` | Enum | Yes | Current project state |
| `previous` | Enum | No | Previous project state |
| `checkpoint` | String | No | ID of the last safe checkpoint |
| `checkpoint_timestamp`| DateTime | No | When the checkpoint was created |
| `history` | List[Obj] | No | Log of state transitions |

---

## `@artifact`
Represents a file or output generated by a task.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique artifact identifier |
| `type` | Enum | Yes | `component`, `api`, `test`, `documentation`, etc. |
| `path` | String | Yes | File path relative to project root |
| `name` | String | No | Display name |
| `task` | Ref | No | Task that produced the artifact |
| `version` | String | No | Artifact version |
| `checksum` | String | No | File hash (e.g., SHA-256) |
| `status` | Enum | No | `draft`, `final`, `deprecated` |

---

## `@decision`
Records architectural or design choices.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique decision identifier |
| `title` | String | Yes | Summary of the decision |
| `reason` | String | Yes | Why it was chosen |
| `alternatives` | List | No | Other options considered |
| `tradeoffs` | List | No | Known downsides or risks |
| `outcome` | String | No | Resulting action |
| `decided_by` | Ref | No | Agent that made the decision |
| `scope` | Ref | No | Feature or task this relates to |
| `status` | Enum | No | `proposed`, `accepted`, `rejected`, `superseded` |

---

## `@constraint`
Defines boundaries or requirements that must be met.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique constraint identifier |
| `name` | String | Yes | Constraint name |
| `type` | Enum | Yes | `technical`, `business`, `security`, `legal`, etc. |
| `description` | String | Yes | What the constraint enforces |
| `severity` | Enum | Yes | `mandatory`, `recommended`, `optional` |
| `enforced_by` | Ref | No | Agent or verification responsible |
| `scope` | Ref | No | Object this applies to |

---

## `@verification`
Rules or commands to ensure quality standards. Can be standalone or nested.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes*| Unique identifier (required if standalone) |
| `type` | Enum | Yes | `test`, `lint`, `security`, `performance`, etc. |
| `required` | Boolean | Yes | Whether passing is mandatory |
| `name` | String | No | Verification name |
| `command` | String | No | Shell command to execute |
| `check` | String | No | Manual or descriptive check instruction |
| `expected_result`| String | No | What success looks like |
| `timeout` | Duration | No | Maximum execution time |
| `scope` | Ref | No | Object this verifies (if standalone) |

---

## `@dependency`
Explicit declaration of a relationship for the dependency graph.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique dependency identifier |
| `from` | Ref | Yes | The dependent object |
| `to` | Ref | Yes | The object being depended on |
| `type` | Enum | Yes | `blocks`, `requires`, `extends`, `uses`, `implements` |
| `description` | String | No | Why the relationship exists |

---

## `@resource`
External services, databases, or APIs.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique resource identifier |
| `type` | Enum | Yes | `database`, `api`, `file`, `service`, etc. |
| `name` | String | Yes | Resource name |
| `path` | String | No | URL, connection string, or path |
| `description` | String | No | Detailed description |
| `environment` | Enum | No | `development`, `staging`, `production`, `all` |

---

## `@event`
Significant occurrences during the project lifecycle.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique event identifier |
| `type` | Enum | Yes | `state_change`, `task_complete`, `error`, etc. |
| `timestamp` | DateTime | Yes | When the event occurred |
| `name` | String | No | Event summary |
| `payload` | String | No | Detailed event data |
| `source` | Ref | No | Agent or process that triggered it |
| `related_to` | Ref | No | Object this event affects |

---

## `@goal`
High-level objectives for the project or feature.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique goal identifier |
| `name` | String | Yes | Goal name |
| `description` | String | Yes | Detailed description |
| `success_criteria`| List | Yes | Measurable conditions for success |
| `priority` | Enum | Yes | `critical`, `high`, `medium`, `low` |
| `deadline` | Date | No | Target completion date |
| `progress` | Number | No | Percentage complete (0-100) |
| `features` | List[Ref] | No | Features that contribute to this goal |
| `status` | Status | No | `[ ]`, `[~]`, `[x]`, etc. |

---

## `@context`
Aggregated information an agent needs for a specific task.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique context identifier |
| `task` | Ref | Yes | The task this context belongs to |
| `relevant_files`| List | No | File paths to read |
| `architecture` | String | No | Specific architectural notes |
| `dependencies` | List[Ref] | No | Related dependencies |
| `rules` | List[Ref] | No | Applicable `@rule` objects |
| `business_logic`| List | No | Business requirements to keep in mind |
| `decisions` | List[Ref] | No | Relevant past decisions |
| `knowledge` | List[Ref] | No | Applicable `@memory` entries |

---

## `@rule`
Standards, policies, or conventions agents must follow.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Unique rule identifier |
| `name` | String | Yes | Rule name |
| `type` | Enum | Yes | `coding`, `naming`, `architecture`, `testing`, etc. |
| `description` | String | Yes | What the rule enforces |
| `enforcement` | Enum | Yes | `error`, `warning`, `info` |
| `pattern` | String | No | Regex or glob pattern to check |
| `scope` | Ref | No | Files or objects this applies to |
| `examples` | List[Obj] | No | `{ good: "...", bad: "..." }` examples |

---

## `@plugin`
Declares an external plugin that extends the ALP parser with new capabilities or custom types.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Plugin identifier |
| `name` | String | Yes | Human-readable plugin name |
| `version` | String | Yes | Plugin version (semver format) |
| `description` | String | No | What this plugin provides |
| `author` | String | No | Author of the plugin |
| `types` | List[Ref] | No | References to `@type_definition` objects exported by this plugin |

---

## `@type_definition`
Defines a custom object type that extends the core ALP protocol.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Type identifier |
| `type_name` | String | Yes | The keyword used for the block marker (e.g., `epic` for `@epic`) |
| `description` | String | No | What this custom type represents |
| `properties` | List[Obj] | Yes | Schema definitions for properties (name, type, required) |
| `allowed_nested` | List[String] | No | Which blocks can be nested inside this type |

---

## Nested-Only Blocks

### `@accept`
Nested inside `@task`. List of acceptance criteria.
```
@accept
  - [status] Criterion description
```

### `@verify`
Nested inside `@task`. See standalone `@verification` for fields. (Omit `id`).
```
@verify
  - type: test
    command: "npm test"
    required: true
```
