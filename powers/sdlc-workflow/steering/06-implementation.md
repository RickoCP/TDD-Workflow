---
inclusion: auto
name: "SDLC Implementation"
description: "TDD implementation cycle: RED -> GREEN -> REFACTOR -> VERIFY for each task, with support for parallel multi-developer execution"
---

# SDLC Implementation Phase

## Purpose

The IMPLEMENTATION phase executes tasks using strict Test-Driven Development (TDD). Code changes are only permitted within the TDD cycle with proper evidence. This phase supports both single-developer workflows and parallel multi-developer execution.

## When This Activates

- After PLAN_REVIEW approval
- User says "start task", "implement", "tdd", "red phase", "green phase"
- User says "parallel tasks", "start parallel group", "workload", "handoff"
- Current phase is IMPLEMENTATION

## Prerequisites

- Plan approved
- lifecycle.phase == IMPLEMENTATION
- At least one task in READY status
- For parallel execution: team members registered (see 11-team.md)

## TDD Cycle Overview

```
PENDING -> RED -> GREEN -> REFACTOR -> VERIFY -> COMPLETE
```

Each phase has specific rules and evidence requirements.

## Parallel TDD Overview

When multiple developers work simultaneously, each follows the same TDD cycle independently while coordinating through:

- **Dependency awareness**: Blocking dependencies must be satisfied before starting
- **Parallel groups**: Tasks grouped for concurrent execution
- **Handoffs**: Structured transitions between roles
- **Workload balancing**: Fair distribution of work across team

```
┌─────────────────────────────────────────────────────────────┐
│                    PARALLEL TDD FLOW                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Developer A          Developer B          Developer C      │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐       │
│  │ TASK-01 │         │ TASK-02 │         │ TASK-03 │       │
│  │ RED     │         │ RED     │         │ BLOCKED │       │
│  │ ↓       │         │ ↓       │         │ (wait)  │       │
│  │ GREEN   │         │ GREEN   │         │         │       │
│  │ ↓       │         │ ↓       │         │         │       │
│  │ REFACTOR│         │ REFACTOR│         │ ↓       │       │
│  │ ↓       │         │ ↓       │         │ UNBLOCK │       │
│  │ VERIFY  │ ────────│ VERIFY  │────────>│ RED     │       │
│  │ ↓       │ notify  │ ↓       │         │ ↓       │       │
│  │ DONE    │         │ DONE    │         │ GREEN   │       │
│  └─────────┘         └─────────┘         └─────────┘       │
│                                                             │
│  ═══════════════════════════════════════════════════════   │
│  Parallel Group Progress: 66% (2/3 complete)                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## File Classification

Before any file operation, classify the target:

| Type | Pattern Examples | RED Phase | GREEN Phase |
|------|-----------------|-----------|-------------|
| PRODUCTION_CODE | src/*.ts, lib/*.py, app/* | BLOCKED | ALLOWED |
| TEST_CODE | *.test.ts, *_test.py, __tests__/* | ALLOWED | ALLOWED |
| TEST_FIXTURE | fixtures/*, mocks/*, __mocks__/* | ALLOWED | ALLOWED |
| SDLC_METADATA | .kiro/sdlc/* | ALLOWED | ALLOWED |
| DOCUMENTATION | *.md, docs/* | ALLOWED | ALLOWED |
| CONFIGURATION | *.config.*, *.yaml, *.json | CONTEXT | CONTEXT |

CONTEXT = depends on whether config affects behavior

## Starting a Task

### Single Developer Flow

1. Select next READY task (dependencies satisfied)
2. Update task status to IN_PROGRESS
3. Update current_task in project-state.yaml
4. Set tdd.phase to PENDING
5. Begin TDD cycle

### Multi-Developer Flow

**Trigger**: User says "start my task", "pick up task", "work on TASK-xxx"

1. Validate developer is registered (`team.members[]` contains developer)
2. Select next READY task assigned to developer OR available for pickup
3. Verify dependency constraints via `Dependency_Resolver.canTransitionToInProgress(taskId)`
4. If blocked, show blocking dependencies and suggest alternatives
5. Update task status to IN_PROGRESS with assignee
6. Update current_task in project-state.yaml with assignee
7. If task is in a parallel group, notify `Parallel_Group_Manager`
8. Set tdd.phase to PENDING
9. Begin TDD cycle

**Dependency Check Example**:
```
Checking dependencies for TASK-005...
✗ BLOCKED: Cannot start TASK-005

