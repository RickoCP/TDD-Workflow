---
inclusion: auto
name: "SDLC Planning"
description: "Generates implementation tasks from requirements and design with dependency ordering and multi-developer support"
---

# SDLC Planning Phase

## Purpose

The PLANNING phase generates implementation tasks from approved requirements and design, establishing the work breakdown with proper dependencies. For multi-developer projects, this phase also handles task assignment, role requirements, dependency types, and parallel group creation.

## When This Activates

- After DESIGN_REVIEW approval
- User says "plan", "task", "create tasks", "implementation plan"
- User says "assign tasks", "parallel group", "set dependencies"
- Current phase is PLANNING

## Prerequisites

- Requirements approved
- Design approved (or NOT_APPLICABLE with rationale)
- lifecycle.phase == PLANNING
- For multi-developer features: Team members registered (see 11-team.md)

## Task Structure

Each task (TASK-xxx.md) must contain:

1. **Metadata**: ID, Status, Risk, Created
2. **Requirement Reference**: Which REQ this implements
3. **AC References**: Which acceptance criteria
4. **Design Reference**: Related design doc
5. **Dependencies**: Other tasks that must complete first (with dependency type)
6. **Expected Files**: Files to be created/modified
7. **Test Requirements**: What tests are needed
8. **TDD Status**: RED/GREEN/REFACTOR/VERIFY tracking
9. **Definition of Done**: Checklist

### Multi-Developer Task Fields

For team projects, tasks include additional fields:

10. **Assignee**: Developer ID responsible for the task
11. **Role Required**: Role needed to work on this task
12. **Parallel Group**: Group ID for concurrent execution
13. **Assignment History**: Audit trail of assignment changes

## Task Guidelines

Tasks must be:

- **Small**: Completable in reasonable time
- **Deterministic**: Clear success criteria
- **Verifiable**: Can prove completion
- **Traceable**: Links to requirements and AC
- **Role-appropriate**: Match team member expertise (multi-developer)

Avoid generic tasks like:
- "Implement backend" (too vague)
- "Add tests" (not specific)
- "Fix frontend" (unclear scope)

## Risk Levels

| Risk | Verification Scope |
|------|-------------------|
| LOW | Unit tests |
| MEDIUM | Unit + Integration |
| HIGH | Unit + Integration + Regression |
| CRITICAL | Full suite + Security + Performance |

## Task Dependencies

Order tasks by:

1. Foundation before features
2. Data model before business logic
3. Core before edge cases
4. Tests written before implementation (TDD)

### Dependency Types

The Dependency_Resolver supports two dependency types:

| Type | Behavior | Use Case |
|------|----------|----------|
| `blocking` | Dependent task cannot start (IN_PROGRESS) until dependency is DONE | Sequential work, API before UI |
| `non_blocking` | Dependent task can start but cannot complete (DONE) until dependency is DONE | Parallel work with eventual sync |

### Specifying Dependencies

When creating tasks with dependencies:

```yaml
depends_on:
  - task_id: "TASK-001"
    type: "blocking"
    reason: "API must be complete before UI integration"
  - task_id: "TASK-002"
    type: "non_blocking"
    reason: "Documentation can proceed in parallel"
```

**Validation Rules**:
- Self-dependencies are rejected (Error 1204)
- Circular dependencies are detected and rejected (Error 1201)
- Referenced tasks must exist (Error 1202)
- Type must be `blocking` or `non_blocking` (Error 1203)

### Cross-Role Dependencies

For multi-developer projects, visualize dependencies between roles:

```
User: Show dependency graph

Response:
[Mermaid diagram showing tasks grouped by role with dependency arrows]
Critical path: TASK-001 → TASK-005 → TASK-008
Cross-role dependencies:
- backend:TASK-001 → frontend:TASK-005 (blocking)
```

## Multi-Developer Task Assignment

### Role-Based Assignment

Assign tasks to developers based on their roles using the Task_Assigner component.

**Trigger**: User says "assign task", "set assignee", "who should work on"

**Required Information**:
- Task ID to assign
- Developer ID (must be registered via Team_Manager)
- Role requirement (optional, auto-validates if set)

**Steps**:

1. Verify task exists and is in assignable state (TODO, READY, BLOCKED)
2. Verify developer exists via Team_Manager
3. If `role_required` is set, verify developer has the required role
4. Record assignment with timestamp
5. Update task metadata

