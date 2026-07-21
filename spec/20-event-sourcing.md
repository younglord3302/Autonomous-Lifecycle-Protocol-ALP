# ALP Specification — Event Sourcing & Deterministic Replay

**Version:** 10.1.0
**Status:** Stable

---

## 1. Overview

ALP v10.1.0 introduces **Event Sourcing**: an append-only, schema-versioned
event log that records every workspace mutation. Instead of overwriting state,
ALP records the sequence of events that led to the current state. This enables
deterministic replay, incident forensics, and auditability without external
dependencies.

The event log lives at `.alp/.events/events.jsonl`. Each line is a self-contained
JSON object with a unique id, ISO timestamp, event type, payload, ALP version,
and schema version. Events are never mutated or deleted.

---

## 2. The Event Log

### 2.1 Location

```
.alp/.events/events.jsonl
```

### 2.2 Event Schema

```json
{
  "id": "abc123-...",
  "timestamp": "2026-07-20T12:00:00Z",
  "type": "status_changed",
  "payload": {
    "object_id": "task-login-ui",
    "old_value": "[ ]",
    "new_value": "[x]"
  },
  "version": "10.1.0",
  "schemaVersion": 1
}
```

| Field | Type | Description |
|---|---|---|
| `id` | String | Unique event identifier |
| `timestamp` | ISO 8601 | When the event occurred |
| `type` | EventType | The kind of mutation |
| `payload` | Object | Arbitrary structured data describing the event |
| `version` | String | ALP version that produced the event |
| `schemaVersion` | Number | Schema version for forward-compatibility |

### 2.3 Event Types

| Type | Description |
|---|---|
| `object_created` | A new `.alp` file or object was created |
| `object_updated` | An existing object was modified |
| `object_deleted` | An object or file was removed |
| `status_changed` | A task/feature status marker changed |
| `file_mutated` | A source file was written or deleted |
| `task_claimed` | A task was claimed by an agent or node |
| `task_released` | A previously claimed task was released |
| `checkpoint_created` | A new checkpoint was recorded |
| `policy_evaluated` | A `@policy` check was performed |
| `contract_checked` | A `@contract` boundary was evaluated |
| `vault_accessed` | A vault `get`/`set`/`rotate` occurred |
| `timeline_fired` | A `@timeline` trigger fired |
| `workflow_started` | A workflow execution began |
| `workflow_completed` | A workflow finished successfully |
| `workflow_failed` | A workflow terminated with an error |

---

## 3. Event Store API

### 3.1 TypeScript

```ts
import { EventStore } from '@alp/parser';

const store = new EventStore('.alp');

// Append a new event
store.append('status_changed', { object_id: 'task-1', old: '[ ]', new: '[x]' });

// Read all events (in order)
const events = store.readAll();

// Filter and replay
const result = store.replay({
  from: '2026-07-20T00:00:00Z',
  to: '2026-07-20T23:59:59Z',
  types: ['status_changed', 'object_created'],
  objectId: 'task-1'
});
// result.events, result.applied, result.skipped

// Count total events
const n = store.count();
```

### 3.2 Python

```python
from alp_sdk import EventStore

store = EventStore('.alp')

store.append('status_changed', {'object_id': 'task-1', 'old': '[ ]', 'new': '[x]'})
events = store.read_all()

result = store.replay(
    types=['status_changed', 'object_created'],
    object_id='task-1',
    from_ts='2026-07-20T00:00:00Z',
    to_ts='2026-07-20T23:59:59Z'
)
# result['events'], result['applied'], result['skipped']
```

---

## 4. CLI

```bash
# Replay the full event log
alp replay

# Filter by time window
alp replay --from 2026-07-20T00:00:00Z --to 2026-07-20T23:59:59Z

# Filter by event type(s)
alp replay --type status_changed,object_created

# Filter by object id
alp replay --object-id task-login-ui

# Combine filters
alp replay --type status_changed --object-id task-login-ui --from 2026-07-20T00:00:00Z
```

Output format:
```
📼 ALP Event Replay
===================
Total events:    42
Replayed:        12
Skipped:         30
Filters:         type=status_changed, object-id=task-login-ui

[2026-07-20T09:00:00Z] status_changed(abc123-...) object_id=task-login-ui, old=[ ], new=[x]
[2026-07-20T09:05:00Z] task_claimed(def456-...) task_id=task-login-ui, agent=agent-frontend
...
```

---

## 5. Integration with Existing Systems

### 5.1 Runtime Log Compatibility

The event log is separate from `.alp/.runtime/log.jsonl` (the runtime event
stream). The runtime log is a free-form stream; the event log is schema-validated
and intended for replay. Tools that consume runtime events (such as `alp serve`)
continue to work unchanged.

### 5.2 Opt-in

Event sourcing is opt-in. The `EventStore` writes to `.alp/.events/events.jsonl`
only when explicitly called. No existing `alp` commands are changed.

### 5.3 Deterministic Replay

Replaying events does not mutate workspace state. It is a read-only inspection
tool. Future versions may use replay to reconstruct workspace state from a
baseline snapshot plus events.

---

## 6. Example

```alp
!alp-version: 10.1.0

@task
  id: task-login-ui
  status: [~]
  name: "Build Login Page"
```

```bash
# Agent updates status
$ alp checkpoint task-login-ui [x] "Completed login form"

# Inspect what happened
$ alp replay --object-id task-login-ui
```

Expected event emitted:
```json
{
  "id": "a1b2c3d4e5f6",
  "timestamp": "2026-07-20T10:00:00Z",
  "type": "status_changed",
  "payload": {
    "object_id": "task-login-ui",
    "old_value": "[~]",
    "new_value": "[x]",
    "message": "Completed login form"
  },
  "version": "10.1.0",
  "schemaVersion": 1
}
```
