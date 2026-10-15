---
inclusion: auto
name: "SDLC Design"
description: "Creates technical design and architecture decision records before implementation"
---

# SDLC Design Phase

## Purpose

The DESIGN phase defines HOW we will implement the requirements through technical design documents and architecture decision records (ADRs).

## When This Activates

- After REQ_REVIEW approval
- User says "design", "architecture", "adr", "technical design"
- Current phase is DESIGN

## Prerequisites

- Requirements approved (REQ_REVIEW passed)
- lifecycle.phase == DESIGN

## Design Document Structure

Each design (DESIGN-xxx.md) covers:

1. **Overview**: High-level description
2. **Architecture Impact**: How this affects overall architecture
3. **Component Design**: Components involved
4. **Data Model**: Data structures and storage
5. **API/Interface Contracts**: External interfaces
6. **State Transitions**: State machine if applicable
7. **Error Handling**: Failure scenarios
8. **Security Considerations**: Security aspects
9. **Performance Considerations**: Performance aspects
10. **Migration Strategy**: How to migrate
11. **Rollback Strategy**: How to rollback
12. **Testing Strategy**: How to test

## Architecture Decision Records (ADR)

For significant decisions, create ADR-xxx.md:

1. **Context**: Why this decision is needed
2. **Decision**: What was decided
3. **Alternatives**: What else was considered
4. **Consequences**: Impact of the decision
5. **Risks**: Associated risks
6. **Rollback Strategy**: How to reverse if needed

## Design Review Gate (HUMAN)

Design cannot proceed to PLANNING without:

1. Technical design addresses all requirements
2. Human reviews and approves design
3. Approval recorded in traceability.yaml

For trivial changes, DESIGN_REVIEW can be marked NOT_APPLICABLE with rationale.

## Guardrails

- NO code changes during DESIGN
- Design must reference requirements
- ADRs required for architectural decisions
