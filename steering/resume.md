---
inclusion: auto
name: "SDLC Resume"
description: "Recovers workflow state after session interruption or context compaction"
---

# SDLC Resume Workflow

## Purpose

Recover workflow state after session crash, context compaction, or new session start.

## When This Activates

- New session starts
- User says "resume", "continue", "where were we"
- Context was compacted

## Resume Process

### 1. Read Project State

```
.kiro/sdlc/project-state.yaml
```

### 2. Validate Against Repository

Check that state matches reality:

- Referenced files exist
- Counter totals match file counts
- Evidence files exist for claimed phases
- Git status (uncommitted changes?)
- Test state matches claimed results

### 3. Detect Discrepancies

Common discrepancies:

| Issue | Detection | Action |
|-------|-----------|--------|
| File count mismatch | Counter != files | Reconcile counts |
| Missing evidence | Path not found | Mark phase unverified |
| Stale evidence | Code changed after verify | Mark evidence STALE |
| Partial transaction | State inconsistent | Rollback to last consistent |
| Uncommitted changes | Git shows changes | Report to user |

### 4. Reconcile

For minor issues: auto-correct state
For major issues: report and request guidance

### 5. Report Current Position

Present to user:

- Current lifecycle phase
- Current milestone
- Current task (if any)
- Current TDD phase (if applicable)
- Active blockers
- Pending changes
- Last completed action
- Next permitted actions

### 6. Await Confirmation

Do NOT auto-resume code changes.

Wait for user to confirm next action.

## Team Context Recovery

For multi-developer projects (when `team.members` exists in project-state.yaml), additional recovery steps apply.

### 1. Recover Team State

Read team composition from `project-state.yaml`:

```yaml
team:
  members:
    - id: "dev-001"
      name: "Alice Developer"
      roles: [backend, devops]
      status: ACTIVE
  statistics:
    total_members: 2
    by_role:
      backend: 1
      frontend: 1
```

**Validation**:
- Verify all member IDs are unique
- Verify all roles are valid (frontend, backend, qa, devops, fullstack, lead)
- Verify statistics match member count
- Use `Team_Manager.listMembers()` to validate consistency

**Report Team State**:
```
Team Composition (2 members):
- dev-001: Alice Developer (backend, devops) - ACTIVE
- dev-002: Bob Frontend (frontend) - ACTIVE
```

### 2. Recover Assignment State

For each task with an assignee, recover developer-task associations:

```yaml
tasks:
  by_assignee:
    "dev-001": 3
    "dev-002": 2
    unassigned: 5

current_task:
  id: TASK-003
  assignee: "dev-001"
```

**Validation**:
- Verify assignee IDs reference valid team members
- Verify `by_assignee` counts match actual task files
- Verify assigned developers have required roles for their tasks
- Use `Task_Assigner.getTasksByDeveloper()` to validate

**Report Assignment State**:
```
Task Assignments:
- dev-001 (Alice): 3 tasks (1 IN_PROGRESS, 2 TODO)
- dev-002 (Bob): 2 tasks (1 READY, 1 TODO)
- Unassigned: 5 tasks

Current Work:
- dev-001 is working on TASK-003 (TDD GREEN phase)
```

### 3. Recover Parallel Group Progress

Read parallel group state from `project-state.yaml`:

```yaml
parallel_groups:
  - id: "PG-001"
    name: "Sprint 1 - Core Features"
    tasks: ["TASK-001", "TASK-002", "TASK-003"]
    status: IN_PROGRESS
    progress:
      total: 3
      completed: 1
      percentage: 33
```

**Validation**:
- Verify all task IDs in groups exist
- Verify no internal blocking dependencies within groups
- Verify progress percentages match actual task completion
- Use `Parallel_Group_Manager.getGroupProgress()` to validate

**Discrepancy Detection**:

