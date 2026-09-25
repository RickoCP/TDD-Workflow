---
inclusion: auto
name: "SDLC Post-Release"
description: "Post-release validation, monitoring, and maintenance workflow"
---

# SDLC Post-Release Phase

## Purpose

Validate production deployment and transition to monitoring/maintenance.

## Phases

POST_RELEASE -> MONITORING -> MAINTENANCE

## POST_RELEASE Phase

### Validation Checklist

- [ ] Application health confirmed
- [ ] Error rates within acceptable range
- [ ] Critical business flows working
- [ ] Latency within SLA
- [ ] Dependencies healthy
- [ ] Database operating normally
- [ ] External integrations working
- [ ] Metrics/alerts configured
- [ ] Logs showing expected patterns

### On Regression

If issues detected:

1. Create incident record
2. Assess severity
3. Decision: hotfix or rollback
4. If change needed, create CR and loop back to INTAKE

## MONITORING Phase

### Ongoing Checks

- Application health
- Error rates
- Performance metrics
- Resource utilization
- User feedback

### Triggering New Work

Issues discovered during monitoring should:

1. Be documented
2. Create Change Request if fix needed
3. Loop back to INTAKE phase

## MAINTENANCE Phase

### Activities

- Bug fixes (via CR -> SDLC cycle)
- Dependency updates
- Technical debt reduction
- Documentation updates

### New Features

New features start fresh INTAKE cycle.

## Retrospective

After each release, consider:

- What went well?
- What could improve?
- Process improvements?
- Tool improvements?

Document in decisions/DEC-xxx.md
