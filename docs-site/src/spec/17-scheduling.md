# ALP Specification — Scheduling

**Version:** 8.2.0
**Status:** Stable

---

## 1. Overview

ALP v8.2.0 introduces native scheduling: a declarative `@timeline` object and
the `alp schedule` CLI so autonomous agents can defer, batch, and trigger work
without an external cron daemon. Scheduling is pull-based — an agent calls
`TimelineEngine.evaluate(now)` or `alp schedule next` to discover which tasks
are due — so it composes cleanly with the Loop Engine (spec/05 §2) and the
State Server (spec/05 §4).

---

## 2. The `@timeline` Object

A `@timeline` declares a single scheduled trigger. It lives in
`.alp/schedules.alp` (or any `.alp` file loaded by the workspace).

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Timeline identifier |
| `name` | String | No | Human-readable name |
| `cron` | String | No | Standard 5-field cron expression (`minute hour dom month dow`) |
| `at` | DateTime | No | One-shot ISO 8601 trigger (e.g. `2026-08-01T09:00:00Z`) |
| `task` | Ref | Yes | Task to execute when the timeline fires |
| `agent` | Ref | No | Agent that should own the execution (default: task's `owner`) |
| `enabled` | Boolean | No | Whether the timeline is active (default: `true`) |

**Exactly one** of `cron` or `at` MUST be present.

### 2.1 Cron expressions

The `cron` field uses the standard 5-field format:

```
minute hour day-of-month month day-of-week
```

- `minute`: `0-59`, `*`, `*/n`, `a-b`, `a-b/n`
- `hour`: `0-23`, same wildcards
- `day-of-month`: `1-31`, same wildcards
- `month`: `1-12` or `jan-dec`, same wildcards
- `day-of-week`: `0-7` (0/7 = Sunday) or `sun-sat`, same wildcards

Multiple values are comma-separated (`1,15,30`). Steps are `/n`. Ranges are
`a-b`. Names are case-insensitive.

**Examples:**
```
cron: "0 9 * * 1-5"        # Weekdays at 09:00 UTC
cron: "*/15 * * * *"       # Every 15 minutes
cron: "0 0 1 * *"          # First of the month at midnight
cron: "30 */2 * * sun"     # Sundays at 00:30, 02:30, ...
```

### 2.2 One-shot `at` triggers

```
at: "2026-08-01T09:00:00Z"
```

After firing, an `at` timeline is automatically disabled (`enabled: false`).
Re-enable it manually to re-trigger.

---

## 3. Timeline Engine

The **Timeline Engine** evaluates all `@timeline` objects against a reference
time (default: now) and returns the set of due tasks.

### 3.1 Evaluation

```
function evaluate(now: DateTime): TimelineResult[]:
  results = []
  for each @timeline where enabled:
    if cron  and matches(now, cron)  → due
    if at    and now >= at           → due
    if due → push { timeline, task, agent }
  return results
```

### 3.2 `alp schedule` Subcommands

| Subcommand | Behavior |
|---|---|
| `alp schedule` | List all timelines and their next fire time |
| `alp schedule next` | List only timelines due at or before `now` |
| `alp schedule enable <id>` | Set `enabled: true` |
| `alp schedule disable <id>` | Set `enabled: false` |
| `alp schedule --at <iso>` | Evaluate against a specific time (testing) |

---

## 4. Examples

```alp
!alp-version: 8.2.0

@timeline
  id: tl-daily-standup
  name: "Daily standup reminder"
  cron: "0 9 * * 1-5"
  task: -> task-daily-standup
  agent: -> agent-facilitator

@timeline
  id: tl-q3-review
  name: "Q3 architecture review"
  at: "2026-09-30T14:00:00Z"
  task: -> task-q3-review
  agent: -> agent-architect
```

```bash
# List all schedules
alp schedule

# Show only what's due now
alp schedule next

# Disable a timeline after a sprint ends
alp schedule disable tl-sprint-retro

# Evaluate schedules as of a fixed time (CI / testing)
alp schedule --at "2026-07-20T09:00:00Z"
```