| Issue | Detection | Action |
|-------|-----------|--------|
| Missing task in group | Task ID not found | Remove from group, update progress |
| Stale progress | Percentage != (completed/total)*100 | Recalculate progress |
| Internal dependency added | Task in group depends on group member | Report conflict, request guidance |
| Group stuck | No progress in IN_PROGRESS group | Identify blocked tasks |

**Report Parallel Group State**:
```
Parallel Groups:
- PG-001 "Sprint 1 - Core Features": 33% (1/3 complete)
  - TASK-001: DONE (dev-001)
  - TASK-002: IN_PROGRESS (dev-002)
  - TASK-003: TODO (unassigned)
```

### 4. Recover Pending Handoffs

Read handoff state from `project-state.yaml`:

```yaml
handoffs:
  - id: "HO-001"
    handoff_point: "HP-001"
    source_task: "TASK-001"
    target_task: "TASK-005"
    source_developer: "dev-001"
    target_developer: null
    status: PENDING_ACCEPTANCE
    checklist_status:
      - item_id: "CHK-001"
        completed: true
      - item_id: "CHK-002"
        completed: false
```

**Validation**:
- Verify handoff point definitions exist
- Verify source/target tasks exist
- Verify source/target developers are valid team members
- Verify checklist items match handoff point definition
- Use `Handoff_Coordinator.getActiveHandoffs()` to validate

**Report Handoff State**:
```
Pending Handoffs:
- HO-001 (Backend → Frontend):
  Source: TASK-001 (dev-001) ✓ Complete
  Target: TASK-005 (awaiting acceptance)
  Status: PENDING_ACCEPTANCE
  Checklist: 1/2 items complete
  Action needed: Frontend developer to accept handoff
```

### 5. Recover Developer-Specific Context

For each active team member, report their context:

**Developer Context Report**:
```
Developer: dev-001 (Alice Developer)
  Role(s): backend, devops
  Status: ACTIVE
  Current task: TASK-003 (IN_PROGRESS, TDD GREEN phase)
  Pending tasks: TASK-007 (TODO), TASK-012 (READY)
  Blocking: None
  Pending handoffs: HO-001 (waiting for frontend acceptance)

Developer: dev-002 (Bob Frontend)
  Role(s): frontend
  Status: ACTIVE
  Current task: None
  Pending tasks: TASK-005 (blocked by handoff), TASK-008 (TODO)
  Blocking: Waiting for HO-001 acceptance
  Action needed: Accept handoff HO-001 to unblock TASK-005
```

## Team Discrepancy Detection

Additional discrepancies for multi-developer projects:

| Issue | Detection | Action |
|-------|-----------|--------|
| Orphaned assignment | Assignee ID not in team | Unassign task, report to user |
| Role mismatch | Assignee lacks role_required | Report conflict, suggest reassignment |
| Stale handoff | Source task modified after initiation | Mark handoff STALE, request re-verification |
| Stuck handoff | PENDING_ACCEPTANCE > 24 hours | Highlight as action needed |
| Developer overload | >3 IN_PROGRESS/BLOCKED tasks | Flag bottleneck |
| Inactive with tasks | INACTIVE member has assignments | Report for reassignment |

## Team Context Recovery Order

When resuming a multi-developer project:

```
1. Repository reality (tests, files, task files)
2. Git state
3. Team member definitions
4. Task assignments (verify against team)
5. Parallel group state (verify against tasks)
6. Handoff state (verify against tasks and team)
7. project-state.yaml
8. Derived docs
9. Conversation context
```

## Source of Truth Precedence

```
1. Repository reality (tests, files)
2. Git state
3. Authoritative artifacts
4. project-state.yaml
5. Derived docs
6. Conversation context
```

Repository reality wins over stale state.

---

## Checkpoint-Based Recovery

### Overview

Checkpoints capture workflow state at key moments, enabling recovery after crashes, context resets, or session interruptions. The `Checkpoint_Manager` handles checkpoint creation and recovery.

### Checkpoint Location

```
.kiro/sdlc/checkpoints/
├── CP-2026-10-12-001.yaml
├── CP-2026-10-12-002.yaml
└── CP-2026-10-12-003.yaml
```

