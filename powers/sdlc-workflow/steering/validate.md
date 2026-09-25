---
inclusion: auto
name: "SDLC Validate"
description: "Validates workflow state consistency and integrity"
---

# SDLC Workflow Validation

## Purpose

Validate workflow state for consistency and integrity.

## When This Activates

- User says "validate workflow", "check consistency"
- Before milestone completion
- Before release readiness
- During resume

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

## Validation Output

```yaml
validation:
  last_validated_at: ISO8601
  validation_result: VALID | WARNINGS | ERRORS
  issues:
    - type: ERROR | WARNING
      code: COUNTER_MISMATCH | MISSING_REF | etc
      message: description
      location: file/field path
```

## Guardrails

- Validation must be evidence-based
- Do NOT auto-fix issues that could lose data
- Report all issues to user
- ERRORS block milestone/release progression