**Example**:
```
User: Assign TASK-005 to dev-001

Validating:
- Task TASK-005 exists: ✓ (Status: TODO)
- Developer dev-001 exists: ✓ (Roles: backend, devops)
- Role requirement: backend ✓

✓ Assigned TASK-005 to dev-001
  - Assigned at: 2024-01-15T10:00:00Z
  - Role match: backend
```

### Setting Role Requirements

Mark tasks as requiring specific roles:

```yaml
assignment:
  assignee: null
  role_required: "backend"
  assigned_at: null
  assigned_by: null
```

Tasks with `role_required` but no `assignee` are **available for pickup** by any developer with the matching role.

**Example**:
```
User: Mark TASK-010 as requiring frontend role

✓ Updated TASK-010
  - Role required: frontend
  - Status: AVAILABLE_FOR_PICKUP
  - Eligible developers: dev-002 (frontend), dev-004 (fullstack)
```

### Task Pickup

Developers can pick up unassigned tasks:

```
User: Let dev-002 pick up TASK-010

Validating:
- Task TASK-010 is unassigned: ✓
- Developer dev-002 has frontend role: ✓

✓ dev-002 picked up TASK-010
  - Assignment recorded at: 2024-01-15T11:00:00Z
```

### Assignment Validation Errors

| Code | Error | Resolution |
|------|-------|------------|
| 1101 | Developer not found | Register developer first |
| 1102 | Role mismatch | Assign to developer with correct role |
| 1103 | Task already assigned | Unassign first or reassign |
| 1104 | Task not assignable | Task must be in TODO, READY, or BLOCKED |
| 1105 | Invalid role_required | Use valid role: frontend, backend, qa, devops, fullstack, lead |

## Parallel Task Groups

### Creating Parallel Groups

Group tasks for concurrent execution using the Parallel_Group_Manager component.

**Trigger**: User says "create parallel group", "group tasks for parallel work"

**Required Information**:
- Group ID (unique identifier)
- Group name (human-readable)
- Task IDs to include
- Milestone association (optional)

**Validation Rules**:
- Tasks in a parallel group must NOT have internal blocking dependencies
- Each task can only belong to one parallel group
- All referenced tasks must exist

**Steps**:

1. Validate group definition (name, ID)
2. Verify all tasks exist
3. Check no task is already in another group
4. Validate no internal blocking dependencies
5. Create group with initial progress calculation
6. Register in project-state.yaml

**Example**:
```
User: Create a parallel group "PG-001" named "Sprint 1 API Tasks" with TASK-001, TASK-002, TASK-003

Validating:
- Group ID PG-001 is unique: ✓
- Tasks exist: TASK-001 ✓, TASK-002 ✓, TASK-003 ✓
- No task in another group: ✓
- Internal dependencies check:
  - No blocking deps between tasks: ✓

✓ Created parallel group PG-001
  - Name: Sprint 1 API Tasks
  - Tasks: 3
  - Status: PENDING
  - Progress: 0%
```

### Internal Dependency Validation

**CRITICAL**: Parallel groups cannot contain tasks with blocking dependencies on each other.

**Rejected Example**:
```
User: Create parallel group with TASK-001, TASK-002 
      (where TASK-002 has blocking dependency on TASK-001)

✗ Cannot create parallel group
  Error 1501: Internal blocking dependency conflict
  
  Conflict: TASK-002 → TASK-001 (blocking)
  
  Options:
  1. Remove TASK-002 from the group
  2. Change dependency type to non_blocking
  3. Create separate groups
```

### Parallel Group Progress

Track completion of parallel groups:

```yaml
parallel_groups:
  - id: "PG-001"
    name: "Sprint 1 API Tasks"
    milestone: "M1"
    tasks: ["TASK-001", "TASK-002", "TASK-003"]
    status: IN_PROGRESS
    progress:
      total: 3
      completed: 1
      percentage: 33
```

**Group Status Transitions**:
- `PENDING` → `IN_PROGRESS`: When first task starts
- `IN_PROGRESS` → `COMPLETE`: When all tasks reach DONE

### Viewing Parallel Groups

```
User: Show parallel group progress

Parallel Groups:

| ID     | Name               | Tasks | Completed | Progress | Status      |
|--------|--------------------|-------|-----------|----------|-------------|
| PG-001 | Sprint 1 API Tasks | 3     | 1         | 33%      | IN_PROGRESS |
| PG-002 | UI Components      | 4     | 0         | 0%       | PENDING     |

PG-001 Details:
- TASK-001 (backend) - DONE - dev-001
- TASK-002 (backend) - IN_PROGRESS - dev-001
- TASK-003 (backend) - TODO - unassigned
```