### Checkpoint Contents

Each checkpoint captures:

```yaml
checkpoint_id: "CP-2026-10-12-001"
created_at: "2026-10-12T10:30:00Z"
created_by: "dev-001"
trigger: "tdd_phase_transition"

snapshot:
  state_version: 42
  task_id: "TASK-003"
  task_status: IN_PROGRESS
  owner_id: "dev-001"
  fencing_token: "550e8400-e29b-41d4-a716-446655440000"
  tdd_phase: GREEN
  
  # Git state
  branch_name: "task/TASK-003-user-auth"
  commit_sha: "abc123def456"
  uncommitted_changes:
    - path: "src/auth.ts"
      type: "modified"
  
  # Evidence collected
  evidence_refs:
    - "EVD-TASK-003-RED"
  
  # Blockers
  blockers: []
  
  # Recommended next action
  next_action: "Continue GREEN phase: implement minimum code to pass test"
```

### Automatic Checkpoint Triggers

Checkpoints are automatically created on:

| Trigger | Description |
|---------|-------------|
| `state_transition` | Task status changes (TODO → IN_PROGRESS) |
| `tdd_phase_transition` | TDD phase advances (RED → GREEN) |
| `evidence_created` | New evidence file recorded |
| `handoff` | Handoff initiated or completed |
| `periodic` | Configurable interval (default: 15 min if active) |
| `manual` | User explicitly requests checkpoint |

### Recovery Process

**Trigger**: User says "recover", "restore checkpoint", "resume from checkpoint"

```
1. Read Available Checkpoints

   Checkpoints for TASK-003:
   ┌─────────────────────┬───────────┬──────────────────────┐
   │ ID                  │ Trigger   │ State                │
   ├─────────────────────┼───────────┼──────────────────────┤
   │ CP-2026-10-12-003   │ manual    │ GREEN phase, v=45    │
   │ CP-2026-10-12-002   │ tdd_phase │ GREEN phase, v=43    │
   │ CP-2026-10-12-001   │ evidence  │ RED complete, v=42   │
   └─────────────────────┴───────────┴──────────────────────┘
   
   Latest: CP-2026-10-12-003 (2 hours ago)

2. Validate Checkpoint Against Current State

   Validating CP-2026-10-12-003...
   
   ✓ Checkpoint commit abc123 exists and is reachable
   ✓ Branch task/TASK-003-user-auth exists
   ⚠ Current HEAD is def456 (2 commits ahead of checkpoint)
   ⚠ State version: checkpoint=45, current=47
   ✓ Fencing token still valid for dev-001
   ✓ Evidence files exist
   
   Discrepancies detected (see below)

3. Generate Recovery Plan

   Recovery Plan for CP-2026-10-12-003:
   
   Discrepancies:
   - State version mismatch (45 vs 47)
   - 2 commits added since checkpoint
   - Files modified: src/auth.ts, src/auth.test.ts
   
   Strategy: PROMPT_USER
   
   Proposed Actions:
   1. Preserve current work (uncommitted changes safe)
   2. Update state to reflect current git position
   3. Mark checkpoint as reconciled
   4. Continue from TDD GREEN phase
   
   WARNING: Some work may have occurred outside workflow.

4. User Confirmation Required

   Proceed with recovery? [Y/n/details]
```

### Recovery Strategies

| Strategy | When Used | Action |
|----------|-----------|--------|
| `AUTO_MERGE` | Changes compatible, no conflicts | Auto-reconcile and continue |
| `PROMPT_USER` | Conflicts or ambiguity detected | Show plan, await confirmation |
| `REJECT` | Checkpoint too stale | Require fresh start or newer checkpoint |

### Discrepancy Types

| Discrepancy | Detection | Impact |
|-------------|-----------|--------|
| State version mismatch | version != current | May indicate concurrent changes |
| Commit divergence | SHA not current HEAD | Work happened outside checkpoint |
| Branch missing | Branch deleted | Cannot recover git context |
| Files modified | Hash changed | Code changed since checkpoint |
| Ownership changed | Different owner | May need re-claim |
| Evidence invalidated | Evidence marked stale | Revalidation needed |