Blocking dependencies not satisfied:
  - TASK-003 (backend API) - IN_PROGRESS by dev-001
  - TASK-004 (database schema) - VERIFY by dev-002

Estimated unblock: When TASK-003 and TASK-004 reach DONE status.

Alternative tasks available:
  - TASK-007 (frontend styling) - READY, assigned to you
  - TASK-009 (test fixtures) - READY, available for pickup

Would you like to start one of these instead?
```

### Parallel Group Task Selection

When starting work in a parallel group:

1. Check parallel group status via `Parallel_Group_Manager.getGroupProgress(groupId)`
2. Show group progress and available tasks
3. Recommend task based on workload balance

**Example**:
```
Parallel Group: PG-001 (Sprint 1 - Core Features)
Progress: 33% (1/3 tasks complete)

Available tasks in this group:
  - TASK-002 (User Registration) - READY, role: backend
  - TASK-003 (Login API) - READY, role: backend

Your workload: 2 active tasks
Team average: 2.5 active tasks

Recommendation: Start TASK-002 (balances team workload)
```

## RED Phase

### Purpose
Write a failing test that defines the expected behavior.

### Rules
- ALLOWED: Test code, test fixtures, SDLC metadata
- BLOCKED: Production code

### Steps

1. Derive test from acceptance criteria
2. Write the test
3. Run the test
4. **TEST MUST FAIL**
5. Verify failure is due to missing behavior (not test error)
6. Record evidence

### If Test Passes Unexpectedly

**STOP IMMEDIATELY**

Investigate:
- Behavior already exists?
- Test is wrong?
- Test not actually testing the behavior?
- Requirement already satisfied?
- Fixture/mock returning wrong data?

Do NOT proceed to GREEN until RED is legitimate.

### Evidence Required

Create evidence/TASK-xxx/red.md with:
- task_id
- timestamp
- command executed
- result: FAIL
- test_file path
- test_name
- output excerpt (max 50 lines)
- analysis confirming legitimate failure
- git_ref if available

## GREEN Phase

### Purpose
Write minimum implementation to make the test pass.

### Prerequisites
- Valid RED evidence exists
- tdd.phase == RED completed

### Rules
- ALLOWED: Production code, test code, SDLC metadata
- FORBIDDEN: Unrelated refactoring, scope creep

### Steps

1. Write minimum code to pass the test
2. Run the test
3. **TEST MUST PASS**
4. Record evidence

### Evidence Required

Create evidence/TASK-xxx/green.md with:
- task_id
- timestamp
- command executed
- result: PASS
- files_changed list
- implementation summary
- output excerpt
- git_ref if available

## REFACTOR Phase

### Purpose
Improve code quality while maintaining behavior.

### Prerequisites
- Valid GREEN evidence exists
- tdd.phase == GREEN completed

### Rules
- ALLOWED: Code quality improvements
- FORBIDDEN: Behavioral changes

### Refactoring Activities
- Improve naming
- Remove duplication
- Simplify logic
- Improve boundaries
- Align with architecture

### Steps

1. Identify refactoring opportunities
2. Make improvements
3. Run tests
4. **TESTS MUST STILL PASS**
5. Record evidence (or "no refactoring needed")

### Evidence Required

Create evidence/TASK-xxx/refactor.md with:
- task_id
- timestamp
- refactoring_performed: true/false
- changes made (or rationale for none)
- test result: PASS
- git_ref if available

## VERIFY Phase

### Purpose
Run verification suite appropriate to task risk level.

### Prerequisites
- Valid REFACTOR evidence exists
- tdd.phase == REFACTOR completed

### Verification by Risk

| Risk | Required Checks |
|------|----------------|
| LOW | Unit tests, lint, type check |
| MEDIUM | + Integration tests |
| HIGH | + Regression tests |
| CRITICAL | + E2E, security, performance |

### Steps

1. Determine verification scope from task risk
2. Run all applicable checks
3. Record results
4. All must PASS to proceed

### Evidence Required

Create evidence/TASK-xxx/verify.md with:
- task_id
- risk_level
- verification_scope
- results for each check
- overall_result: PASS/FAIL
- Definition of Done checklist status

## Handling Verification Failure

When verification fails, classify the failure:

| Failure Type | Return To | Action |
|-------------|-----------|--------|
| Missing behavior | RED | Add test for missing behavior |
| Implementation defect | GREEN | Fix implementation |
| Refactoring regression | REFACTOR | Fix refactoring |
| Test defect | RED | Fix test |
| Integration issue | GREEN | Fix integration |
| Requirement ambiguity | BLOCKED | Clarify requirement |
| Architecture problem | BLOCKED | Review design |

**Principle**: Return to the earliest invalidated phase.

## Task Completion

When VERIFY passes:

1. Update task status to DONE
2. Update tdd.phase to COMPLETE
3. Update traceability with test refs and evidence path
4. Update project-state counters
5. Select next task or proceed to INTEGRATION

### Multi-Developer Task Completion

When a task is completed in a multi-developer context:

1. Perform standard task completion steps (1-4 above)
2. Notify `Parallel_Group_Manager.notifyTaskCompletion(taskId)` if task is in a group
3. Update parallel group progress
4. Check if completion unblocks dependent tasks
5. Notify developers with unblocked tasks
6. If task triggers a handoff point, initiate handoff workflow

**Completion with Handoff**:
```
✓ TASK-001 (Backend API) completed by dev-001

