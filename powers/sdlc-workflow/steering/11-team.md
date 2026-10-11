---
inclusion: auto
name: "SDLC Team Management"
description: "Manages team member registration, listing, role updates, and removal for multi-developer workflows"
---

# SDLC Team Management

## Purpose

The TEAM phase provides team management operations for multi-developer workflows. It enables project leads to register developers, assign roles, view team composition, and manage team member lifecycle.

## When This Activates

- User says "add team member", "register developer", "team list", "update roles"
- User wants to manage team composition
- User asks about team members or developer roles
- During multi-developer project setup

## Prerequisites

- SDLC workflow initialized (`.kiro/sdlc/project-state.yaml` exists)
- Any lifecycle phase (team management is available throughout the workflow)

## Valid Roles

The Team_Manager supports the following roles:

| Role | Description |
|------|-------------|
| `frontend` | UI/UX development |
| `backend` | Server-side development |
| `qa` | Quality assurance and testing |
| `devops` | Infrastructure and deployment |
| `fullstack` | Both frontend and backend |
| `lead` | Technical leadership |

A developer can have multiple roles assigned.

## Team Operations

### 1. Registering a New Team Member

**Trigger**: User says "add developer", "register team member", "add to team"

**Required Information**:
- **id**: Unique identifier (e.g., "dev-001", "alice")
- **name**: Display name (e.g., "Alice Developer")
- **roles**: At least one valid role (e.g., ["backend", "devops"])

**Steps**:

1. Collect required information from user
2. Validate:
   - ID is non-empty string
   - ID is not already registered (Error 1002: DUPLICATE_MEMBER_ID)
   - All roles are valid (Error 1003: INVALID_ROLE)
   - At least one role provided (Error 1005: NO_ROLES_SPECIFIED)
3. Call `Team_Manager.registerMember()` with:
   ```typescript
   {
     id: "dev-001",
     name: "Alice Developer",
     roles: ["backend", "devops"],
     registered_at: new Date().toISOString(),
     status: "ACTIVE"
   }
   ```
4. Update `project-state.yaml` team section
5. Update team statistics
6. Confirm registration to user

**Example**:
```
User: Add a new backend developer named Alice with ID dev-001

Response: 
✓ Registered team member:
  - ID: dev-001
  - Name: Alice Developer
  - Roles: backend
  - Status: ACTIVE
  
Team now has 3 members (1 backend, 1 frontend, 1 qa).
```

### 2. Listing Team Members

**Trigger**: User says "show team", "list developers", "who is on the team"

**Options**:
- List all members
- Filter by role
- Filter by status (ACTIVE/INACTIVE)

**Steps**:

1. Determine if filtering is requested
2. Call `Team_Manager.listMembers(filter?)`:
   - No filter: returns all members
   - Role filter: `{ role: "backend" }`
   - Status filter: `{ status: "ACTIVE" }`
   - Combined: `{ role: "backend", status: "ACTIVE" }`
3. Display formatted list

**Output Format**:

```
Team Members (3 total):

| ID      | Name            | Roles            | Status   |
|---------|-----------------|------------------|----------|
| dev-001 | Alice Developer | backend, devops  | ACTIVE   |
| dev-002 | Bob Frontend    | frontend         | ACTIVE   |
| dev-003 | Charlie QA      | qa               | INACTIVE |

By Role:
- Backend: 1 member
- Frontend: 1 member
- QA: 1 member (0 active)
- DevOps: 1 member
```

**Empty Team Message**:
```
No team members registered yet.

To add a team member, provide:
- ID (unique identifier)
- Name (display name)
- Role(s): frontend, backend, qa, devops, fullstack, or lead
```

### 3. Getting a Specific Team Member

**Trigger**: User asks about specific developer, "who is dev-001", "show Alice's info"

**Steps**:

1. Extract developer ID from request
2. Call `Team_Manager.getMember(developerId)`
3. Handle errors:
   - Error 1001: TEAM_MEMBER_NOT_FOUND if ID doesn't exist
4. Display member details

**Output Format**:

```
Team Member: dev-001

Name: Alice Developer
Roles: backend, devops
Status: ACTIVE
Registered: 2024-01-15T10:00:00Z
```

### 4. Updating Member Roles

**Trigger**: User says "update roles", "change developer role", "add role to developer"

**Required Information**:
- Developer ID to update
- New role list (replaces existing roles)

**Steps**:

1. Verify developer exists (Error 1001 if not)
2. Validate new roles:
   - At least one role required (Error 1005)
   - All roles must be valid (Error 1003)
3. Call `Team_Manager.updateMemberRoles(developerId, newRoles)`
4. Update statistics
5. Confirm update

**Example**:
```
User: Add the lead role to dev-001

Current roles: backend, devops
New roles: backend, devops, lead

✓ Updated dev-001 roles to: backend, devops, lead
```

### 5. Updating Member Status

**Trigger**: User says "deactivate developer", "set member inactive", "reactivate developer"

**Steps**:

