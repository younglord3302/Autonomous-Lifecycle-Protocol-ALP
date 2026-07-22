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
```

### 3.2 Python

```python
from alp_sdk import EventStore

store = EventStore('.alp')
store.append('status_changed', {'object_id': 'task-1', 'old': '[ ]', 'new': '[x]'})
events = store.read_all()
```
