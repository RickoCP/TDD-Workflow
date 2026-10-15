---
inclusion: auto
name: "SDLC Change Management"
description: "Handles changes to frozen requirements and approved scope"
---

# SDLC Change Management

## Purpose

Manage changes to frozen requirements, approved designs, or implementation scope.

## When This Activates

- User requests change to frozen requirement
- Scope change needed during implementation
- Bug discovered requiring requirement change
- User says "change request", "cr", "modify requirement"

## Change Request Process

### 1. Create Change Request

Create changes/CR-xxx/request.md with:

- Reason for change
- Requested modification
- Affected requirements
- Affected designs
- Affected tasks
- Affected tests

### 2. Impact Analysis

Create changes/CR-xxx/impact-analysis.md with:

- Migration impact
- Backward compatibility assessment
- Risk assessment
- Recommendation

### 3. Approval

Change requests require human approval.

Record decision in CR document.

### 4. Implementation

After approval:

1. Update affected requirements (status back to APPROVED if needed)
2. Update affected designs
3. Update or create tasks
4. Update traceability
5. Execute through normal TDD cycle

## Scope Change During Implementation

If implementation reveals need for:

- New requirement
- Changed AC
- Major design change
- Scope expansion

**Do NOT silently continue.**

Create CR and get approval before proceeding.

## Small Implementation Details

Tasks may be added for implementation details that:

- Do not alter approved scope
- Do not change requirements
- Are not destructive
- Are not security-sensitive

Document the addition but approval not required.

## Guardrails

- FROZEN requirements cannot be directly edited
- Scope changes require CR
- CRs require human approval
- All changes must maintain traceability
