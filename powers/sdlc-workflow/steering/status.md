---
inclusion: auto
name: "SDLC Status"
description: "Reports current workflow status and progress including team workload and parallel execution"
---

# SDLC Status Reporting

## Purpose

Report current workflow position and progress, including team composition, workload distribution, parallel execution status, and handoff tracking for multi-developer workflows.

## When This Activates

- User says "status", "progress", "where are we"
- User asks about team status, workload, or bottlenecks
- User wants to see parallel group progress
- User asks about active handoffs

## Status Report Content

### Lifecycle Position

- Current phase
- Phase started timestamp
- Last transition

### Milestone

- Current milestone ID and name
- Target date (if set)

### Requirements Progress

| Status | Count |
|--------|-------|
| DRAFT | X |
| REVIEW | X |
| APPROVED | X |
| FROZEN | X |
| Total | X |

### Task Progress

| Status | Count |
|--------|-------|
| TODO | X |
| READY | X |
| IN_PROGRESS | X |
| BLOCKED | X |
| VERIFY | X |
| DONE | X |
| Total | X |

### Current Task (if any)

- Task ID
- Task status
- Assignee (if assigned)
- TDD phase
- Phase started timestamp

### Blockers

- Count
- IDs and brief descriptions

### Pending Changes

- Count
- CR IDs

### Release Status

- Current release status
- Target version

### Last Action

- What was done
- Timestamp
- Result

### Next Permitted Actions

List of valid next actions based on current state.

---

## Team Status (Multi-Developer Mode)

When team members are registered, include team-aware status sections.

### Team Composition

Display team composition from `Team_Manager.listMembers()`:

```
Team Composition (X members):

| ID       | Name              | Roles            | Status   |
|----------|-------------------|------------------|----------|
| dev-001  | Alice Developer   | backend, devops  | ACTIVE   |
| dev-002  | Bob Frontend      | frontend         | ACTIVE   |
| dev-003  | Charlie QA        | qa               | ACTIVE   |

By Role:
- Frontend: X member(s)
- Backend: X member(s)  
- QA: X member(s)
- DevOps: X member(s)
- Fullstack: X member(s)
- Lead: X member(s)
```

**Source**: `project-state.yaml → team.members` and `team.statistics`

### Per-Developer Workload

Display workload distribution from `Workload_Analyzer.getTeamWorkloadDistribution()`:

```
Developer Workload:

| Developer | TODO | READY | IN_PROGRESS | BLOCKED | VERIFY | DONE | Total |
|-----------|------|-------|-------------|---------|--------|------|-------|
| dev-001   | 1    | 2     | 1           | 0       | 1      | 3    | 8     |
| dev-002   | 0    | 1     | 2           | 1       | 0      | 2    | 6     |
| dev-003   | 2    | 0     | 0           | 0       | 2      | 4    | 8     |
| Unassigned| 3    | 1     | 0           | 0       | 0      | 0    | 4     |

Team Average: X.X tasks per developer
```

**Source**: `project-state.yaml → tasks.by_assignee` and `Workload_Analyzer`

### Role-Based Task Distribution

Show tasks grouped by required role:

```
Tasks by Required Role:

| Role      | TODO | READY | IN_PROGRESS | Unassigned |
|-----------|------|-------|-------------|------------|
| frontend  | 2    | 1     | 1           | 1          |
| backend   | 3    | 2     | 2           | 0          |
| qa        | 4    | 0     | 0           | 2          |
| devops    | 1    | 1     | 0           | 0          |
| any       | 2    | 0     | 1           | 1          |

Note: "any" = tasks with no role_required specified
```

**Source**: Task files `role_required` field aggregated by `Workload_Analyzer`

---

## Bottleneck Identification

Display bottlenecks identified by `Workload_Analyzer.identifyBottlenecks()`:

### Developer Bottlenecks

Developers with more than 3 tasks in IN_PROGRESS or BLOCKED status:

