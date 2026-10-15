---
inclusion: auto
name: "SDLC Verification"
description: "Integration, QA, security, and performance verification after implementation"
---

# SDLC Verification Phases

## Purpose

After all implementation tasks complete, run comprehensive verification before release.

## Phases

INTEGRATION -> QA -> SECURITY -> PERFORMANCE -> RELEASE_READINESS

## INTEGRATION Phase

### Purpose
Verify components work together correctly.

### Actions
1. Run full integration test suite
2. Verify API contracts
3. Test data flows across components
4. Check error handling at boundaries

### Pass Criteria
- All integration tests pass
- No breaking changes to contracts
- Error handling works correctly

### On Failure
Return to IMPLEMENTATION with specific failure context.

## QA Phase

### Purpose
Quality assurance verification.

### Actions
1. Run full regression suite
2. Verify acceptance criteria coverage
3. Check edge cases
4. Review test coverage

### Pass Criteria
- All regression tests pass
- AC coverage complete
- No critical gaps

## SECURITY Phase

### Purpose
Security validation (if applicable).

### Actions
1. Run security scans
2. Check authentication/authorization
3. Verify data protection
4. Review security-sensitive code

### NOT_APPLICABLE
Mark with rationale if no security-sensitive changes.

## PERFORMANCE Phase

### Purpose
Performance validation (if applicable).

### Actions
1. Run performance tests
2. Check response times
3. Verify resource usage
4. Test under load

### NOT_APPLICABLE
Mark with rationale if no performance-sensitive changes.

## Guardrails

- Cannot skip phases without NOT_APPLICABLE rationale
- Failures require return to IMPLEMENTATION
- All applicable checks must pass before release