Handoff triggered: Backend to Frontend Handoff (HP-001)
Target role: frontend
Checklist items: 3 (2 required)

Initiating handoff to frontend team...
See handoff section for next steps.
```

---

## Parallel TDD Coordination

### Overview

Parallel TDD enables multiple developers to work on independent tasks simultaneously while respecting dependencies and maintaining TDD discipline. The system coordinates through three key components:

| Component | Responsibility |
|-----------|---------------|
| **Parallel_Group_Manager** | Groups tasks for concurrent execution, tracks progress |
| **Dependency_Resolver** | Enforces blocking/non-blocking dependency constraints |
| **Workload_Analyzer** | Balances work distribution, identifies bottlenecks |

### Parallel Group Progress Tracking

**Trigger**: User says "group status", "parallel progress", "sprint status"

Display current parallel group status:

```
Parallel Group: PG-001 (Sprint 1 - Core Features)
Status: IN_PROGRESS
Progress: 66% (2/3 tasks complete)

Tasks:
  ✓ TASK-001 (User Model) - DONE by dev-001
  ✓ TASK-002 (Auth Service) - DONE by dev-002
  ○ TASK-003 (API Gateway) - IN_PROGRESS by dev-003 [GREEN phase]

No internal blocking dependencies.
Estimated completion: When TASK-003 reaches DONE.
```

### Dependency-Aware Phase Transitions

The TDD cycle must respect dependency constraints:

| Phase Transition | Dependency Check | Action if Blocked |
|-----------------|------------------|-------------------|
| PENDING → RED | `canTransitionToInProgress()` | Wait for blocking deps |
| VERIFY → DONE | `canTransitionToDone()` | Wait for non-blocking deps |

**Blocking Dependency Behavior**:
- Tasks with unsatisfied blocking dependencies cannot enter RED phase
- Show clear status of what's blocking and estimated unblock time
- Suggest alternative tasks that are available

**Non-Blocking Dependency Behavior**:
- Tasks can proceed through RED → GREEN → REFACTOR → VERIFY
- Cannot transition to DONE until non-blocking dependencies are satisfied
- Useful for parallel work where integration happens at completion

**Example Dependency Flow**:
```
TASK-005 depends on:
  - TASK-003 (blocking) - Must be DONE before starting
  - TASK-004 (non_blocking) - Must be DONE before completing

