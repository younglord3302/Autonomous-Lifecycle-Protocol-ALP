# ALP Lifecycle Diagrams

Visual diagrams for ALP's lifecycle, state machines, and engines.

---

## 1. Feature Lifecycle

```mermaid
stateDiagram-v2
    [*] --> discover
    discover --> understand
    understand --> plan
    plan --> design
    design --> implement
    implement --> test
    test --> review
    test --> implement : Test failures
    review --> refactor
    review --> implement : Review feedback
    refactor --> test : Re-verify
    refactor --> verify
    verify --> complete
    verify --> refactor : Issues found
    verify --> implement : Critical issues
    complete --> [*]
```

---

## 2. Project State Machine

```mermaid
stateDiagram-v2
    [*] --> planning
    planning --> architecture
    architecture --> development
    development --> testing
    testing --> review
    review --> completed
    completed --> archived
    archived --> [*]

    planning --> blocked
    architecture --> blocked
    development --> blocked
    testing --> blocked
    review --> blocked

    planning --> waiting
    architecture --> waiting
    development --> waiting
    testing --> waiting
    review --> waiting

    blocked --> planning : Resolved
    blocked --> architecture : Resolved
    blocked --> development : Resolved
    blocked --> testing : Resolved
    blocked --> review : Resolved

    waiting --> planning : Input received
    waiting --> architecture : Input received
    waiting --> development : Input received
    waiting --> testing : Input received
    waiting --> review : Input received
```

---

## 3. Loop Engine

```mermaid
graph TD
    A["Understand"] --> B["Plan"]
    B --> C["Implement"]
    C --> D["Test"]
    D --> E["Review"]
    E --> F["Reflect"]
    F --> G["Improve"]
    G --> H{"Completion
    conditions met?"}
    H -->|No| A
    H -->|Yes| I["Complete"]
    H -->|Max iterations| J["Failed"]
```

---

## 4. Task Status Transitions

```mermaid
stateDiagram-v2
    [*] --> pending : Created
    pending --> in_progress : Agent starts work
    pending --> blocked : Dependency unresolved
    pending --> skipped : Intentionally skipped
    in_progress --> needs_review : Work done, needs review
    in_progress --> blocked : Blocked during work
    in_progress --> completed : Verified and done
    blocked --> pending : Blocker resolved
    blocked --> in_progress : Blocker resolved, resume
    needs_review --> in_progress : Review feedback, needs changes
    needs_review --> completed : Review approved

    state pending {
        [*] : "[ ]"
    }
    state in_progress {
        [*] : "[~]"
    }
    state completed {
        [*] : "[x]"
    }
    state blocked {
        [*] : "[!]"
    }
    state needs_review {
        [*] : "[?]"
    }
    state skipped {
        [*] : "[-]"
    }
```

---

## 5. Workflow Execution

```mermaid
graph TD
    Start["Workflow Start"] --> S1["Step 1"]
    S1 -->|Success| S2["Step 2"]
    S1 -->|Failure| F1{"Fail Strategy"}
    F1 -->|stop| FAIL["Workflow Failed"]
    F1 -->|retry| S1
    F1 -->|skip| S2
    F1 -->|rollback| ROLL["Rollback to Checkpoint"]
    S2 -->|Success| S3["Step 3"]
    S2 -->|Failure| F2{"Fail Strategy"}
    F2 -->|stop| FAIL
    F2 -->|retry| S2
    F2 -->|skip| S3
    S3 -->|Success| END["Workflow Complete"]
    S3 -->|Failure| F3{"Fail Strategy"}
    F3 -->|stop| FAIL
    F3 -->|retry| S3
```

---

## 6. Context Loading

```mermaid
graph TD
    T["Current Task"] --> A["Load task @accept and @verify"]
    T --> B["Load parent @feature"]
    T --> C["Follow depends_on references"]
    T --> D["Load assigned @agent"]
    T --> E["Query @memory by scope"]
    T --> F["Find applicable @rule objects"]
    T --> G["Find related @decision objects"]
    T --> H["Load explicit @context if exists"]
    
    A --> CTX["Resolved Context"]
    B --> CTX
    C --> CTX
    D --> CTX
    E --> CTX
    F --> CTX
    G --> CTX
    H --> CTX
    
    CTX --> SCOPE{"!context-scope"}
    SCOPE -->|minimal| MIN["Task + direct deps only"]
    SCOPE -->|normal| NRM["+ feature + decisions + rules"]
    SCOPE -->|full| FULL["+ all memory + all related features"]
```

---

## 7. Dependency Graph Example

```mermaid
graph LR
    DB["task-db-schema<br/>[x] completed"] -->|blocks| API["task-auth-api<br/>[~] in progress"]
    DB -->|blocks| USER["task-user-api<br/>[ ] pending"]
    DS["task-design-system<br/>[x] completed"] -->|blocks| LOGIN["task-login-ui<br/>[ ] pending"]
    DS -->|blocks| REG["task-register-ui<br/>[ ] pending"]
    API -->|blocks| LOGIN
    USER -->|blocks| REG
    LOGIN -->|blocks| DASH["task-dashboard<br/>[ ] pending"]
    REG -->|blocks| DASH
```

---

## 8. Verification Flow

```mermaid
graph TD
    START["Task marked for verification"] --> ACCEPT["Check @accept criteria"]
    ACCEPT -->|All [x]| VERIFY["Run @verify commands"]
    ACCEPT -->|Not all [x]| FAIL["Verification FAILED<br/>Incomplete acceptance criteria"]
    VERIFY --> R1{"Test?"}
    R1 -->|Pass| R2{"Lint?"}
    R1 -->|Fail + Required| FAIL
    R1 -->|Fail + Optional| R2
    R2 -->|Pass| R3{"Security?"}
    R2 -->|Fail + Required| FAIL
    R3 -->|Pass| R4{"All checks done?"}
    R3 -->|Fail + Required| FAIL
    R4 -->|Yes| REPORT["Generate Verification Report"]
    REPORT --> RESULT{"All required passed?"}
    RESULT -->|Yes| PASS["Verification PASSED ✓<br/>Task status → [x]"]
    RESULT -->|No| FAIL
    FAIL --> BACK["Task status → [~]<br/>Return to implement"]
```

---

## 9. Agent Assignment

```mermaid
graph TD
    TASK["New Task Created"] --> OWNER{"Has owner field?"}
    OWNER -->|Yes| ASSIGN["Assigned to specified agent"]
    OWNER -->|No| AUTO["Auto-assignment"]
    AUTO --> ROLE["Filter agents by compatible role"]
    ROLE --> LOAD["Filter by workload < max_concurrent_tasks"]
    LOAD --> PERM["Filter by required permissions"]
    PERM --> CANDIDATES{"Candidates found?"}
    CANDIDATES -->|Yes| PICK["Assign to least-loaded agent"]
    CANDIDATES -->|No| BLOCK["Task status → [!] blocked<br/>No agent available"]
```
