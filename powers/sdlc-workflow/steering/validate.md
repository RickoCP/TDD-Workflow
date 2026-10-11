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