Current status:
  - TASK-003: VERIFY → Can start TASK-005 soon
  - TASK-004: IN_PROGRESS → Can start TASK-005, but cannot complete until TASK-004 is DONE
```

### Workload Balancing During Implementation

**Trigger**: User says "workload", "team balance", "who's available"

The `Workload_Analyzer` provides real-time workload visibility:

```
Team Workload Distribution:

| Developer | Active | Blocked | Pending | Total | Status |
|-----------|--------|---------|---------|-------|--------|
| dev-001   | 2      | 0       | 1       | 3     | OK     |
| dev-002   | 4      | 1       | 2       | 7     | ⚠ HIGH |
| dev-003   | 1      | 0       | 0       | 1     | LOW    |

Team average: 3.7 tasks/developer

Bottlenecks detected:
  ⚠ dev-002 has 5 active/blocked tasks (threshold: 3)
  
Recommendations:
  • Reassign TASK-008 from dev-002 to dev-003 (same role: backend)
  • Consider redistributing TASK-010 (frontend) to balance load
```

### Bottleneck Identification

The system automatically identifies bottlenecks:

**Developer Bottleneck**: More than 3 tasks in IN_PROGRESS or BLOCKED status
```
⚠ Bottleneck: dev-002 (Alice)
   Active tasks: 5 (threshold: 3)
   Impact: May delay TASK-010, TASK-012
   
Suggested action: Reassign 2 tasks to dev-003 who has capacity
```

**Role Bottleneck**: More pending tasks than available developers for a role
```
⚠ Role Bottleneck: qa
   Pending tasks: 8
   Available developers: 2
   Tasks per developer: 4.0
   
Suggested action: Add QA resource or prioritize critical tasks
```

### Coordination Points

During parallel execution, coordination happens at these points:

1. **Task Start**: Check dependencies, update parallel group
2. **Phase Transition**: Validate dependency constraints
3. **Task Completion**: Notify dependent tasks, update group progress
4. **Handoff Trigger**: Initiate cross-role handoff when applicable
5. **Blocking Detected**: Suggest alternatives, notify blocked developer

---

## Handoff Integration During Implementation

### Overview

Handoffs manage structured transitions between roles during implementation. When a task owned by one role completes, work may need to transition to another role (e.g., backend → frontend).

### Handoff Workflow

```
Source Developer                              Target Developer
     │                                              │
     ├── Complete task ────────────────────────────>│
     │                                              │
     ├── Handoff triggered ─────────────────────────│
     │                                              │
     ├── Complete checklist ───────────────────────>│
     │   ☑ API documentation updated                │
     │   ☑ Sample request/response provided         │
     │   ☐ Error codes documented                   │
     │                                              │
     ├── Submit handoff ───────────────────────────>│
     │                                              │
     │<──────────────────────────── Accept/Reject ──┤
     │                                              │
     │   [If rejected: address feedback, resubmit]  │
     │                                              │
     │<────────────────────────────── Handoff done ─┤
     │                                              │
     └──────────────────────────────────────────────┴── Target starts TDD
```

### Initiating a Handoff

**Trigger**: Task completion triggers handoff point, or user says "initiate handoff"

1. Verify source task is DONE
2. Find applicable handoff point via `Handoff_Coordinator.getHandoffPointsByRole(sourceRole)`
3. Display checklist requirements
4. Guide developer through checklist completion

**Example**:
```
Handoff Required: Backend to Frontend (HP-001)

Source: TASK-001 (User API) by dev-001 (backend)
Target: TASK-005 (User UI) for frontend role

Checklist (2 required, 1 optional):
  ☐ [Required] API documentation updated
  ☐ [Required] Sample request/response provided
  ☐ [Optional] Error codes documented