## Planning Workflow for Multi-Developer Projects

### Step 1: Register Team (if not done)

```
User: Add team members
[See 11-team.md for team management]
```

### Step 2: Create Tasks with Role Requirements

```
User: Create tasks for the authentication feature

Creating tasks from design:

1. TASK-001: Create user model
   - Role required: backend
   - Risk: LOW
   - Dependencies: none

2. TASK-002: Implement auth API endpoints
   - Role required: backend
   - Risk: MEDIUM
   - Dependencies: TASK-001 (blocking)

3. TASK-003: Create login UI component
   - Role required: frontend
   - Risk: LOW
   - Dependencies: TASK-002 (blocking)

4. TASK-004: Write API documentation
   - Role required: backend
   - Risk: LOW
   - Dependencies: TASK-002 (non_blocking)
```

### Step 3: Define Parallel Groups

```
User: Group backend tasks for parallel execution

Analyzing tasks...

Recommended parallel groups:
1. PG-BACKEND: TASK-001, TASK-004
   - No blocking dependencies between them ✓
   
Cannot group TASK-002 with TASK-001 (blocking dependency)

Create PG-BACKEND? (y/n)
```

### Step 4: Assign Tasks

```
User: Assign backend tasks to Alice (dev-001)

Assigning:
- TASK-001 → dev-001 ✓
- TASK-002 → dev-001 ✓
- TASK-004 → dev-001 ✓

Workload for dev-001:
- TODO: 2 tasks
- READY: 1 task
- Total estimated: 3 tasks
```

### Step 5: Visualize Dependencies

```
User: Show dependency graph

Generating Mermaid diagram...

graph TD
    subgraph backend[Backend]
        TASK-001[Create user model]
        TASK-002[Implement auth API]
        TASK-004[API documentation]
    end
    subgraph frontend[Frontend]
        TASK-003[Login UI component]
    end
    
    TASK-001 -->|blocking| TASK-002
    TASK-002 -->|blocking| TASK-003
    TASK-002 -.->|non_blocking| TASK-004

Critical Path: TASK-001 → TASK-002 → TASK-003
```

## Integration with Components

### Task_Assigner

Handles all assignment operations:
- `assignTask(taskId, developerId)` - Assign a task
- `unassignTask(taskId)` - Remove assignment
- `pickupTask(taskId, developerId)` - Self-assign with role validation
- `validateAssignment(taskId, developerId)` - Check if assignment is valid
- `getAssignmentHistory(taskId)` - View assignment changes

### Dependency_Resolver

Manages task dependencies:
- `addDependency(taskId, dependsOn, type)` - Add dependency with type
- `removeDependency(taskId, dependsOn)` - Remove dependency
- `detectCycles(taskId, dependsOn)` - Check for circular dependencies
- `canTransitionToInProgress(taskId)` - Check blocking deps satisfied
- `canTransitionToDone(taskId)` - Check non-blocking deps satisfied
- `generateDependencyGraph()` - Create Mermaid visualization
- `getCriticalPath()` - Identify blocking chain

### Parallel_Group_Manager

Manages parallel task groups:
- `createGroup(definition)` - Create with validation
- `addToGroup(groupId, taskId)` - Add task to existing group
- `removeFromGroup(groupId, taskId)` - Remove task from group
- `getGroupProgress(groupId)` - Get completion metrics
- `validateGroupTasks(taskIds)` - Check for internal blocking deps
- `notifyTaskCompletion(taskId)` - Update group on task done

## Plan Review Gate (HUMAN)

Plan approval establishes the implementation baseline.

After approval, scope changes require Change Request.

**Multi-Developer Considerations**:
- Verify role assignments match team expertise
- Confirm parallel groups are correctly partitioned
- Review cross-role dependencies for handoff clarity
- Check workload distribution across team

## Guardrails

- NO code changes during PLANNING
- Every task must reference at least one AC
- Tasks must be ordered by dependencies
- Risk level required for each task

### Multi-Developer Guardrails

- Task assignment requires registered team members
- Role requirements must use valid roles
- Parallel groups cannot have internal blocking dependencies
- Circular dependencies are automatically rejected
- Assignment history is preserved for audit
