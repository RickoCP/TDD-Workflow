# SDLC Workflow Power - Workflow Diagrams

This document provides visual representations of the SDLC Workflow Power features, including Multi-Developer Support and the new Reliability features.

## Table of Contents

1. [Multi-Developer Support Overview](#multi-developer-support-overview)
2. [Main Workflow Diagram](#1-main-workflow-diagram)
3. [Component Interaction Diagram](#2-component-interaction-diagram)
4. [Task State Machine (Enhanced)](#3-task-state-machine-enhanced)
5. [Ownership State Machine](#4-ownership-state-machine)
6. [Release State Machine](#5-release-state-machine)
7. [TDD Phase Machine (Enhanced)](#6-tdd-phase-machine-enhanced)
8. [Checkpoint Recovery Flow](#7-checkpoint-recovery-flow)
9. [Evidence Staleness Detection](#8-evidence-staleness-detection)
10. [Optimistic Concurrency Flow](#9-optimistic-concurrency-flow)
11. [TDD Cycle Flowchart](#10-tdd-cycle-flowchart)
12. [Parallel Group Execution](#11-parallel-group-execution)
13. [Handoff Process](#12-handoff-process)
14. [Workload Analysis](#13-workload-analysis)
15. [Dependency Resolution Flow](#14-dependency-resolution-flow)
16. [Component Summary](#component-summary)

## Multi-Developer Support Overview

The Multi-Developer Support feature enables coordinated development across multiple team members by providing:

- **Team Management**: Define roles, specializations, and availability for team members
- **Intelligent Task Assignment**: Automatically assign tasks based on skills, workload, and dependencies
- **Dependency Resolution**: Track and resolve task dependencies to prevent blocking
- **Parallel Execution**: Identify and manage tasks that can run concurrently
- **Workload Balancing**: Analyze and optimize work distribution across the team
- **Handoff Coordination**: Manage smooth transitions between developers

## Reliability Features Overview

The Reliability features provide enterprise-grade safety and recoverability:

- **State Versioning**: Optimistic concurrency control prevents lost updates
- **Task Ownership**: Fencing tokens prevent stale writes from old owners
- **Leases & Heartbeats**: Time-limited ownership for AI agents with automatic expiry
- **Checkpoints**: Automatic and manual recovery points
- **Evidence Staleness**: Automatic detection of outdated verification
- **Definition of Ready**: Validation before task can start
- **Finding Register**: Formal tracking of review findings
- **Release Lifecycle**: Full deployment workflow with rollback support
- **Audit Logging**: Complete operation trail

---

## 1. Main Workflow Diagram

The overall flow from project initialization to completion:

```mermaid
flowchart TD
    subgraph Initialization
        A[Project Start] --> B[Load Configuration]
        B --> C[Initialize SDLC State]
    end

    subgraph Team_Setup["Team Setup"]
        C --> D[Define Team Members]
        D --> E[Set Roles & Specializations]
        E --> F[Configure Availability]
        F --> G[Validate Team Configuration]
    end

    subgraph Planning
        G --> H[Parse Requirements]
        H --> I[Create Task Breakdown]
        I --> J[Resolve Dependencies]
        J --> K[Identify Parallel Groups]
        K --> L[Estimate Workload]
    end

    subgraph Execution
        L --> M[Assign Tasks to Developers]
        M --> N[Execute TDD Cycle]
        N --> O{Task Complete?}
        O -->|No| N
        O -->|Yes| P[Update Task Status]
    end

    subgraph Handoff
        P --> Q{Handoff Required?}
        Q -->|Yes| R[Create Handoff Package]
        R --> S[Transfer Context]
        S --> T[Validate Handoff]
        Q -->|No| U[Continue Execution]
    end

    subgraph Monitoring
        T --> V[Analyze Workload]
        U --> V
        V --> W{Bottleneck Detected?}
        W -->|Yes| X[Rebalance Tasks]
        X --> M
        W -->|No| Y{All Tasks Done?}
        Y -->|No| M
        Y -->|Yes| Z[Project Complete]
    end

    style A fill:#e1f5fe
    style Z fill:#c8e6c9
    style N fill:#fff3e0
    style X fill:#ffcdd2
```

---

## 2. Component Interaction Diagram

How all components (existing and new) interact with each other:

```mermaid
flowchart TB
    subgraph Core_Components["Core Components (Existing)"]
        TM[Team Manager]
        TA[Task Assigner]
        DR[Dependency Resolver]
        PGM[Parallel Group Manager]
        WA[Workload Analyzer]
        HC[Handoff Coordinator]
        TV[Team Validator]
    end

    subgraph Reliability_Components["Reliability Components (New)"]
        SC[State Controller]
        OM[Ownership Manager]
        CM[Checkpoint Manager]
        EM[Evidence Manager]
        DOR[DoR Validator]
        FR[Finding Register]
        AL[Audit Logger]
    end

    subgraph Data_Flow["Data Storage"]
        PS[(project-state.yaml)]
        CP[(checkpoints/)]
        EV[(evidence/)]
        FND[(findings/)]
        AUDIT[(audit.log)]
    end

    %% State Controller is central
    SC -->|Version control| PS
    SC -->|Log operations| AL
    
    %% Ownership Manager
    OM -->|State updates| SC
    OM -->|Log claims| AL
    
    %% Checkpoint Manager
    CM -->|Read state| SC
    CM -->|Store checkpoints| CP
    
    %% Evidence Manager
    EM -->|Store evidence| EV
    EM -->|State updates| SC
    
    %% DoR Validator
    DOR -->|Read state| SC
    DOR -->|Check deps| DR
    
    %% Finding Register
    FR -->|Store findings| FND
    FR -->|State updates| SC

    %% Existing components use new reliability
    TA -->|Claim ownership| OM
    HC -->|Transfer ownership| OM
    HC -->|Create checkpoint| CM
    TV -->|Check DoR| DOR

    %% Audit logging
    AL -->|Write| AUDIT

    style SC fill:#e8f5e9
    style OM fill:#e8f5e9
    style CM fill:#e8f5e9
    style EM fill:#e8f5e9
    style DOR fill:#e8f5e9
    style FR fill:#e8f5e9
    style AL fill:#e8f5e9
```

---

## 3. Task State Machine (Enhanced)

The complete task lifecycle with all states and orthogonal attributes:

```mermaid
stateDiagram-v2
    [*] --> PENDING: Task Created

    PENDING --> READY: DoR Met
    PENDING --> PENDING: DoR Check Failed
    
    READY --> ASSIGNED: Assignee Set
    READY --> BLOCKED_READY: Blocker Added
    
    ASSIGNED --> IN_PROGRESS: Work Started\n[DoR Validated]
    ASSIGNED --> BLOCKED_ASSIGNED: Blocker Added
    ASSIGNED --> READY: Unassigned
    
    IN_PROGRESS --> REVIEW: Implementation Complete
    IN_PROGRESS --> BLOCKED_IN_PROGRESS: Blocker Added
    IN_PROGRESS --> HANDOFF_PENDING: Handoff Initiated
    
    REVIEW --> CHANGES_REQUESTED: Changes Requested
    REVIEW --> READY_TO_MERGE: Approved
    REVIEW --> BLOCKED_REVIEW: Blocker Added
    
    CHANGES_REQUESTED --> IN_PROGRESS: Addressing Changes
    
    READY_TO_MERGE --> INTEGRATED: Merged
    READY_TO_MERGE --> CHANGES_REQUESTED: Merge Failed
    
    INTEGRATED --> DONE: Post-merge Verified\n[DoD Met]
    INTEGRATED --> IN_PROGRESS: Verification Failed
    
    BLOCKED_READY --> READY: Blocker Resolved
    BLOCKED_ASSIGNED --> ASSIGNED: Blocker Resolved
    BLOCKED_IN_PROGRESS --> IN_PROGRESS: Blocker Resolved
    BLOCKED_REVIEW --> REVIEW: Blocker Resolved
    
    HANDOFF_PENDING --> IN_PROGRESS: Handoff Complete
    HANDOFF_PENDING --> IN_PROGRESS: Handoff Cancelled
    
    DONE --> IN_PROGRESS: Reopened\n[With Justification]
    
    state CANCELLED
    state SUPERSEDED
    
    PENDING --> CANCELLED: Explicit Cancel
    READY --> CANCELLED: Explicit Cancel
    ASSIGNED --> CANCELLED: Explicit Cancel
    IN_PROGRESS --> CANCELLED: Explicit Cancel
    REVIEW --> CANCELLED: Explicit Cancel
    READY_TO_MERGE --> CANCELLED: Explicit Cancel
    
    PENDING --> SUPERSEDED: Replaced
    READY --> SUPERSEDED: Replaced
    ASSIGNED --> SUPERSEDED: Replaced

    note right of PENDING
        Task created but
        DoR not yet validated
    end note

    note right of DONE
        Reopening requires:
        - Justification (non-empty)
        - New evidence
    end note
```

### Orthogonal Attributes

These attributes can be applied independently of the main state:

| Attribute | Description | Applies To |
|-----------|-------------|------------|
| `blocked: true/false` | Task has active blockers | PENDING, READY, ASSIGNED, IN_PROGRESS, REVIEW |
| `blocked_reason` | Why task is blocked | When blocked=true |
| `blocker_refs` | BLOCKER-xxx references | When blocked=true |
| `handoff_pending: true/false` | Handoff in progress | IN_PROGRESS |
| `handoff_id` | HO-xxx reference | When handoff_pending=true |

---

## 4. Ownership State Machine

Ownership lifecycle for AI agents with lease management:

```mermaid
stateDiagram-v2
    [*] --> UNCLAIMED: Task Available
    
    UNCLAIMED --> CLAIMED: Claim Success\n[Fencing Token Issued]
    UNCLAIMED --> UNCLAIMED: Claim Failed\n[Already Claimed]
    
    CLAIMED --> ACTIVE: Work Started
    
    ACTIVE --> ACTIVE: Heartbeat Received
    ACTIVE --> LEASE_WARNING: Heartbeat Delayed\n[> heartbeat_interval]
    
    LEASE_WARNING --> ACTIVE: Heartbeat Received
    LEASE_WARNING --> LEASE_EXPIRED: No Heartbeat\n[> 2x heartbeat_interval]
    
    LEASE_EXPIRED --> ABANDONED: Timeout
    
    ABANDONED --> UNCLAIMED: Reclaim Allowed
    
    ACTIVE --> RELEASED: Explicit Release
    ACTIVE --> TRANSFERRED: Handoff Complete
    
    RELEASED --> UNCLAIMED: Available Again
    TRANSFERRED --> [*]: New Owner Active
    
    note right of ACTIVE
        Fencing token valid
        Operations allowed
    end note
    
    note right of LEASE_EXPIRED
        Fencing token invalidated
        Operations rejected
    end note

    note right of CLAIMED
        For HUMAN actors:
        No lease expiry
        No heartbeat required
    end note
```

### Ownership Differences: Human vs AI Agent

| Aspect | Human | AI Agent |
|--------|-------|----------|
| Lease Duration | Unlimited | Configurable (default: 1 hour) |
| Heartbeat | Not required | Required every 5 minutes |
| Auto-expiry | No | Yes, after 2x heartbeat interval |
| Inactivity | Warning only | Lease expiration |
| Fencing Token | Yes | Yes |

---

## 5. Release State Machine

Complete release lifecycle from planning to production:

```mermaid
stateDiagram-v2
    [*] --> NOT_STARTED
    
    NOT_STARTED --> PLANNING: Release Planned
    
    PLANNING --> READINESS_CHECK: All Tasks Done
    
    READINESS_CHECK --> READINESS_FAILED: Gates Failed
    READINESS_CHECK --> STAGING: Gates Passed
    
    READINESS_FAILED --> READINESS_CHECK: Issues Fixed
    READINESS_FAILED --> CANCELLED: Release Cancelled
    
    STAGING --> STAGING_FAILED: Deploy/Test Failed
    STAGING --> AWAITING_APPROVAL: Staging Verified
    
    STAGING_FAILED --> STAGING: Issues Fixed
    STAGING_FAILED --> CANCELLED: Release Cancelled
    
    AWAITING_APPROVAL --> PRODUCTION: Human Approved
    AWAITING_APPROVAL --> STAGING: Approval Denied
    
    PRODUCTION --> PRODUCTION_FAILED: Deploy Failed
    PRODUCTION --> MONITORING: Deploy Success
    
    PRODUCTION_FAILED --> ROLLED_BACK: Rollback Executed
    PRODUCTION_FAILED --> PRODUCTION: Retry Deploy
    
    MONITORING --> MONITORING: Observation Period
    MONITORING --> ROLLED_BACK: Issue Detected
    MONITORING --> CLOSED: Observation Complete\n[No Issues]
    
    ROLLED_BACK --> STAGING: Fix and Retry
    ROLLED_BACK --> CANCELLED: Release Cancelled
    
    CLOSED --> [*]
    CANCELLED --> [*]

    note right of AWAITING_APPROVAL
        Human gate required
        Approver must be authorized
    end note

    note right of MONITORING
        Configurable observation period
        Auto-close if no issues
    end note

    note right of ROLLED_BACK
        Previous version restored
        Rollback evidence recorded
    end note
```

### Release Stages

| Stage | Description | Requirements |
|-------|-------------|--------------|
| NOT_STARTED | Initial state | - |
| PLANNING | Release being planned | Version defined |
| READINESS_CHECK | Quality gates evaluation | All tasks DONE |
| STAGING | Deployed to staging | Readiness passed |
| AWAITING_APPROVAL | Waiting for human approval | Staging verified |
| PRODUCTION | Deployed to production | Human approved |
| MONITORING | Post-deploy observation | Production verified |
| CLOSED | Release complete | Observation passed |
| CANCELLED | Release cancelled | Explicit cancel |
| ROLLED_BACK | Reverted to previous | Rollback executed |

---

## 6. TDD Phase Machine (Enhanced)

TDD cycle with enhanced error handling and evidence types:

```mermaid
stateDiagram-v2
    [*] --> PENDING: Task Started
    
    PENDING --> RED: Start TDD Cycle
    PENDING --> NOT_APPLICABLE: Mark TDD N/A\n[With Reason]
    
    RED --> RED_INVALID: Test Passes Unexpectedly
    RED --> GREEN: Test Fails Correctly\n[BEHAVIOR_MISSING]
    RED --> RED_ERROR: Test Error\n[ENVIRONMENT/TEST_ERROR]
    
    RED_INVALID --> RED: Test Fixed
    RED_ERROR --> RED: Error Fixed
    
    GREEN --> GREEN: Test Still Fails
    GREEN --> REFACTOR: All Tests Pass
    
    REFACTOR --> REFACTOR: Tests Still Pass
    REFACTOR --> REGRESSION: Test Fails After Refactor
    REFACTOR --> VERIFY: Refactor Complete
    
    REGRESSION --> REFACTOR: Regression Fixed
    REGRESSION --> GREEN: Rollback to Pre-refactor
    
    VERIFY --> VERIFY_FAILED: Verification Failed
    VERIFY --> COMPLETE: All Checks Pass
    
    VERIFY_FAILED --> GREEN: Fix Required
    VERIFY_FAILED --> RED: New Test Needed
    
    COMPLETE --> RED: Next Test Cycle
    COMPLETE --> [*]: Task Done
    
    NOT_APPLICABLE --> VERIFY: Alternative Verification
    NOT_APPLICABLE --> [*]: Manual Approval

    note right of RED
        Valid RED requires:
        - Test runs (not skipped)
        - Fails due to BEHAVIOR_MISSING
        - Not TEST_ERROR or ENV_ERROR
    end note

    note right of GREEN
        Valid GREEN requires:
        - Same test now passes
        - No other tests regressed
    end note
```

### Test Error Categories

| Category | Description | Action |
|----------|-------------|--------|
| BEHAVIOR_MISSING | Expected failure, behavior not implemented | Valid RED, proceed to GREEN |
| TEST_ERROR | Test code has bugs (syntax, assertion error) | Fix test before proceeding |
| ENVIRONMENT_ERROR | Runtime, connection, config issue | Fix environment |
| SKIPPED | Test not executed | Invalid evidence, ensure test runs |

---

## 7. Checkpoint Recovery Flow

How checkpoints are created and used for recovery:

```mermaid
flowchart TD
    subgraph Creation["Checkpoint Creation"]
        T1[State Transition] -->|Auto| CREATE
        T2[TDD Phase Change] -->|Auto| CREATE
        T3[Evidence Created] -->|Auto| CREATE
        T4[Handoff Event] -->|Auto| CREATE
        T5[Periodic Timer] -->|Auto| CREATE
        T6[User Request] -->|Manual| CREATE
        
        CREATE[Create Checkpoint] --> CAPTURE
        CAPTURE[Capture Snapshot]
        
        subgraph Snapshot["Snapshot Contents"]
            S1[state_version]
            S2[task_id & status]
            S3[owner_id & fencing_token]
            S4[tdd_phase]
            S5[branch_name & commit_sha]
            S6[uncommitted_changes]
            S7[evidence_refs]
            S8[blockers]
            S9[next_action]
        end
        
        CAPTURE --> S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 & S9
        S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 & S9 --> STORE
        STORE[Store to checkpoints/]
    end
    
    subgraph Recovery["Checkpoint Recovery"]
        R1[Resume Request] --> LIST
        LIST[List Checkpoints] --> SELECT
        SELECT[Select Checkpoint] --> VALIDATE
        
        VALIDATE{Validate Against\nCurrent State}
        
        VALIDATE -->|Branch exists?| CHECK_BRANCH
        VALIDATE -->|Commit reachable?| CHECK_COMMIT
        VALIDATE -->|State version?| CHECK_VERSION
        
        CHECK_BRANCH -->|No| DISCREP[Add Discrepancy]
        CHECK_COMMIT -->|No| DISCREP
        CHECK_VERSION -->|Newer exists| DISCREP
        
        DISCREP --> STRATEGY
        
        CHECK_BRANCH -->|Yes| PREPARE
        CHECK_COMMIT -->|Yes| PREPARE
        CHECK_VERSION -->|Match| PREPARE
        
        PREPARE[Prepare Recovery Plan]
        STRATEGY{Determine Strategy}
        
        STRATEGY -->|Compatible| AUTO[AUTO_MERGE]
        STRATEGY -->|Conflicts| PROMPT[PROMPT_USER]
        STRATEGY -->|Too stale| REJECT[REJECT]
        
        AUTO --> EXECUTE
        PROMPT --> USER_CONFIRM{User Confirms?}
        USER_CONFIRM -->|Yes| EXECUTE
        USER_CONFIRM -->|No| ABORT[Abort Recovery]
        REJECT --> ABORT
        
        EXECUTE[Execute Recovery]
        EXECUTE --> RESTORED[State Restored]
    end

    style Creation fill:#e3f2fd
    style Recovery fill:#e8f5e9
    style Snapshot fill:#fff8e1
```

### Recovery Strategies

| Strategy | Condition | Behavior |
|----------|-----------|----------|
| AUTO_MERGE | Changes are compatible | Automatically reconcile differences |
| PROMPT_USER | Conflicts or ambiguous | User decides how to proceed |
| REJECT | Checkpoint too stale | Require fresh start or different checkpoint |

---

## 8. Evidence Staleness Detection

How evidence freshness is tracked and validated:

```mermaid
flowchart TD
    subgraph EvidenceCreation["Evidence Creation"]
        RUN[Run Verification] --> RECORD
        RECORD[Record Evidence]
        RECORD --> CAPTURE_GIT[Capture Git State]
        RECORD --> CAPTURE_FILES[Capture File Hashes]
        
        CAPTURE_GIT --> GIT_STATE[commit_sha\nbranch\nworking_tree_dirty]
        CAPTURE_FILES --> FILE_HASHES[related_files:\n- path\n- hash_at_verification]
        
        GIT_STATE --> STORE_EVD[Store Evidence]
        FILE_HASHES --> STORE_EVD
    end
    
    subgraph StalenessCheck["Staleness Check"]
        CHECK[Check Staleness] --> GET_EVD[Get Evidence Record]
        GET_EVD --> COMPARE
        
        COMPARE[Compare to Current State]
        
        COMPARE --> CHECK_SHA{commit_sha ==\ncurrent HEAD?}
        CHECK_SHA -->|No| STALE_SHA[Stale: COMMIT_CHANGED]
        CHECK_SHA -->|Yes| CHECK_FILES
        
        CHECK_FILES{File hashes\nmatch?}
        CHECK_FILES -->|No| STALE_FILE[Stale: FILE_MODIFIED]
        CHECK_FILES -->|Yes| FRESH
        
        STALE_SHA --> MARK_STALE[Mark Evidence Stale]
        STALE_FILE --> MARK_STALE
        
        FRESH[Evidence Fresh ✓]
        
        MARK_STALE --> UPDATE[Update Evidence:\nstale: true\nstale_reason: ...\nrequires_revalidation: true]
    end
    
    subgraph Impact["Impact on Workflow"]
        UPDATE --> BLOCK_DONE[Block DONE Transition]
        BLOCK_DONE --> REVALIDATE[Require Revalidation]
        REVALIDATE --> RUN
    end

    style EvidenceCreation fill:#e3f2fd
    style StalenessCheck fill:#fff3e0
    style Impact fill:#ffcdd2
```

### Staleness Reasons

| Reason | Description | Resolution |
|--------|-------------|------------|
| COMMIT_CHANGED | Current commit differs from evidence commit | Re-run verification |
| FILE_MODIFIED | Related files changed after verification | Re-run verification |
| CONFIG_CHANGED | Test configuration changed | Re-run verification |

---

## 9. Optimistic Concurrency Flow

How state updates are protected against concurrent modifications:

```mermaid
sequenceDiagram
    participant C1 as Client 1
    participant C2 as Client 2
    participant SC as State Controller
    participant FS as File System
    participant AL as Audit Logger
    
    Note over C1,C2: Both clients read state simultaneously
    
    C1->>SC: readState()
    SC->>FS: Read project-state.yaml
    FS-->>SC: {state, version: 42}
    SC-->>C1: {state, version: 42}
    
    C2->>SC: readState()
    SC->>FS: Read project-state.yaml
    FS-->>SC: {state, version: 42}
    SC-->>C2: {state, version: 42}
    
    Note over C1: Client 1 makes changes
    C1->>SC: writeState(newState, expectedVersion: 42)
    SC->>FS: Check current version
    FS-->>SC: version: 42 ✓
    SC->>FS: Write {state, version: 43}
    SC->>AL: Log operation
    SC-->>C1: Success {newVersion: 43}
    
    Note over C2: Client 2 tries same operation
    C2->>SC: writeState(newState, expectedVersion: 42)
    SC->>FS: Check current version
    FS-->>SC: version: 43 ✗
    SC-->>C2: VERSION_CONFLICT Error
    
    Note over C2: Client 2 retries with fresh read
    C2->>SC: readState()
    SC-->>C2: {state, version: 43}
    C2->>SC: writeState(newState, expectedVersion: 43)
    SC->>FS: Check current version
    FS-->>SC: version: 43 ✓
    SC->>FS: Write {state, version: 44}
    SC->>AL: Log operation
    SC-->>C2: Success {newVersion: 44}
```

### Retry with Exponential Backoff

```mermaid
flowchart TD
    START[Start Update] --> READ[Read State + Version]
    READ --> MODIFY[Modify State]
    MODIFY --> WRITE{Write with\nExpected Version}
    
    WRITE -->|Success| DONE[Done ✓]
    WRITE -->|VERSION_CONFLICT| RETRY_CHECK{Retries < Max?}
    
    RETRY_CHECK -->|Yes| BACKOFF[Exponential Backoff\n2^retry * 100ms]
    BACKOFF --> READ
    
    RETRY_CHECK -->|No| FAIL[MAX_RETRIES_EXCEEDED]

    style DONE fill:#c8e6c9
    style FAIL fill:#ffcdd2
```

---

Detailed view of the Test-Driven Development cycle:

```mermaid
flowchart TD
    START([Start TDD Cycle]) --> WRITE_TEST[Write Failing Test]
    
    subgraph RED_Phase["🔴 RED Phase"]
        WRITE_TEST --> RUN_TEST1{Run Test}
        RUN_TEST1 -->|Pass| FIX_TEST[Test is Wrong - Fix It]
        FIX_TEST --> RUN_TEST1
        RUN_TEST1 -->|Fail| RED_DONE[Test Fails as Expected]
    end

    RED_DONE --> WRITE_CODE[Write Minimum Code]

    subgraph GREEN_Phase["🟢 GREEN Phase"]
        WRITE_CODE --> RUN_TEST2{Run Test}
        RUN_TEST2 -->|Fail| DEBUG[Debug & Fix Code]
        DEBUG --> RUN_TEST2
        RUN_TEST2 -->|Pass| GREEN_DONE[All Tests Pass]
    end

    GREEN_DONE --> REVIEW_CODE{Code Quality OK?}

    subgraph REFACTOR_Phase["🔵 REFACTOR Phase"]
        REVIEW_CODE -->|No| REFACTOR[Refactor Code]
        REFACTOR --> RUN_TEST3{Run All Tests}
        RUN_TEST3 -->|Fail| UNDO[Undo Changes]
        UNDO --> REFACTOR
        RUN_TEST3 -->|Pass| REVIEW_CODE
    end

    REVIEW_CODE -->|Yes| MORE_TESTS{More Tests Needed?}
    MORE_TESTS -->|Yes| WRITE_TEST
    MORE_TESTS -->|No| COMPLETE([TDD Cycle Complete])

    style RED_Phase fill:#ffcdd2
    style GREEN_Phase fill:#c8e6c9
    style REFACTOR_Phase fill:#bbdefb
```

---

## 11. Parallel Group Execution

Visualization of how tasks execute in parallel groups:

```mermaid
gantt
    title Parallel Task Execution Timeline
    dateFormat  YYYY-MM-DD
    
    section Group 1 (No Dependencies)
    Task 1.1 - Setup Database    :a1, 2024-01-01, 2d
    Task 1.2 - Create API Schema :a2, 2024-01-01, 2d
    Task 1.3 - Setup Auth Module :a3, 2024-01-01, 3d
    
    section Group 2 (Depends on Group 1)
    Task 2.1 - User CRUD         :b1, after a1, 3d
    Task 2.2 - API Endpoints     :b2, after a2, 2d
    Task 2.3 - Auth Integration  :b3, after a3, 2d
    
    section Group 3 (Depends on Group 2)
    Task 3.1 - User Tests        :c1, after b1, 2d
    Task 3.2 - API Tests         :c2, after b2, 2d
    Task 3.3 - E2E Auth Tests    :c3, after b3 b1, 3d
    
    section Group 4 (Final Integration)
    Task 4.1 - Integration Tests :d1, after c1 c2 c3, 2d
    Task 4.2 - Documentation     :d2, after c1 c2, 2d
```

---

## 12. Handoff Process

Communication flow during developer handoff (enhanced with ownership transfer):

```mermaid
sequenceDiagram
    participant OD as Original Developer
    participant HC as Handoff Coordinator
    participant OM as Ownership Manager
    participant CM as Checkpoint Manager
    participant TM as Team Manager
    participant ND as New Developer
    participant AL as Audit Logger

    OD->>HC: Request Handoff
    HC->>CM: Create Checkpoint
    CM-->>HC: Checkpoint Created
    HC->>HC: Validate Handoff Eligibility
    
    alt Handoff Approved
        HC->>OD: Request Context Package
        OD->>HC: Submit Handoff Package
        
        Note over HC: Package Contains:<br/>- Task State<br/>- Current Progress<br/>- TDD Phase<br/>- Evidence Refs<br/>- Blockers<br/>- Notes
        
        HC->>TM: Query Available Developers
        TM->>HC: Return Developer List
        HC->>HC: Match Skills & Availability
        
        HC->>ND: Propose Handoff
        ND->>HC: Accept Handoff
        
        HC->>OM: Transfer Ownership
        OM->>OM: Invalidate Old Fencing Token
        OM->>OM: Generate New Fencing Token
        OM-->>HC: Ownership Transferred
        
        HC->>AL: Log Handoff Complete
        
        HC->>ND: Deliver Context Package + New Token
        ND->>HC: Acknowledge Receipt
        
        HC->>OD: Confirm Handoff Complete
        HC->>TM: Update Team Status
    else Handoff Rejected
        HC->>OD: Return Rejection Reason
    end
```

---

## 13. Workload Analysis

How the Workload Analyzer evaluates and balances work:

```mermaid
flowchart TD
    START([Analyze Workload]) --> GATHER[Gather Current Assignments]
    GATHER --> CALC[Calculate Metrics per Developer]
    
    subgraph Metrics["📊 Metrics Calculated"]
        M1[Task Count]
        M2[Estimated Hours]
        M3[Complexity Score]
        M4[Blocked Tasks]
        M5[Dependency Chain Length]
    end
    
    CALC --> M1 & M2 & M3 & M4 & M5
    M1 & M2 & M3 & M4 & M5 --> AGGREGATE[Aggregate Team Metrics]
    
    AGGREGATE --> CHECK_BALANCE{Check Balance}
    
    CHECK_BALANCE -->|Imbalanced| IDENTIFY[Identify Bottlenecks]
    
    subgraph Bottleneck_Detection["🔍 Bottleneck Detection"]
        B1{Developer > 150% avg load?}
        B2{Developer has > 3 blocked tasks?}
        B3{Critical path overloaded?}
    end
    
    IDENTIFY --> B1 & B2 & B3
    
    B1 -->|Yes| FLAG1[Flag Overloaded]
    B2 -->|Yes| FLAG2[Flag Blocked]
    B3 -->|Yes| FLAG3[Flag Critical]
    
    FLAG1 & FLAG2 & FLAG3 --> SUGGEST[Generate Rebalance Suggestions]
    
    SUGGEST --> APPLY{Apply Suggestions?}
    APPLY -->|Auto| REBALANCE[Execute Rebalancing]
    APPLY -->|Manual| REPORT[Generate Report]
    
    CHECK_BALANCE -->|Balanced| HEALTHY[Team Healthy ✓]
    REBALANCE --> HEALTHY
    REPORT --> END([Analysis Complete])
    HEALTHY --> END

    style Metrics fill:#e3f2fd
    style Bottleneck_Detection fill:#fff3e0
```

---

## 14. Dependency Resolution Flow

How dependencies are tracked and resolved:

```mermaid
flowchart TD
    subgraph Input["📥 Input"]
        TASKS[Task List]
        DEPS[Dependency Declarations]
    end

    TASKS & DEPS --> PARSE[Parse Dependencies]
    PARSE --> BUILD[Build Dependency Graph]
    
    BUILD --> VALIDATE{Validate Graph}
    
    VALIDATE -->|Circular Detected| CIRCULAR[Report Circular Dependency]
    CIRCULAR --> RESOLVE_CIRCULAR[Suggest Resolution]
    RESOLVE_CIRCULAR --> BUILD
    
    VALIDATE -->|Valid| ANALYZE[Analyze Graph]
    
    subgraph Analysis["🔬 Analysis"]
        A1[Find Root Nodes]
        A2[Calculate Depths]
        A3[Identify Critical Path]
        A4[Find Parallel Opportunities]
    end
    
    ANALYZE --> A1 & A2 & A3 & A4
    
    A1 & A2 & A3 & A4 --> OUTPUT[Generate Execution Order]
    
    OUTPUT --> GROUPS[Create Parallel Groups]
    GROUPS --> READY[Mark Ready Tasks]
    
    subgraph Runtime["⚡ Runtime Updates"]
        COMPLETE[Task Completed]
        UPDATE[Update Dependencies]
        UNBLOCK[Unblock Waiting Tasks]
    end
    
    READY --> COMPLETE
    COMPLETE --> UPDATE
    UPDATE --> UNBLOCK
    UNBLOCK --> READY

    style Input fill:#e8f5e9
    style Analysis fill:#fff8e1
    style Runtime fill:#fce4ec
```

---

## 15. Quick Reference Commands

| Command | Description | Component |
|---------|-------------|-----------|
| `team:add <name> <role>` | Add a new team member | Team Manager |
| `team:remove <name>` | Remove a team member | Team Manager |
| `team:status` | View team overview | Team Manager |
| `task:assign <task> <dev>` | Manually assign task | Task Assigner |
| `task:auto-assign` | Auto-assign all pending tasks | Task Assigner |
| `task:claim <task>` | Claim ownership with fencing token | Ownership Manager |
| `task:release` | Release task ownership | Ownership Manager |
| `task:heartbeat` | Record AI agent heartbeat | Ownership Manager |
| `dep:check <task>` | Check task dependencies | Dependency Resolver |
| `dep:graph` | Display dependency graph | Dependency Resolver |
| `parallel:groups` | Show parallel execution groups | Parallel Group Manager |
| `parallel:optimize` | Optimize group assignments | Parallel Group Manager |
| `workload:analyze` | Run workload analysis | Workload Analyzer |
| `workload:rebalance` | Suggest rebalancing | Workload Analyzer |
| `handoff:request <task>` | Request task handoff | Handoff Coordinator |
| `handoff:status` | View pending handoffs | Handoff Coordinator |
| `checkpoint:create` | Create manual checkpoint | Checkpoint Manager |
| `checkpoint:list` | List available checkpoints | Checkpoint Manager |
| `checkpoint:recover <id>` | Prepare recovery plan | Checkpoint Manager |
| `evidence:check <id>` | Check evidence staleness | Evidence Manager |
| `evidence:list <task>` | List evidence for task | Evidence Manager |
| `release:plan <version>` | Plan a new release | Release Manager |
| `release:check` | Run readiness check | Release Manager |
| `release:stage` | Deploy to staging | Release Manager |
| `release:approve` | Record production approval | Release Manager |
| `release:deploy` | Deploy to production | Release Manager |
| `release:rollback` | Rollback release | Release Manager |
| `finding:create` | Create review finding | Finding Register |
| `finding:update <id>` | Update finding status | Finding Register |
| `finding:list` | List findings | Finding Register |

---

## 16. Bottleneck Detection Rules

| Rule | Threshold | Action | Priority |
|------|-----------|--------|----------|
| Overloaded Developer | > 150% average workload | Suggest task redistribution | High |
| Blocked Task Accumulation | > 3 blocked tasks per dev | Review dependency chain | High |
| Critical Path Concentration | > 50% critical tasks on one dev | Distribute critical work | Critical |
| Idle Developer | < 25% average workload | Assign more tasks | Medium |
| Long Dependency Chain | > 5 sequential dependencies | Identify parallelization | Medium |
| Stale Task | No progress > 2 days | Check for blockers | High |
| Handoff Pending | > 24 hours unacknowledged | Escalate handoff | Medium |
| Skill Mismatch | Task complexity > dev experience | Suggest pair programming | Low |
| Expired Lease | AI agent lease timeout | Mark task abandoned | High |
| Stale Evidence | Evidence older than HEAD | Block task completion | High |
| Unresolved Findings | CRITICAL/HIGH open | Block release | Critical |

---

## 17. Definition of Ready Flow

How Definition of Ready is validated before task can start:

```mermaid
flowchart TD
    START[Task Transition to IN_PROGRESS] --> CHECK_DOR[Validate DoR]
    
    subgraph DoR_Conditions["DoR Conditions"]
        C1{Acceptance Criteria\nDefined?}
        C2{Blocking Dependencies\nComplete?}
        C3{Required Decisions\nResolved?}
        C4{Assignee Has\nRequired Role?}
        C5{No Active\nBlockers?}
    end
    
    CHECK_DOR --> C1
    C1 -->|No| FAIL1[AC not defined]
    C1 -->|Yes| C2
    
    C2 -->|No| FAIL2[Dependencies not met]
    C2 -->|Yes| C3
    
    C3 -->|No| FAIL3[Decisions pending]
    C3 -->|Yes| C4
    
    C4 -->|No| FAIL4[Role mismatch]
    C4 -->|Yes| C5
    
    C5 -->|No| FAIL5[Active blockers exist]
    C5 -->|Yes| PASS[DoR Passed ✓]
    
    FAIL1 & FAIL2 & FAIL3 & FAIL4 & FAIL5 --> REJECT[Reject Transition]
    REJECT --> REASON[Return failure reason]
    
    PASS --> RECORD[Record DoR Check]
    RECORD --> PROCEED[Allow Transition]

    style PASS fill:#c8e6c9
    style REJECT fill:#ffcdd2
```

---

## 18. Finding Lifecycle

How review findings are tracked and resolved:

```mermaid
stateDiagram-v2
    [*] --> OPEN: Finding Created
    
    OPEN --> IN_PROGRESS: Developer Starts Fix
    
    IN_PROGRESS --> RESOLVED: Fix Complete\n[With Evidence]
    IN_PROGRESS --> WONT_FIX: Decided Not to Fix\n[With Justification]
    IN_PROGRESS --> OPEN: Fix Blocked
    
    RESOLVED --> [*]: Verified
    WONT_FIX --> [*]: Accepted
    
    RESOLVED --> OPEN: Reopened\n[New Evidence]
    WONT_FIX --> OPEN: Reopened\n[Policy Change]
    
    OPEN --> DUPLICATE: Duplicate of Other\n[Link to Original]
    DUPLICATE --> [*]

    note right of OPEN
        Severities:
        CRITICAL - Blocks release
        HIGH - Blocks task DONE
        MEDIUM - Should fix
        LOW - Nice to have
        INFO - Suggestion only
    end note

    note right of RESOLVED
        Resolution requires:
        - Evidence of fix
        - Commit SHA
        - Resolved timestamp
    end note
```

### Finding Severity Impact

| Severity | Blocks Task DONE | Blocks Release | Required Response |
|----------|------------------|----------------|-------------------|
| CRITICAL | Yes | Yes | Immediate fix |
| HIGH | Yes | Yes | Fix before done |
| MEDIUM | With justification | No | Should fix |
| LOW | No | No | Can defer |
| INFO | No | No | No action required |

---

## Component Summary

```mermaid
mindmap
    root((SDLC Workflow))
        Existing_Components((Existing))
            Team Manager
                Add/Remove Members
                Role Assignment
                Availability Tracking
                Skill Management
            Task Assigner
                Auto Assignment
                Manual Override
                Skill Matching
                Load Balancing
            Dependency Resolver
                Graph Building
                Cycle Detection
                Order Calculation
                Blocking Analysis
            Parallel Group Manager
                Group Identification
                Execution Ordering
                Progress Tracking
                Optimization
            Workload Analyzer
                Metric Calculation
                Bottleneck Detection
                Rebalance Suggestions
                Health Reporting
            Handoff Coordinator
                Context Packaging
                Transfer Management
                Validation
                Status Tracking
        Reliability_Components((New))
            State Controller
                Version Control
                Optimistic Concurrency
                Atomic Updates
                Consistency Validation
            Ownership Manager
                Fencing Tokens
                Lease Management
                Heartbeat Tracking
                Ownership Transfer
            Checkpoint Manager
                Auto Checkpoints
                Manual Checkpoints
                Validation
                Recovery Planning
            Evidence Manager
                Evidence Creation
                Staleness Detection
                Quality Gates
                TDD Validation
            DoR Validator
                Condition Checking
                Revalidation
                Blocking Detection
            Finding Register
                Finding Creation
                Status Tracking
                Severity Management
                Release Blocking
            Audit Logger
                Operation Logging
                Correlation IDs
                Change Tracking
```

---

## See Also

- [POWER.md](./POWER.md) - Main power documentation
- [README.md](./README.md) - Getting started guide
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions
