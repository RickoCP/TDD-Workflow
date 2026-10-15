---
inclusion: auto
name: "SDLC Validate"
description: "Validates workflow state consistency and integrity"
---

# SDLC Workflow Validation

## Purpose

Validate workflow state for consistency and integrity, including team configuration when multi-developer support is enabled.

## When This Activates

- User says "validate workflow", "check consistency", "validate team"
- Before milestone completion
- Before release readiness
- During resume
- After team configuration changes

## Validation Checks

### Schema Validation

- .config.yaml matches schema
- project-state.yaml matches schema
- traceability.yaml matches schema
- All evidence files have required frontmatter

### Counter Reconciliation

- requirements.total == sum(requirements.by_status.*)
- tasks.total == sum(tasks.by_status.*)
- blockers.count == len(blockers.ids)

### Reference Integrity

- All REQ refs point to existing files
- All AC refs exist in parent REQ
- All TASK refs point to existing files
- All DESIGN refs point to existing files
- All evidence paths point to existing files

### TDD Integrity

- DONE tasks have tdd.phase in [COMPLETE, NOT_APPLICABLE]
- NOT_APPLICABLE has required justification
- GREEN phase has valid RED evidence
- REFACTOR phase has valid GREEN evidence
- COMPLETE has all evidence files

### State Version Integrity

| Code | Error | Description |
|------|-------|-------------|
| 3001 | STATE_VERSION_MISSING | state_version field not present |
| 3002 | STATE_VERSION_INVALID | state_version is not a positive integer |
| 3003 | STATE_VERSION_REGRESSION | state_version decreased (should never happen) |
| 3004 | LAST_MODIFIED_INVALID | last_modified_at is not valid ISO 8601 |
| 3005 | MODIFIER_MISSING | last_modified_by is missing after a change |

**Validation Rules:**
- `state_version` MUST be present and >= 1
- `state_version` MUST only increase, never decrease
- `last_modified_at` MUST be valid ISO 8601 timestamp
- `last_modified_by` MUST be present when state changes

### Ownership Validation

| Code | Error | Description |
|------|-------|-------------|
| 3010 | FENCING_TOKEN_INVALID | Token is not valid UUID v4 format |
| 3011 | OWNERSHIP_ACTOR_INVALID | actor_type is not HUMAN or AI_AGENT |
| 3012 | LEASE_MISSING_FOR_AI | AI_AGENT ownership missing lease fields |
| 3013 | LEASE_EXPIRED | lease_expires_at is in the past |
| 3014 | HEARTBEAT_OVERDUE | last_heartbeat_at is overdue for AI_AGENT |
| 3015 | OWNERSHIP_ORPHANED | Task has ownership but no assignee |
| 3016 | TOKEN_OWNER_MISMATCH | Fencing token owner doesn't match assignee |

**Validation Rules:**
- Fencing token MUST be valid UUID v4 format if present
- AI_AGENT ownership MUST have lease_expires_at and heartbeat_interval_seconds
- AI_AGENT lease SHOULD NOT be expired
- If task has ownership, it MUST have an assignee
- Fencing token owner MUST match task assignee

### Evidence Validation

| Code | Error | Description |
|------|-------|-------------|
| 3020 | EVIDENCE_FILE_MISSING | Evidence file referenced but not found |
| 3021 | EVIDENCE_COMMIT_MISMATCH | Evidence commit_sha doesn't match current HEAD |
| 3022 | EVIDENCE_STALE | Evidence marked as stale, requires revalidation |
| 3023 | EVIDENCE_FIELDS_MISSING | Required evidence fields not present |
| 3024 | EVIDENCE_FILES_CHANGED | Files tracked by evidence have been modified |
| 3025 | EVIDENCE_TASK_MISMATCH | Evidence task_id doesn't match its directory |

**Validation Rules:**
- All evidence files referenced in state MUST exist
- Evidence with different commit_sha than HEAD SHOULD be flagged stale
- Evidence MUST have: evidence_id, task_id, timestamp, result, executor_id
- Files tracked by evidence (related_files) SHOULD NOT have changed since verification

**Staleness Detection:**
```yaml
# Evidence staleness check result example
staleness_check:
  stale: true
  stale_reason: "commit_changed"
  evidence_commit: "abc123"
  current_commit: "def456"
  files_changed:
    - path: "src/auth.ts"
      evidence_hash: "sha256:abc..."
      current_hash: "sha256:def..."
```

### Checkpoint Validation

| Code | Error | Description |
|------|-------|-------------|
| 3030 | CHECKPOINT_FILE_MISSING | Checkpoint file referenced but not found |
| 3031 | CHECKPOINT_INVALID_FORMAT | Checkpoint file format invalid |
| 3032 | CHECKPOINT_COMMIT_UNREACHABLE | Checkpoint commit_sha not reachable in git |
| 3033 | CHECKPOINT_BRANCH_MISSING | Checkpoint branch no longer exists |
| 3034 | CHECKPOINT_STATE_STALE | Checkpoint state_version older than current |

**Validation Rules:**
- Checkpoint files in .kiro/sdlc/checkpoints/ MUST be valid YAML
- Checkpoint commit_sha SHOULD be reachable in git history
- Checkpoint branch_name SHOULD exist (or be recoverable)

### Finding Validation

| Code | Error | Description |
|------|-------|-------------|
| 3040 | FINDING_STATUS_INVALID | status is not valid (OPEN/IN_PROGRESS/RESOLVED/WONT_FIX/DUPLICATE) |
| 3041 | FINDING_SEVERITY_INVALID | severity is not valid (CRITICAL/HIGH/MEDIUM/LOW/INFO) |
| 3042 | FINDING_TASK_NOT_FOUND | finding references non-existent task |
| 3043 | FINDING_UNRESOLVED_BLOCKING | CRITICAL/HIGH finding blocking release |
| 3044 | FINDING_DUPLICATE_ID | Duplicate finding ID detected |

**Validation Rules:**
- Finding status MUST be one of: OPEN, IN_PROGRESS, RESOLVED, WONT_FIX, DUPLICATE
- Finding severity MUST be one of: CRITICAL, HIGH, MEDIUM, LOW, INFO
- Finding task_id MUST reference an existing task
- Release cannot proceed with OPEN CRITICAL or HIGH findings

### Release Validation

| Code | Error | Description |
|------|-------|-------------|
| 3050 | RELEASE_STATE_INVALID | release status is not valid |
| 3051 | RELEASE_TASKS_INCOMPLETE | Release planned but tasks not all DONE |
| 3052 | RELEASE_EVIDENCE_STALE | Release has stale evidence |
| 3053 | RELEASE_FINDINGS_BLOCKING | Release has unresolved blocking findings |
| 3054 | RELEASE_APPROVAL_MISSING | Production stage without human approval |

**Validation Rules:**
- Release status MUST follow valid state machine transitions
- All committed tasks MUST be DONE before READINESS_CHECK
- All evidence MUST be fresh (not stale) for release
- No CRITICAL or HIGH findings may be OPEN for release
- Production deployment REQUIRES explicit human approval

### Traceability Completeness

- FROZEN requirements have all AC mapped
- All AC have task_refs or rationale
- DONE tasks have test_refs or rationale

### Approval Records

- Human-gated transitions have approval records
- Approval records have required fields

## Team Configuration Validation

When multi-developer support is enabled (team.members exists), perform additional validation using the team-validator.ts script (`scripts/team-validator.ts`).

### Team Member Validation

| Code | Error | Description |
|------|-------|-------------|
| 2001 | DUPLICATE_MEMBER_ID | Two or more team members have the same ID |
| 2002 | EMPTY_MEMBER_NAME | Team member has an empty or missing name |
| 2003 | INVALID_ROLE | Team member has a role not in valid_roles list |
| 2004 | NO_ROLES_ASSIGNED | Team member has no roles assigned |
| 2005 | INVALID_MEMBER_STATUS | Team member status is not ACTIVE or INACTIVE |
| 2006 | INVALID_REGISTERED_AT | Invalid ISO 8601 timestamp for registered_at |
| 2007 | MISSING_MEMBER_ID | Team member is missing an ID |

**Validation Rules:**
- Each team member MUST have a unique ID (Requirement 1.5)
- Each team member MUST have a non-empty name
- Each team member MUST have at least one role assigned
- All roles MUST be one of: frontend, backend, qa, devops, fullstack, lead (Requirement 1.2, 1.3)
- Member status MUST be ACTIVE or INACTIVE

### Assignment Validation

| Code | Error | Description |
|------|-------|-------------|
| 2020 | ASSIGNEE_NOT_FOUND | Task assigned to non-existent developer |
| 2021 | INVALID_ROLE_REQUIRED | Task has invalid role_required value |
| 2022 | ASSIGNEE_MISSING_REQUIRED_ROLE | Assignee lacks the required role for the task |

**Validation Rules:**
- Task assignee MUST reference an existing team member ID (Requirement 4.1)
- Task role_required MUST be a valid role (Requirement 4.2)
- If task has both assignee and role_required, assignee MUST have that role (Requirement 3.3, 3.4)

### Dependency Validation

| Code | Error | Description |
|------|-------|-------------|
| 2040 | CIRCULAR_DEPENDENCY | Dependency graph contains a cycle |
| 2041 | DEPENDENCY_TASK_NOT_FOUND | Task depends on non-existent task |
| 2042 | SELF_DEPENDENCY | Task depends on itself |
| 2043 | INVALID_DEPENDENCY_TYPE | Dependency type is not blocking or non_blocking |

