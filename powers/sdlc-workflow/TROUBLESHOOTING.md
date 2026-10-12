# SDLC Workflow Power - Troubleshooting Guide

This guide covers common issues and their solutions for the SDLC Workflow Power.

## Table of Contents

1. [Guard Script Issues](#guard-script-issues)
2. [State Management Issues](#state-management-issues)
3. [Ownership & Concurrency Issues](#ownership--concurrency-issues)
4. [Checkpoint & Recovery Issues](#checkpoint--recovery-issues)
5. [Evidence Issues](#evidence-issues)
6. [TDD Issues](#tdd-issues)
7. [Release Issues](#release-issues)
8. [Finding Issues](#finding-issues)
9. [Human Approval Gates](#human-approval-gates)
10. [Error Code Reference](#error-code-reference)

---

## Guard Script Issues

### Problem: Guard blocks unexpected files

**Symptoms**: Files that should be editable are blocked by the guard script.

**Solutions**:
1. Check `lifecycle.phase` in `.kiro/sdlc/project-state.yaml`
2. Verify `current_task.id` is set during IMPLEMENTATION
3. Ensure `current_task.tdd.phase` reflects correct TDD state
4. Verify file classification patterns in guard script

### Problem: Guard allows when it should block

**Symptoms**: Production code can be modified when it shouldn't be.

**Solutions**:
1. Verify `.kiro/sdlc/project-state.yaml` exists
2. Check file classification patterns in guard script
3. Ensure YAML parsing handles your state format
4. Verify guard hook is properly configured in `.kiro/hooks/`

### Problem: Node.js not found

**Symptoms**: Guard script fails with "node not found" error.

**Solutions**:
1. Install Node.js 18+ from nodejs.org
2. Verify with: `node --version`
3. Ensure Node.js is in PATH

---

## State Management Issues

### Problem: State version conflict (VERSION_CONFLICT)

**Symptoms**: Operations fail with "State version mismatch" error.

**Causes**: Another process modified the state between read and write.

**Solutions**:
1. The system automatically retries with exponential backoff
2. If errors persist, check for concurrent workflows
3. Verify no external tools are modifying `project-state.yaml`
4. Use `validate` to check state consistency

### Problem: State not found (STATE_NOT_FOUND)

**Symptoms**: Operations fail with "State file not found" error.

**Solutions**:
1. Verify `.kiro/sdlc/project-state.yaml` exists
2. Run `initialize SDLC workflow` if not initialized
3. Check file permissions

### Problem: Invalid state format (INVALID_STATE_FORMAT)

**Symptoms**: State file cannot be parsed.

**Solutions**:
1. Check YAML syntax in `project-state.yaml`
2. Verify required fields are present
3. Use `validate` to identify issues
4. Restore from git history if corrupted: `git checkout HEAD -- .kiro/sdlc/project-state.yaml`

### Problem: Max retries exceeded (MAX_RETRIES_EXCEEDED)

**Symptoms**: Operation fails after multiple retry attempts.

**Solutions**:
1. Check for lock contention from other processes
2. Verify file system is responsive
3. Increase retry count in configuration if needed
4. Manually resolve the state conflict

---

## Ownership & Concurrency Issues

### Problem: Task already claimed (TASK_ALREADY_CLAIMED)

**Symptoms**: Cannot claim task that's owned by another developer.

**Solutions**:
1. Request handoff from current owner
2. Wait for current owner to release
3. If owner is unresponsive, project lead can force release
4. For AI agents, wait for lease to expire

### Problem: Invalid fencing token (INVALID_FENCING_TOKEN)

**Symptoms**: Operations rejected with "invalid fencing token" error.

**Causes**:
- Token expired
- Token from previous ownership period
- Token doesn't match current task

**Solutions**:
1. Re-claim the task to get a fresh fencing token
2. If handoff occurred, the new owner has a new token
3. Check `current_task.ownership.fencing_token` in state

### Problem: Lease expired (LEASE_EXPIRED)

**Symptoms**: AI agent operations fail with "lease expired" error.

**Causes**:
- Heartbeat not sent within required interval
- Agent crashed without releasing

**Solutions**:
1. Re-claim the task with a new lease
2. Ensure heartbeat is sent every `heartbeat_interval_seconds` (default: 300s)
3. Check `checkExpiredLeases()` to see abandoned tasks

### Problem: Task abandoned

**Symptoms**: Task marked as ABANDONED after lease expiry.

**Solutions**:
1. Another developer can claim the abandoned task
2. Review checkpoint for recovery point
3. Check audit log for last operations

### Problem: Human inactivity warning

**Symptoms**: Warning about lack of progress on task.

**Solutions**:
1. This is informational only; no enforcement for humans
2. Update task status or record progress
3. Request handoff if unable to continue

---

## Checkpoint & Recovery Issues

### Problem: Checkpoint not found (CHECKPOINT_NOT_FOUND)

**Symptoms**: Recovery fails with "checkpoint not found" error.

**Solutions**:
1. List available checkpoints: `list checkpoints`
2. Check `.kiro/sdlc/checkpoints/` directory
3. Verify checkpoint ID is correct

### Problem: Checkpoint stale (CHECKPOINT_STALE)

**Symptoms**: Recovery warns that checkpoint is outdated.

**Causes**:
- Repository has commits not in checkpoint
- State version advanced since checkpoint

**Solutions**:
1. Review discrepancies in recovery plan
2. Choose appropriate reconciliation strategy:
   - AUTO_MERGE: Compatible changes merged automatically
   - PROMPT_USER: User decides how to handle conflicts
   - REJECT: Start fresh if too diverged
3. Create fresh checkpoint after reconciliation

### Problem: Checkpoint validation failed (VALIDATION_FAILED)

**Symptoms**: Checkpoint cannot be validated against current state.

**Causes**:
- Branch deleted
- Commit not reachable
- State corrupted

**Solutions**:
1. Check if branch still exists: `git branch -a`
2. Check if commit is reachable: `git cat-file -e <sha>`
3. Use older checkpoint if available
4. Manual recovery from git history

### Problem: Recovery requires confirmation (CONFIRMATION_REQUIRED)

**Symptoms**: Recovery plan requires user confirmation.

**Solutions**:
1. Review proposed recovery actions
2. Understand discrepancies before confirming
3. Accept or reject recovery plan
4. Consider creating backup before recovery

### Problem: Git state error (GIT_STATE_ERROR)

**Symptoms**: Cannot determine git state during checkpoint.

**Solutions**:
1. Verify you're in a git repository
2. Check git is accessible: `git status`
3. Ensure no git lock files: `rm .git/index.lock`

---

## Evidence Issues

### Problem: Evidence stale (EVIDENCE_STALE)

**Symptoms**: Task cannot complete due to stale evidence.

**Causes**:
- Code changed after verification
- Commit SHA doesn't match HEAD
- Related files modified

**Solutions**:
1. Re-run verification to generate fresh evidence
2. Check which files changed: `staleness.related_files`
3. Use `checkStaleness` to see staleness reason

### Problem: Evidence not found (EVIDENCE_NOT_FOUND)

**Symptoms**: Cannot find evidence record.

**Solutions**:
1. Check `.kiro/sdlc/evidence/` directory
2. Verify evidence ID format: `EVD-TASK-xxx-PHASE`
3. List evidence for task: `listEvidenceForTask(taskId)`

### Problem: Gate validation failed (GATE_VALIDATION_FAILED)

**Symptoms**: Quality gate check fails.

**Causes**:
- Missing required evidence
- Evidence result is FAIL
- Evidence is stale

**Solutions**:
1. Run required tests to generate passing evidence
2. Fix failing tests
3. Refresh stale evidence
4. Check gate configuration in `quality_gates`

### Problem: Missing required fields (MISSING_REQUIRED_FIELDS)

**Symptoms**: Evidence creation fails due to missing data.

**Solutions**:
1. Ensure all required fields provided:
   - task_id
   - requirement_refs
   - command
   - executor_id
   - executor_type
2. Check evidence input schema

---

## TDD Issues

### Problem: Test passes unexpectedly in RED phase

**Symptoms**: Test that should fail actually passes.

**Solutions**:
1. **STOP** - do not proceed to GREEN
2. Investigate: Is the test actually testing the new behavior?
3. Check if code already implements the feature
4. Verify test assertions are correct
5. Check for mocks that might be masking behavior
6. Re-evaluate test design

### Problem: Cannot write production code

**Symptoms**: Guard blocks production code changes.

**Solutions**:
1. Verify you have an active task selected
2. Check TDD phase is GREEN or REFACTOR
3. Ensure TDD is not marked as NOT_APPLICABLE incorrectly
4. Check `current_task.tdd.phase` in state

### Problem: Test error vs behavior missing

**Symptoms**: Unclear if test failure is correct or an error.

**Evidence categorizes failures**:
- `BEHAVIOR_MISSING`: Expected RED, valid
- `TEST_ERROR`: Syntax, import, assertion bug → Fix test first
- `ENVIRONMENT_ERROR`: Runtime, connection, config → Fix environment
- `SKIPPED`: Test not executed → Invalid evidence

---

## Release Issues

### Problem: Release readiness check fails

**Symptoms**: Cannot proceed to staging deployment.

**Causes**:
- Tasks not complete
- Evidence stale
- Blocking findings exist
- Quality gates not passed

**Solutions**:
1. Run `check readiness` for detailed report
2. Complete all required tasks
3. Refresh stale evidence
4. Resolve CRITICAL and HIGH findings
5. Pass all required quality gates

### Problem: Staging deployment fails

**Symptoms**: Cannot deploy to staging environment.

**Solutions**:
1. Check deployment logs
2. Verify staging environment is accessible
3. Fix issues and retry deployment
4. Release can transition to STAGING_FAILED for fixes

### Problem: Production approval denied

**Symptoms**: Human reviewer denies production approval.

**Solutions**:
1. Review denial notes
2. Address concerns
3. Return to staging for fixes if needed
4. Re-request approval after fixes

### Problem: Production deployment fails

**Symptoms**: Production deployment unsuccessful.

**Solutions**:
1. Initiate rollback if needed: `rollback release`
2. Check production logs
3. Fix issues in staging first
4. Re-deploy after successful staging verification

### Problem: Rollback fails

**Symptoms**: Cannot rollback to previous version.

**Solutions**:
1. Verify previous version information exists
2. Check `release.rollback_available` flag
3. Manual intervention may be required
4. Contact operations team if automated rollback fails

---

## Finding Issues

### Problem: Cannot close review with open findings

**Symptoms**: Review closure blocked by findings.

**Solutions**:
1. Resolve all CRITICAL findings
2. Resolve all HIGH findings
3. MEDIUM findings can be deferred with approval
4. LOW and INFO findings don't block

### Problem: Finding reopened unexpectedly

**Symptoms**: Previously resolved finding is reopened.

**Causes**:
- New evidence of regression
- Different finding created

**Solutions**:
1. Check reopen justification
2. Review new evidence provided
3. Address root cause
4. Resolve with new evidence

---

## Human Approval Gates

### Problem: Stuck at approval gate

**Symptoms**: Cannot proceed past human approval gate.

**Solutions**:
1. Check `approvals` section in `project-state.yaml`
2. Verify required fields: approver, timestamp, outcome
3. Use SKIP only for documented exceptions
4. Contact designated approver

---

## Error Code Reference

### State Controller Errors

| Code | Description | Resolution |
|------|-------------|------------|
| VERSION_CONFLICT | State version mismatch during write | Retry operation or check concurrent access |
| STATE_NOT_FOUND | State file doesn't exist | Initialize workflow or check path |
| INVALID_STATE_FORMAT | State file cannot be parsed | Fix YAML syntax or restore from git |
| WRITE_FAILED | Cannot write state file | Check file permissions |
| MAX_RETRIES_EXCEEDED | Too many retry attempts | Check for lock contention |
| CONSISTENCY_ERROR | State validation failed | Run validate command |

### Ownership Manager Errors

| Code | Description | Resolution |
|------|-------------|------------|
| TASK_ALREADY_CLAIMED | Task owned by another developer | Request handoff or wait for release |
| INVALID_FENCING_TOKEN | Token doesn't match current ownership | Re-claim task for fresh token |
| LEASE_EXPIRED | AI agent lease timed out | Re-claim with new lease |
| TASK_NOT_FOUND | Task ID doesn't exist | Verify task ID |
| INVALID_TASK_STATE | Task not in claimable state | Check task status |
| TASK_ABANDONED | Task abandoned due to expired lease | Claim the abandoned task |
| CLAIM_FAILED | Could not claim task | Check error details |
| TRANSFER_FAILED | Ownership transfer failed | Check handoff state |
| RELEASE_FAILED | Could not release task | Check fencing token |
| HEARTBEAT_FAILED | Heartbeat recording failed | Check ownership status |

### Checkpoint Manager Errors

| Code | Description | Resolution |
|------|-------------|------------|
| CHECKPOINT_NOT_FOUND | Checkpoint doesn't exist | List available checkpoints |
| CHECKPOINT_CORRUPTED | Checkpoint data invalid | Use different checkpoint |
| CHECKPOINT_STALE | Checkpoint outdated | Review discrepancies |
| VALIDATION_FAILED | Cannot validate checkpoint | Check git state |
| RECOVERY_FAILED | Recovery operation failed | Manual intervention needed |
| WRITE_FAILED | Cannot create checkpoint | Check file permissions |
| GIT_STATE_ERROR | Cannot determine git state | Check git accessibility |
| CONFIRMATION_REQUIRED | User must confirm recovery | Review and accept/reject plan |
| NO_CHECKPOINTS_AVAILABLE | No checkpoints exist | Create checkpoint first |

### Evidence Manager Errors

| Code | Description | Resolution |
|------|-------------|------------|
| EVIDENCE_NOT_FOUND | Evidence record doesn't exist | Check evidence ID |
| EVIDENCE_CORRUPTED | Evidence data invalid | Re-create evidence |
| EVIDENCE_STALE | Evidence outdated | Re-run verification |
| WRITE_FAILED | Cannot create evidence | Check file permissions |
| GIT_STATE_ERROR | Cannot determine git state | Check git accessibility |
| GATE_VALIDATION_FAILED | Quality gate check failed | Fix tests or refresh evidence |
| MISSING_REQUIRED_FIELDS | Evidence input incomplete | Provide all required fields |
| TASK_NOT_FOUND | Task for evidence doesn't exist | Verify task ID |
| INVALID_TYPE | Invalid evidence type | Use valid evidence type |

---

## Common Commands Reference

| Command | Purpose |
|---------|---------|
| `status` | Show current phase and task |
| `resume` | Recover after interruption |
| `validate` | Check workflow consistency |
| `checkpoint` | Create manual checkpoint |
| `list checkpoints` | Show available checkpoints |
| `claim task TASK-xxx` | Claim task ownership |
| `release task` | Release current task |
| `heartbeat` | Record AI agent heartbeat |
| `check readiness` | Run release readiness check |

---

## Getting Help

If you encounter issues not covered here:

1. Check the audit log for error details: `.kiro/sdlc/audit.log`
2. Review recent state changes in git history
3. Use `validate` to check overall consistency
4. Create a checkpoint before attempting fixes

## See Also

- [README.md](./README.md) - Getting started guide
- [POWER.md](./POWER.md) - Power documentation
- [WORKFLOW-DIAGRAMS.md](./WORKFLOW-DIAGRAMS.md) - Visual workflow diagrams