Complete the required items to submit handoff.
```

### Completing Handoff Checklist

For each checklist item:

1. Developer confirms item is complete
2. System records completion timestamp and developer ID
3. Progress toward handoff submission is tracked

**Example**:
```
Checklist Progress: 2/2 required items complete

  ✓ API documentation updated (completed by dev-001 at 10:30)
  ✓ Sample request/response provided (completed by dev-001 at 10:45)
  ○ Error codes documented (optional, skipped)

Ready to submit handoff. Proceed? [Y/n]
```

### Accepting or Rejecting a Handoff

**Trigger**: Target developer says "accept handoff", "reject handoff"

**Acceptance**:
1. Target developer picks up the handoff
2. System records acceptance timestamp and developer ID
3. Target task becomes ready for TDD cycle
4. Source developer is notified

**Example**:
```
Handoff HO-001 accepted by dev-002 (frontend)

TASK-005 (User UI) is now ready for implementation.
Starting TDD cycle...
```

**Rejection**:
1. Target developer provides rejection reason
2. Handoff returns to source developer
3. Source developer must address feedback

**Example**:
```
Handoff HO-001 rejected by dev-002 (frontend)

Reason: API documentation missing authentication flow examples.

Action required for dev-001:
  • Update API documentation with auth examples
  • Re-complete checklist
  • Resubmit handoff
```

### Active Handoffs View

**Trigger**: User says "show handoffs", "pending handoffs", "handoff status"

```
Active Handoffs:

| ID     | From        | To          | Status            | Age  |
|--------|-------------|-------------|-------------------|------|
| HO-001 | dev-001 (BE)| frontend    | PENDING_ACCEPTANCE| 2h   |
| HO-002 | dev-003 (FE)| qa          | CHECKLIST_IN_PROG | 30m  |

Pending for your role (frontend):
  • HO-001: User API → User UI (checklist complete, awaiting acceptance)

Your pending handoffs:
  • HO-002: Login UI → Login Tests (1/3 checklist items complete)
```

---

## Multi-Developer Implementation Guardrails

In addition to standard TDD guardrails, parallel execution adds:

### Assignment Guardrails

- Each developer MUST work only on their assigned task
- Task reassignment requires explicit action via `Task_Assigner`
- Unassigned tasks require pickup before starting

### Dependency Guardrails

- NO starting tasks with unsatisfied blocking dependencies
- NO completing tasks with unsatisfied non-blocking dependencies  
- Dependency cycle detection prevents deadlock situations

### Parallel Group Guardrails

- Tasks in a parallel group MUST NOT have internal blocking dependencies
- Group progress is automatically tracked and reported
- Group completion triggers milestone progress update

### Handoff Guardrails

- Handoffs MUST complete required checklist items
- Rejected handoffs MUST be addressed before resubmission
- Only developers with matching role can accept handoffs

## TDD NOT_APPLICABLE

Only for tasks without executable behavior:

- Documentation-only
- Configuration without behavioral effect
- Static assets

Required fields:
- reason: Why TDD not applicable
- task_reference: The task ID
- risk_assessment: Must be LOW or NONE
- verification_alternative: How it was verified instead

## Guardrails

### Core TDD Guardrails

- NO production code without active task
- NO GREEN without RED evidence
- NO REFACTOR without GREEN evidence
- NO DONE without VERIFY evidence
- Evidence must match task and phase
- Evidence must contain required fields

### Multi-Developer Guardrails

See "Multi-Developer Implementation Guardrails" section above for:
- Assignment guardrails (developer scope)
- Dependency guardrails (blocking/non-blocking)
- Parallel group guardrails (no internal blocking deps)
- Handoff guardrails (checklist completion, role matching)

### Integration with Team Components

| Component | Integration Point | Purpose |
|-----------|------------------|---------|
| `Team_Manager` | Task start, assignment | Validate developer exists and roles |
| `Task_Assigner` | Task pickup, reassignment | Manage task ownership |
| `Dependency_Resolver` | Phase transitions | Enforce dependency constraints |
| `Parallel_Group_Manager` | Task start/complete | Track group progress |
| `Workload_Analyzer` | Task selection | Balance workload |
| `Handoff_Coordinator` | Task completion | Manage role transitions |