### Recovery Examples

**Clean Recovery (AUTO_MERGE):**
```
Recovering from CP-2026-10-12-003...

Validation:
  ✓ Commit matches current HEAD
  ✓ State version matches
  ✓ No file changes detected
  ✓ Ownership valid

Strategy: AUTO_MERGE

✓ Recovery complete
  Task: TASK-003 (IN_PROGRESS)
  TDD Phase: GREEN
  Next Action: Implement minimum code to pass test

Ready to continue. What would you like to do?
```

**Prompted Recovery (PROMPT_USER):**
```
Recovering from CP-2026-10-12-002...

Validation:
  ✓ Commit exists in history
  ⚠ 3 commits since checkpoint
  ⚠ src/auth.ts modified (by checkpoint owner)
  ✓ Ownership still valid

Strategy: PROMPT_USER

Proposed Recovery Plan:
  1. Acknowledge commits abc→def→ghi as valid progress
  2. Update checkpoint reference to current state
  3. Continue from GREEN phase

Changes since checkpoint:
  - Commit def: "Add password hashing"
  - Commit ghi: "Fix import path"

These changes appear to be valid TDD progress.
Continue with recovery? [Y/n]
```

**Rejected Recovery:**
```
Attempting recovery from CP-2026-10-10-001...

Validation:
  ✗ Checkpoint is 2 days old
  ✗ State version: 23 vs current 58
  ✗ Branch was deleted and recreated
  ✗ 15 commits between checkpoint and HEAD

Strategy: REJECT

Cannot safely recover from this checkpoint.
Too many changes have occurred since checkpoint creation.

Options:
1. Use a more recent checkpoint (if available)
2. Start fresh from current state
3. Manually reconcile differences
```

### Manual Checkpoint Creation

**Trigger**: User says "create checkpoint", "save checkpoint"

```
Creating manual checkpoint...

Checkpoint Details:
  ID: CP-2026-10-12-004
  Task: TASK-003
  TDD Phase: GREEN
  State Version: 48
  Branch: task/TASK-003-user-auth
  Commit: ghi789jkl012
  Uncommitted: 2 files

Note (optional): "Before refactoring auth module"

✓ Checkpoint created
  Location: .kiro/sdlc/checkpoints/CP-2026-10-12-004.yaml
  
This checkpoint can be used for recovery if needed.
```

### Checkpoint Pruning

Checkpoints are pruned to prevent accumulation:

- Default: Keep last 10 checkpoints per task
- Configurable via `checkpoint_retention_count`
- Manual checkpoints preserved longer than automatic ones

```
Pruning old checkpoints for TASK-003...

Before: 15 checkpoints
After: 10 checkpoints

Removed:
  - CP-2026-10-08-001 (oldest automatic)
  - CP-2026-10-08-002
  - ...

Kept: 10 most recent (includes 2 manual checkpoints)
```

---

## Evidence Freshness

Evidence is STALE if:

- Implementation files changed after evidence timestamp
- Git shows commits after evidence git_ref

STALE evidence requires re-verification.

## Guardrails

- Do NOT auto-continue after resume
- Repository reality > state file
- Report all discrepancies
- Get user confirmation before proceeding
- For multi-developer projects:
  - Validate team composition before task operations
  - Check handoff state before starting dependent tasks
  - Verify parallel group integrity before progress updates
  - Report developer-specific context for active members
- For checkpoint recovery:
  - NEVER auto-recover without user confirmation for PROMPT_USER strategy
  - ALWAYS preserve uncommitted user work
  - REJECT checkpoints that are too stale (configurable threshold)
  - Record recovery in audit log
- For ownership recovery:
  - Validate fencing tokens are still valid
  - Check AI agent leases haven't expired
  - Report if ownership needs reclaim
  - Warn if task was marked ABANDONED