**Validation Rules:**
- Dependencies MUST NOT form cycles (Requirement 7.5)
- Tasks MUST NOT have self-dependencies
- Dependency type MUST be "blocking" or "non_blocking"
- All dependency task references MUST exist

### Parallel Group Validation

| Code | Error | Description |
|------|-------|-------------|
| 2060 | INTERNAL_BLOCKING_DEPENDENCY | Tasks in group have blocking dependencies on each other |
| 2061 | PARALLEL_GROUP_EMPTY | Parallel group has no tasks |
| 2062 | DUPLICATE_GROUP_ID | Two parallel groups have the same ID |
| 2063 | TASK_NOT_FOUND_IN_GROUP | Parallel group references non-existent task |

**Validation Rules:**
- Parallel groups MUST NOT contain tasks with internal blocking dependencies (Requirement 5.2, 5.3)
- Each parallel group MUST have a unique ID
- Parallel groups MUST contain at least one task
- All task references in parallel groups MUST exist

### Handoff Checklist Validation

| Code | Error | Description |
|------|-------|-------------|
| 2080 | EMPTY_HANDOFF_CHECKLIST | Handoff point has no checklist items |
| 2081 | INVALID_SOURCE_ROLE | Handoff source_role is not a valid role |
| 2082 | INVALID_TARGET_ROLE | Handoff target_role is not a valid role |
| 2083 | DUPLICATE_HANDOFF_POINT_ID | Two handoff points have the same ID |
| 2084 | DUPLICATE_CHECKLIST_ITEM_ID | Checklist has duplicate item IDs |

**Validation Rules:**
- Each handoff point MUST have at least one checklist item (Requirement 11.2)
- Handoff source_role MUST be a valid role
- Handoff target_role MUST be a valid role
- Each handoff point MUST have a unique ID
- Checklist item IDs MUST be unique within each handoff point

### Statistics Validation

| Code | Warning | Description |
|------|---------|-------------|
| 2100 | STATISTICS_MISMATCH | team.statistics.total_members doesn't match actual count |
| 2101 | ROLE_COUNT_MISMATCH | team.statistics.by_role counts don't match actual counts |

**Validation Rules:**
- Team statistics SHOULD match calculated values from members
- Role counts SHOULD match the number of active members with each role

## Validation Output

```yaml
validation:
  last_validated_at: ISO8601
  validation_result: VALID | WARNINGS | ERRORS
  issues:
    - type: ERROR | WARNING
      code: COUNTER_MISMATCH | MISSING_REF | DUPLICATE_MEMBER_ID | etc
      message: description
      location: file/field path
      suggestion: recommended fix (optional)
```

### Team Validation Output Example

```yaml
validation:
  last_validated_at: "2024-01-15T15:00:00Z"
  validation_result: ERRORS
  issues:
    - type: ERROR
      code: 2001
      message: 'Duplicate team member ID "dev-001" found at indices 0 and 2'
      location: team.members[2].id
      suggestion: Each team member must have a unique ID
    - type: ERROR
      code: 2022
      message: 'Task "TASK-005" requires role "backend" but assignee "dev-003" has roles: frontend, qa'
      location: tasks.TASK-005.assignee
      suggestion: Assign to a developer with the "backend" role
    - type: ERROR
      code: 2040
      message: 'Circular dependency detected: TASK-001 -> TASK-002 -> TASK-003 -> TASK-001'
      location: tasks.dependencies
      suggestion: Remove one of the dependencies to break the cycle
```

## Running Team Validation

Team validation can be invoked programmatically using the team-validator module:

```typescript
import { validateTeamConfiguration, ValidationOptions } from './scripts/team-validator';

const options: ValidationOptions = {
  includeWarnings: true,
  validateDependencies: true,
  validateParallelGroups: true,
  validateHandoffs: true,
  validateAssignments: true,
  validateStatistics: true,
};

const result = validateTeamConfiguration(projectState, options);

if (!result.valid) {
  console.log(`Found ${result.errorCount} errors, ${result.warningCount} warnings`);
  for (const issue of result.issues) {
    console.log(`[${issue.code}] ${issue.message}`);
  }
}
```

## Guardrails

- Validation must be evidence-based
- Do NOT auto-fix issues that could lose data
- Report all issues to user
- ERRORS block milestone/release progression
- Team validation ERRORS block task assignments and parallel group creation
- Statistics warnings do NOT block progression but should be reported
- State version conflicts MUST be reported and may require manual resolution
- Ownership validation ERRORS block task operations
- Evidence staleness WARNINGS should trigger revalidation prompts
- Finding validation ERRORS with CRITICAL/HIGH severity block release
- Checkpoint validation enables recovery but stale checkpoints need user confirmation