```
⚠️ Developer Bottlenecks Detected:

| Developer | Active Tasks | Severity | Recommendation |
|-----------|--------------|----------|----------------|
| dev-001   | 4            | HIGH     | Consider reassigning TASK-007 to dev-003 |
| dev-002   | 5            | CRITICAL | 2 tasks are BLOCKED - resolve dependencies |

Active = IN_PROGRESS + BLOCKED tasks
Threshold: > 3 active tasks
```

### Role Capacity Bottlenecks

Roles with more pending tasks than available developers:

```
⚠️ Role Capacity Bottlenecks:

| Role     | Pending Tasks | Available Devs | Gap | Recommendation |
|----------|---------------|----------------|-----|----------------|
| backend  | 8             | 1              | +7  | Add backend developer or reassign to fullstack |
| qa       | 6             | 1              | +5  | Consider parallel QA sessions |
```

### Critical Path Tasks

Tasks blocking the most downstream work (from `Dependency_Resolver.getCriticalPath()`):

```
🔴 Critical Path Tasks:

1. TASK-003 (BLOCKED) → Blocks: TASK-007, TASK-008, TASK-012
   Assignee: dev-001 | Reason: Waiting on external API
   
2. TASK-005 (IN_PROGRESS) → Blocks: TASK-009, TASK-010
   Assignee: dev-002 | Expected completion: 2 days
```

**Source**: `Workload_Analyzer.identifyBottlenecks()` and `Dependency_Resolver`

---

## Parallel Group Progress

Display progress for parallel task groups from `Parallel_Group_Manager`:

```
Parallel Groups:

┌─────────────────────────────────────────────────────────────────┐
│ PG-001: Sprint 1 - Core Features                                │
│ Milestone: M1 | Status: IN_PROGRESS                             │
├─────────────────────────────────────────────────────────────────┤
│ Progress: ████████████░░░░░░░░ 60% (3/5 tasks)                 │
│                                                                 │
│ Tasks:                                                          │
│   ✓ TASK-001: User authentication API (dev-001) - DONE          │
│   ✓ TASK-002: Database schema setup (dev-001) - DONE            │
│   ✓ TASK-003: Frontend login form (dev-002) - DONE              │
│   ◐ TASK-004: Session management (dev-001) - IN_PROGRESS        │
│   ○ TASK-005: Login page styling (dev-002) - READY              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ PG-002: Sprint 1 - Testing                                      │
│ Milestone: M1 | Status: PENDING                                 │
├─────────────────────────────────────────────────────────────────┤
│ Progress: ░░░░░░░░░░░░░░░░░░░░ 0% (0/3 tasks)                  │
│                                                                 │
│ Tasks:                                                          │
│   ○ TASK-010: Unit tests for auth (dev-003) - TODO              │
│   ○ TASK-011: Integration tests (dev-003) - TODO                │
│   ○ TASK-012: E2E tests (dev-003) - TODO                        │
│                                                                 │
│ ⚠️ Blocked by: PG-001 (must complete first)                     │
└─────────────────────────────────────────────────────────────────┘

Summary:
- Total groups: 2
- In Progress: 1 (PG-001)
- Pending: 1 (PG-002)
- Completed: 0
```

**Source**: `project-state.yaml → parallel_groups` and `Parallel_Group_Manager.getGroupProgress()`

---

## Active Handoffs

Display pending and in-progress handoffs from `Handoff_Coordinator`:

```
Active Handoffs:

┌─────────────────────────────────────────────────────────────────┐
│ HO-001: Backend to Frontend Handoff                             │
│ Status: PENDING_ACCEPTANCE                                      │
├─────────────────────────────────────────────────────────────────┤
│ Source: TASK-001 (dev-001, backend) → Target: TASK-005 (frontend)│
│ Initiated: 2024-01-15T11:00:00Z                                 │
│                                                                 │
│ Checklist:                                                      │
│   ✓ API documentation updated (required)                        │
│   ✓ Sample request/response provided (required)                 │
│   ○ Error codes documented (optional)                           │
│                                                                 │
│ → Waiting for frontend developer to accept                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ HO-002: Backend to QA Handoff                                   │
│ Status: CHECKLIST_IN_PROGRESS                                   │
├─────────────────────────────────────────────────────────────────┤
│ Source: TASK-003 (dev-001, backend) → Target: TASK-010 (qa)     │
│ Initiated: 2024-01-15T14:00:00Z                                 │
│                                                                 │
│ Checklist (1/3 complete):                                       │
│   ✓ Test cases documented (required)                            │
│   ○ Test data provided (required) ← BLOCKING                    │
│   ○ Known issues listed (optional)                              │
│                                                                 │
│ → Source developer must complete required items                 │
└─────────────────────────────────────────────────────────────────┘

Pending Handoffs by Role:
- frontend: 1 handoff waiting for pickup
- qa: 0 handoffs ready
- backend: 0 handoffs ready
```

**Source**: `project-state.yaml → handoffs` and `Handoff_Coordinator.getActiveHandoffs()`

---

## Validation Status

If validation has been run:

- Last validated timestamp
- Result (VALID/WARNINGS/ERRORS)
- Issues if any

### Team Validation Status

Additional team-specific validation results:

```
Team Validation:
- Member IDs: ✓ All unique
- Roles: ✓ All valid
- Assignments: ✓ All reference valid developers
- Dependencies: ✓ No cycles detected
- Parallel Groups: ✓ No internal blocking dependencies
- Handoffs: ✓ All checklists have items
```

---

## Progress Summary

Human-readable summary of overall progress toward milestone completion.

### Team Progress Summary

When team is active, include team-specific summary:

```
Team Progress Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Overall: 45% complete (9/20 tasks done)
👥 Team: 3 active members across 4 roles
⚡ Parallel: 1 group in progress (60% complete)
🔄 Handoffs: 2 active (1 pending acceptance)
⚠️ Bottlenecks: 1 developer overloaded, 1 role under-capacity

Top Priorities:
1. Resolve TASK-003 block (critical path)
2. Accept handoff HO-001 (frontend waiting)
3. Rebalance dev-001 workload (5 active tasks)

Estimated Completion:
- Current velocity: 2.5 tasks/day
- Remaining tasks: 11
- Projected completion: ~4-5 days
```

---

## Component References

This status report integrates data from:

| Component | Data Provided |
|-----------|---------------|
| `Team_Manager` | Team composition, member details, role statistics |
| `Task_Assigner` | Task assignments, by_assignee counts |
| `Workload_Analyzer` | Workload distribution, bottleneck identification |
| `Parallel_Group_Manager` | Group progress, group status |
| `Handoff_Coordinator` | Active handoffs, checklist status |
| `Dependency_Resolver` | Critical path, blocking dependencies |

---

## Guardrails

- Team sections only display when `team.members` is non-empty
- Bottleneck threshold: > 3 tasks in IN_PROGRESS or BLOCKED status
- Parallel groups show task-level detail for groups with ≤ 10 tasks
- Large groups (> 10 tasks) show summary only
- Handoff status reflects real-time checklist completion
- Role capacity is calculated based on ACTIVE members only
- Inactive team members are excluded from workload calculations

## Troubleshooting

### "No team data available"
- Team members may not be registered yet
- Use `team list` to check team composition
- Register members with `team add` command

### Bottleneck thresholds seem wrong
- Threshold is fixed at > 3 active tasks per developer
- Only IN_PROGRESS and BLOCKED tasks count as "active"
- TODO, READY, VERIFY, and DONE tasks don't trigger bottleneck

### Parallel group progress not updating
- Verify task status changes are being persisted
- Call `Parallel_Group_Manager.notifyTaskCompletion()` on task completion
- Check that tasks are properly associated with the group

### Handoff checklist incomplete
- Required items must be completed before handoff can proceed
- Optional items don't block handoff acceptance
- Source developer must complete checklist before target can accept