1. Verify developer exists
2. Update status to ACTIVE or INACTIVE
3. Update statistics (inactive members don't count in role stats)
4. Confirm update

**Note**: Inactive members remain in the team but are excluded from:
- Role-based statistics
- Task assignment suggestions
- Workload calculations

### 6. Removing a Team Member

**Trigger**: User says "remove developer", "delete team member", "remove from team"

**Required Information**:
- Developer ID to remove

**Pre-conditions**:
- Developer must exist (Error 1001)
- Developer must have no active tasks (Error 1004)

**Steps**:

1. Verify developer exists
2. Check for active tasks assigned to developer
3. If active tasks exist:
   ```
   Cannot remove dev-001: 3 active task(s) assigned.
   
   Reassign or complete the following tasks first:
   - TASK-005 (IN_PROGRESS)
   - TASK-007 (READY)
   - TASK-012 (TODO)
   
   Suggested action: Use task reassignment to transfer tasks.
   ```
4. If no active tasks, call `Team_Manager.removeMember(developerId)`
5. Update statistics
6. Confirm removal

**Example**:
```
User: Remove dev-003 from the team

✓ Removed team member dev-003 (Charlie QA)
Team now has 2 members.
```

### 7. Getting Members by Role

**Trigger**: User says "who can do backend work", "list frontend developers"

**Steps**:

1. Extract role from request
2. Validate role is valid
3. Call `Team_Manager.getMembersByRole(role)`
4. Display filtered list

**Example**:
```
User: Who can work on backend tasks?

Backend Developers (2):
- dev-001: Alice Developer (backend, devops) - ACTIVE
- dev-004: David Full (fullstack) - ACTIVE

Note: fullstack developers can also work on backend tasks.
```

## Error Codes Reference

| Code | Name | Description | Suggested Action |
|------|------|-------------|------------------|
| 1001 | TEAM_MEMBER_NOT_FOUND | Developer ID not registered | Verify the ID or register the member first |
| 1002 | DUPLICATE_MEMBER_ID | ID already exists | Use a unique ID or update existing member |
| 1003 | INVALID_ROLE | Role not recognized | Use: frontend, backend, qa, devops, fullstack, lead |
| 1004 | MEMBER_HAS_ACTIVE_TASKS | Cannot remove with tasks | Reassign or complete tasks first |
| 1005 | NO_ROLES_SPECIFIED | At least one role required | Assign at least one valid role |
| 1006 | INVALID_MEMBER_DATA | Invalid member data | Provide valid ID and name (non-empty strings) |

## Project State Integration

Team data is stored in `project-state.yaml`:

```yaml
team:
  members:
    - id: "dev-001"
      name: "Alice Developer"
      roles:
        - backend
        - devops
      registered_at: "2024-01-15T10:00:00Z"
      status: ACTIVE
  statistics:
    total_members: 2
    by_role:
      frontend: 1
      backend: 1
      qa: 0
      devops: 1
      fullstack: 0
      lead: 0
```

## Best Practices

### Team Setup Recommendations

1. **Define roles early**: Register all team members during PLANNING phase
2. **Use meaningful IDs**: Choose IDs that are easy to remember (e.g., "alice", "bob-qa")
3. **Assign appropriate roles**: Match roles to actual expertise
4. **Consider multi-role developers**: Fullstack developers can work across frontend/backend
5. **Keep team updated**: Mark members as INACTIVE when unavailable

### Role Assignment Guidelines

| Project Type | Recommended Roles |
|--------------|-------------------|
| Full-stack web app | frontend, backend, devops, qa |
| API-only service | backend, devops, qa |
| Frontend SPA | frontend, qa, devops |
| DevOps/Infrastructure | devops, lead |
| Small team | fullstack, qa |

### Multi-Role Considerations

- **fullstack** developers can be assigned to frontend or backend tasks
- **lead** role is often combined with another technical role
- Developers with multiple roles increase flexibility but may become bottlenecks

## Integration with Other Components

### Task Assignment Integration

The Task_Assigner uses team data for:
- Validating assignee exists
- Verifying role requirements match
- Suggesting available developers

### Workload Analysis Integration

The Workload_Analyzer uses team data for:
- Calculating per-developer task counts
- Identifying bottlenecks
- Balancing work distribution

### Handoff Coordination Integration

The Handoff_Coordinator uses team data for:
- Validating source/target roles
- Identifying available recipients
- Tracking handoff participants

## Guardrails

- Team members MUST have at least one valid role
- Developer IDs MUST be unique within the project
- Cannot remove members with active tasks
- Statistics automatically update on any team change
- Inactive members excluded from role statistics

## Troubleshooting

### "Developer not found" when assigning tasks
- Verify the developer ID is correct
- Check if the developer is registered: `list team members`
- Register the developer if missing

### "Role mismatch" during task assignment
- Check task's `role_required` field
- Verify developer has the required role
- Update developer roles if needed

### Cannot remove a team member
- Check for assigned tasks using workload view
- Reassign tasks to other developers
- Complete or cancel active tasks
- Then retry removal

### Statistics seem incorrect
- Team statistics only count ACTIVE members
- Inactive members are excluded from by_role counts
- Force recalculation by updating any member
