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
