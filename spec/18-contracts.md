# ALP Specification — Contracts

**Version:** 10.9.0
**Status:** Stable

---

## 1. Overview

ALP v8.3.0 introduces **contracts**: declarative boundary objects that define
which operations, fields, and data flows are permitted between two entities
(agents, tasks, repos). Contracts make cross-agent and cross-repo handoffs
explicit and auditable, replacing implicit trust with verifiable least-privilege
rules.

Contracts are evaluated by `ContractEngine` at handoff points (task transfers,
repo writes, swarm messages, MCP tool calls). A violation is a `ContractViolation`
carrying the rule id, the actual value, and the allowed set.

---

## 2. The `@contract` Object

A `@contract` lives in `.alp/contracts.alp` (or any `.alp` file loaded by the
workspace). It declares a single boundary.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | String | Yes | Contract identifier |
| `name` | String | No | Human-readable name |
| `from` | Ref | Yes | Source entity (agent, repo, or task) |
| `to` | Ref | Yes | Destination entity |
| `type` | String | No | Boundary kind: `api` (default), `data`, `tool`, `repo` |
| `requires` | String[] | No | Pre-conditions that MUST be true for the handoff |
| `allows` | String[] | No | Operations/fields explicitly permitted (allow-list) |
| `denies` | String[] | No | Operations/fields explicitly blocked (deny-list) |
| `on_violation` | String | No | Action: `deny` (default), `warn`, `log` |

A contract is satisfied when:
1. Every entry in `requires` evaluates to `true`.
2. The operation is in `allows` (if `allows` is non-empty) **and** not in `denies`.

---

## 3. Contract Engine

### 3.1 Evaluation

```
function check(contract, context):
  for req in contract.requires:
    if not evaluate(req, context):
      return violation(req, context, "required condition not met")

  op = context.operation
  if contract.allows and op not in contract.allows:
    return violation(op, context, "not in allow-list")

  if op in contract.denies:
    return violation(op, context, "denied")

  return ok
```

### 3.2 `on_violation` modes

| Mode | Behavior |
|---|---|
| `deny` (default) | Block the operation; return `ContractViolation` |
| `warn` | Log a warning and allow the operation to proceed |
| `log` | Record the violation in `.alp/.runtime/contract-violations.jsonl` |

---

## 4. Formal Precondition Checking

### 4.1 Overview

ALP v10.9.0 introduces **formal model-checking** for `@policy` safety properties
and **precondition verification** for `@contract` objects. These checks run
without executing any side effects, producing a `VerificationProof` that lists
each checked invariant and an optional `CounterexampleTrace` when a property
fails.

### 4.2 Policy Model Checker

`PolicyModelChecker` evaluates lightweight safety invariants over a parsed
workspace:

| Invariant | Description |
|---|---|
| `valid_enforcement` | `enforcement` is either `strict` or `warn`. |
| `no_path_contradiction` | No path appears in both `allow_paths` and `deny_paths`. |
| `no_command_contradiction` | No command appears in both `allow_commands` and `deny_commands`. |
| `valid_time_windows` | Every `allow_during` entry has non-empty `days` and `start < end`. |
| `valid_scope` | `applies_to` is a wildcard, a `-> agent` reference, or a non-empty list. |

### 4.3 Contract Invariant Checker

`ContractInvariant` verifies structural safety properties for `@contract` objects:

| Invariant | Description |
|---|---|
| `valid_on_violation` | `on_violation` is `deny`, `warn`, or `log`. |
| `valid_type` | `type` is one of `api`, `data`, `tool`, or `repo`. |
| `satisfiable_requires` | Every `requires` expression is structurally satisfiable. |
| `no_full_allow_deny_overlap` | The `allows` list is not a strict subset of `denies`. |

### 4.4 `VerificationProof` Shape

```
type VerificationProof = {
  policyId: string
  passed: boolean
  checkedAt: string          // ISO-8601 timestamp
  properties: VerificationProperty[]
  counterexample?: CounterexampleTrace
}

type VerificationProperty = {
  name: string
  passed: boolean
  message: string
}

type CounterexampleTrace = {
  contractId: string
  invariant: string          // comma-separated failed invariant names
  input: Record<string, unknown>
  trace: string[]            // human-readable failure messages
}
```

### 4.5 CLI Usage

```
alp verify --formal <policy-id>
```

Loads the `.alp` workspace, instantiates `PolicyModelChecker`, and prints
each invariant result. Exits non-zero with the counterexample trace if any
invariant fails.

### 4.6 API Usage

```typescript
import { PolicyModelChecker, ContractInvariant } from '@alp/parser';

const checker = new PolicyModelChecker(objects);
const proof = checker.verify('policy-safe');
console.log(proof.passed); // true | false

const invariant = new ContractInvariant(objects);
const contractProof = invariant.verifyContract('contract-api');
```

---

## 5. Examples

```alp
!alp-version: 8.3.0

@contract
  id: contract-repo-access
  name: "Frontend → Backend API boundary"
  from: -> agent-frontend
  to: -> agent-backend
  type: api
  requires:
    - auth.token valid
    - rate_limit < 100
  allows:
    - api.v1.users.read
    - api.v1.users.write
    - api.v1.orders.read
  denies:
    - api.v1.admin.*
    - api.v1.internal.*
  on_violation: deny

@contract
  id: contract-data-egress
  name: "No PII leaves the workspace"
  from: -> agent-any
  to: -> external
  type: data
  denies:
    - field.ssn
    - field.credit_card
    - field.password_hash
  on_violation: deny
```

```typescript
const engine = new ContractEngine(contracts);
const result = engine.check(contractId, {
  operation: 'api.v1.users.read',
  auth: { token: validToken },
  rate_limit: 42,
});
if (!result.ok) {
  console.error('Blocked:', result.violation.rule, result.violation.reason);
}
```

---

## 6. Cross-Repo Handoff Contracts

When a task in repo **A** hands off to repo **B**, the handoff must be covered
by a contract whose `from` is a task in repo A and `to` is a task in repo B.

The Loop Engine (spec/05) enforces this at the handoff stage:

```
stage 4: handoff
  for each outgoing reference:
    contract = find_contract(from=this_task, to=target_task)
    if contract:
      result = engine.check(contract.id, context)
      if not result.ok:
        abort_handoff(result.violation)
        if on_violation == 'deny': raise ContractViolationError
```

---

## 7. MCP Tool Boundary

MCP tool calls between agents are also subject to contracts:

```
agent A invokes tool X on agent B
  → ContractEngine checks any contract(from=A, to=B, type=tool)
  → Violation → deny/warn/log per on_violation
```

This gives spec/07 (MCP) a runtime enforcement layer without changing the
transport protocol.
