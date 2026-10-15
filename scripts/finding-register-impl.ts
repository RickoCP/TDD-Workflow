/**
 * Finding Register Implementation
 * 
 * This module implements the Finding_Register component which provides
 * review findings management, status tracking, and review closure logic.
 * 
 * The FileFindingRegister class:
 * - Creates and persists findings to YAML files
 * - Manages finding status lifecycle with validation
 * - Enforces review closure criteria
 * - Supports finding reopen with evidence requirement
 * 
 * Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7, R11.8
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as yaml from 'yaml';

import {
  // Types
  FindingRegister,
  Finding,
  FindingInput,
  FindingStatusUpdate,
  FindingQueryOptions,
  ReopenFindingInput,
  ReopenFindingResultData,
  DeferFindingInput,
  DeferralInfo,
  CloseReviewInput,
  ReviewClosureResult,
  MissingApprovalInfo,
  FindingStatus,
  FindingSeverity,
  FindingCategory,
  FindingScope,
  FindingsSummary,
  ReviewClosureCheck,
  ResolutionInfo,
  FindingHistoryEntry,
  FindingRegisterConfig,
  
  // Result types
  CreateFindingResult,
  GetFindingResult,
  ListFindingsResult,
  UpdateFindingResult,
  CanCloseReviewResult,
  DeleteFindingResult,
  GetFindingsSummaryResult,
  DeferFindingResult,
  CloseReviewResult,
  ReopenFindingResult,
  
  // Error types and factories
  FindingError,
  FindingErrorCode,
  createFindingError,
  findingNotFoundError,
  findingCorruptedError,
  invalidStatusTransitionError,
  writeFindingFailedError,
  missingRequiredFieldsError,
  resolutionRequiredError,
  reopenEvidenceRequiredError,
  duplicateRefRequiredError,
  reviewCannotCloseError,
  invalidScopeError,
  maxReviewRoundsExceededError,
  cannotDeferSeverityError,
  deferralApprovalRequiredError,
  findingAlreadyOpenError,
  
  // Utility functions and constants
  ok,
  err,
  Result,
  FINDING_DEFAULTS,
  VALID_STATUS_TRANSITIONS,
  BLOCKING_SEVERITIES,
  RELEASE_BLOCKING_SEVERITIES,
  DEFERRABLE_SEVERITIES,
  isValidStatusTransition,
  isOpenStatus,
  isClosedStatus,
  isSeverityBlocking,
  canDeferSeverity,
  createEmptyFindingsSummary,
  generateFindingId,
  isValidFindingId,
} from './finding-register';

import {
  AuditLogger,
  createAuditEntry,
} from './audit-logger';

import { ActorType } from './state-controller';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Default configuration for FileFindingRegister.
 */
export const DEFAULT_FILE_FINDING_REGISTER_CONFIG: Required<FindingRegisterConfig> = {
  storagePath: FINDING_DEFAULTS.STORAGE_DIR,
  maxReviewRounds: FINDING_DEFAULTS.MAX_REVIEW_ROUNDS,
  enforceStatusTransitions: true,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generates a UUID v4 for operation tracking.
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Gets the current ISO timestamp.
 */
function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Validates that required string fields are non-empty.
 */
function validateRequiredStringFields(
  fields: Record<string, string | undefined>,
  fieldNames: string[]
): string[] {
  const missingFields: string[] = [];
  
  for (const name of fieldNames) {
    const value = fields[name];
    if (value === undefined || value === null || value.trim() === '') {
      missingFields.push(name);
    }
  }
  
  return missingFields;
}

/**
 * Validates finding scope format.
 */
function validateScope(scope: FindingScope): boolean {
  if (!scope || !scope.type) {
    return false;
  }
  
  if (scope.type === 'file_location') {
    return (
      typeof scope.file === 'string' &&
      scope.file.trim() !== '' &&
      typeof scope.line_start === 'number' &&
      scope.line_start >= 0
    );
  }
  
  if (scope.type === 'general') {
    return true; // general scope doesn't require additional fields
  }
  
  return false;
}

/**
 * Validates severity value.
 */
function isValidSeverity(severity: unknown): severity is FindingSeverity {
  return (
    typeof severity === 'string' &&
    ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(severity)
  );
}

/**
 * Validates category value.
 */
function isValidCategory(category: unknown): category is FindingCategory {
  return (
    typeof category === 'string' &&
    ['BUG', 'SECURITY', 'PERFORMANCE', 'STYLE', 'DOCUMENTATION', 'OTHER'].includes(category)
  );
}

/**
 * Validates status value.
 */
function isValidStatus(status: unknown): status is FindingStatus {
  return (
    typeof status === 'string' &&
    ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'DUPLICATE', 'DEFERRED'].includes(status)
  );
}

/**
 * Sorts findings by specified field and order.
 */
function sortFindings(
  findings: Finding[],
  sortBy: 'created_at' | 'severity' | 'status' = 'created_at',
  sortOrder: 'asc' | 'desc' = 'desc'
): Finding[] {
  const severityOrder: Record<FindingSeverity, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
    INFO: 4,
  };
  
  const statusOrder: Record<FindingStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 1,
    RESOLVED: 2,
    WONT_FIX: 3,
    DUPLICATE: 4,
    DEFERRED: 5,
  };
  
  const sorted = [...findings].sort((a, b) => {
    let comparison = 0;
    
    switch (sortBy) {
      case 'created_at':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case 'severity':
        comparison = severityOrder[a.severity] - severityOrder[b.severity];
        break;
      case 'status':
        comparison = statusOrder[a.status] - statusOrder[b.status];
        break;
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
  
  return sorted;
}

/**
 * Filters findings based on query options.
 */
function filterFindings(
  findings: Finding[],
  options: FindingQueryOptions
): Finding[] {
  let result = [...findings];
  
  // Filter by status
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    result = result.filter(f => statuses.includes(f.status));
  }
  
  // Filter by severity
  if (options.severity) {
    const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
    result = result.filter(f => severities.includes(f.severity));
  }
  
  // Filter by category
  if (options.category) {
    const categories = Array.isArray(options.category) ? options.category : [options.category];
    result = result.filter(f => categories.includes(f.category));
  }
  
  // Filter by owner
  if (options.owner_id) {
    result = result.filter(f => f.owner_id === options.owner_id);
  }
  
  // Filter by review round
  if (options.review_round !== undefined) {
    result = result.filter(f => f.review_round === options.review_round);
  }
  
  // Sort
  if (options.sort_by) {
    result = sortFindings(result, options.sort_by, options.sort_order);
  }
  
  // Pagination
  if (options.offset !== undefined && options.offset > 0) {
    result = result.slice(options.offset);
  }
  if (options.limit !== undefined && options.limit > 0) {
    result = result.slice(0, options.limit);
  }
  
  return result;
}

// =============================================================================
// FileFindingRegister Implementation
// =============================================================================

/**
 * File-based implementation of FindingRegister.
 * 
 * Findings are stored as YAML files in `.kiro/sdlc/findings/` directory.
 * Each finding is stored in its own file named `{finding_id}.yaml`.
 * 
 * Requirements: R11.1, R11.2, R11.3, R11.4, R11.5, R11.6, R11.7, R11.8
 */
export class FileFindingRegister implements FindingRegister {
  private readonly config: Required<FindingRegisterConfig>;
  private readonly workspacePath: string;
  private readonly auditLogger?: AuditLogger;
  
  constructor(
    workspacePath: string,
    config?: Partial<FindingRegisterConfig>,
    auditLogger?: AuditLogger
  ) {
    this.workspacePath = workspacePath;
    this.config = {
      ...DEFAULT_FILE_FINDING_REGISTER_CONFIG,
      ...config,
    };
    this.auditLogger = auditLogger;
  }
  
  // ===========================================================================
  // Audit Logging Helper
  // ===========================================================================
  
  /**
   * Logs a finding event to the audit logger (fire-and-forget).
   */
  private logFindingEvent(
    action: string,
    findingId: string,
    taskId: string,
    actorId: string,
    details?: { 
      from_status?: FindingStatus; 
      to_status?: FindingStatus; 
      reason?: string;
    }
  ): void {
    if (!this.auditLogger) return;

    const changes = details?.from_status && details?.to_status 
      ? { status: { from: details.from_status, to: details.to_status } }
      : undefined;

    const entry = createAuditEntry({
      actor_id: actorId,
      actor_type: 'HUMAN' as ActorType, // Reviewers are typically human
      action,
      resource_type: 'Finding',
      resource_id: findingId,
      changes,
      reason: details?.reason,
      outcome: 'SUCCESS',
    });

    // Fire-and-forget
    this.auditLogger.log(entry).catch(() => {
      // Silently ignore audit log failures
    });
  }
  
  // ===========================================================================
  // Creation Operations
  // ===========================================================================
  
  /**
   * Creates a new finding.
   * 
   * Requirements: R11.1
   * 
   * @param input - Finding input data
   * @returns Result with Finding on success, or FindingError on failure
   */
  async createFinding(input: FindingInput): Promise<CreateFindingResult> {
    // Validate required fields
    const missingFields = validateRequiredStringFields(
      {
        task_id: input.task_id,
        description: input.description,
        evidence: input.evidence,
        acceptance_criteria: input.acceptance_criteria,
        owner_id: input.owner_id,
        reviewer_id: input.reviewer_id,
      },
      ['task_id', 'description', 'evidence', 'acceptance_criteria', 'owner_id', 'reviewer_id']
    );
    
    if (missingFields.length > 0) {
      return err(missingRequiredFieldsError(missingFields));
    }
    
    // Validate severity
    if (!isValidSeverity(input.severity)) {
      return err(createFindingError(
        FindingErrorCode.INVALID_SEVERITY,
        `Invalid severity value: ${input.severity}`,
        { severity: input.severity },
        false,
        'Use one of: CRITICAL, HIGH, MEDIUM, LOW, INFO'
      ));
    }
    
    // Validate category
    if (!isValidCategory(input.category)) {
      return err(createFindingError(
        FindingErrorCode.INVALID_CATEGORY,
        `Invalid category value: ${input.category}`,
        { category: input.category },
        false,
        'Use one of: BUG, SECURITY, PERFORMANCE, STYLE, DOCUMENTATION, OTHER'
      ));
    }
    
    // Validate scope
    if (!validateScope(input.scope)) {
      return err(invalidScopeError('Scope must be file_location with file and line_start, or general'));
    }
    
    // Check review round limit
    if (input.review_round > this.config.maxReviewRounds) {
      return err(maxReviewRoundsExceededError(input.task_id, input.review_round));
    }
    
    try {
      // Generate unique finding ID
      const findingId = await this.generateUniqueFindingId();
      const timestamp = getCurrentTimestamp();
      
      // Create finding object
      const finding: Finding = {
        finding_id: findingId,
        created_at: timestamp,
        task_id: input.task_id,
        review_round: input.review_round,
        severity: input.severity,
        category: input.category,
        scope: input.scope,
        description: input.description,
        evidence: input.evidence,
        acceptance_criteria: input.acceptance_criteria,
        owner_id: input.owner_id,
        status: 'OPEN',
        resolution: undefined,
        resolved_at: undefined,
        history: [
          {
            action: 'created',
            timestamp,
            by: input.reviewer_id,
            details: `Finding created with severity ${input.severity}`,
          },
        ],
        duplicate_of: undefined,
        metadata: input.metadata,
      };
      
      // Persist finding
      await this.writeFinding(finding);

      // Log the finding creation event
      this.logFindingEvent(
        'FINDING_CREATED',
        findingId,
        input.task_id,
        input.reviewer_id,
        { reason: `Finding created with severity ${input.severity}` }
      );
      
      return ok(finding);
    } catch (error) {
      return err(writeFindingFailedError(
        input.task_id,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
  
  // ===========================================================================
  // Update Operations
  // ===========================================================================
  
  /**
   * Updates finding status.
   * 
   * Requirements: R11.1, R11.3
   * 
   * @param findingId - The finding ID to update
   * @param update - Status update data
   * @returns Result with updated Finding on success, or FindingError on failure
   */
  async updateFindingStatus(
    findingId: string,
    update: FindingStatusUpdate
  ): Promise<UpdateFindingResult> {
    // Get existing finding
    const findingResult = await this.getFinding(findingId);
    if (!findingResult.success) {
      return findingResult;
    }
    
    const finding = findingResult.value;
    const timestamp = getCurrentTimestamp();
    
    // Validate status transition
    if (this.config.enforceStatusTransitions) {
      if (!isValidStatusTransition(finding.status, update.status)) {
        return err(invalidStatusTransitionError(findingId, finding.status, update.status));
      }
    }
    
    // Validate RESOLVED requires resolution info
    if (update.status === 'RESOLVED') {
      if (!update.resolution) {
        return err(resolutionRequiredError(findingId));
      }
      
      // Validate resolution fields
      const missingResolutionFields = validateRequiredStringFields(
        {
          resolution_evidence: update.resolution.resolution_evidence,
          resolved_at: update.resolution.resolved_at,
          resolved_by: update.resolution.resolved_by,
        },
        ['resolution_evidence', 'resolved_at', 'resolved_by']
      );
      
      if (missingResolutionFields.length > 0) {
        return err(createFindingError(
          FindingErrorCode.RESOLUTION_REQUIRED,
          `Resolution missing required fields: ${missingResolutionFields.join(', ')}`,
          { finding_id: findingId, missing_fields: missingResolutionFields },
          false,
          'Provide resolution_evidence, resolved_at, and resolved_by'
        ));
      }
    }
    
    // Validate DUPLICATE requires duplicate_of reference
    if (update.status === 'DUPLICATE') {
      if (!update.duplicate_of || update.duplicate_of.trim() === '') {
        return err(duplicateRefRequiredError(findingId));
      }
    }
    
    // Create history entry
    const historyEntry: FindingHistoryEntry = {
      action: 'status_changed',
      timestamp,
      by: update.updated_by,
      from: finding.status,
      to: update.status,
      details: update.notes,
    };
    
    // Update finding
    const updatedFinding: Finding = {
      ...finding,
      status: update.status,
      resolution: update.status === 'RESOLVED' ? update.resolution : finding.resolution,
      resolved_at: update.status === 'RESOLVED' ? update.resolution?.resolved_at : finding.resolved_at,
      duplicate_of: update.status === 'DUPLICATE' ? update.duplicate_of : finding.duplicate_of,
      history: [...finding.history, historyEntry],
    };
    
    try {
      await this.writeFinding(updatedFinding);

      // Log the finding status change event
      this.logFindingEvent(
        'FINDING_STATUS_CHANGE',
        findingId,
        finding.task_id,
        update.updated_by,
        { 
          from_status: finding.status, 
          to_status: update.status,
          reason: update.notes 
        }
      );

      return ok(updatedFinding);
    } catch (error) {
      return err(writeFindingFailedError(
        finding.task_id,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
  
  // ===========================================================================
  // Query Operations
  // ===========================================================================
  
  /**
   * Gets a finding by ID.
   * 
   * @param findingId - The finding ID to retrieve
   * @returns Result with Finding on success, or FindingError on failure
   */
  async getFinding(findingId: string): Promise<GetFindingResult> {
    const filePath = this.getFindingFilePath(findingId);
    
    try {
      const exists = await this.fileExists(filePath);
      if (!exists) {
        return err(findingNotFoundError(findingId));
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      const finding = yaml.parse(content) as Finding;
      
      // Validate finding structure
      if (!finding || !finding.finding_id) {
        return err(findingCorruptedError(findingId, 'Invalid finding structure'));
      }
      
      return ok(finding);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return err(findingNotFoundError(findingId));
      }
      return err(findingCorruptedError(
        findingId,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
  
  /**
   * Gets findings for a task.
   * 
   * @param taskId - Task ID to get findings for
   * @param options - Optional query options
   * @returns Result with Finding array on success, or FindingError on failure
   */
  async getFindingsForTask(
    taskId: string,
    options?: FindingQueryOptions
  ): Promise<ListFindingsResult> {
    const allFindingsResult = await this.listFindings();
    if (!allFindingsResult.success) {
      return allFindingsResult;
    }
    
    // Filter by task ID
    let findings = allFindingsResult.value.filter(f => f.task_id === taskId);
    
    // Apply additional filters
    if (options) {
      findings = filterFindings(findings, options);
    } else {
      // Default sort by created_at desc
      findings = sortFindings(findings, 'created_at', 'desc');
    }
    
    return ok(findings);
  }
  
  /**
   * Gets open blocking findings for a task.
   * Returns findings with OPEN or IN_PROGRESS status and CRITICAL or HIGH severity.
   * 
   * Requirements: R11.5
   * 
   * @param taskId - Task ID to get blocking findings for
   * @returns Result with Finding array on success, or FindingError on failure
   */
  async getBlockingFindings(taskId: string): Promise<ListFindingsResult> {
    return this.getFindingsForTask(taskId, {
      status: ['OPEN', 'IN_PROGRESS'],
      severity: BLOCKING_SEVERITIES as FindingSeverity[],
      sort_by: 'severity',
      sort_order: 'asc',
    });
  }
  
  /**
   * Gets findings summary for a task.
   * 
   * @param taskId - Task ID to get summary for
   * @returns Result with FindingsSummary on success, or FindingError on failure
   */
  async getFindingsSummary(taskId: string): Promise<GetFindingsSummaryResult> {
    const findingsResult = await this.getFindingsForTask(taskId);
    if (!findingsResult.success) {
      return findingsResult as unknown as GetFindingsSummaryResult;
    }
    
    const findings = findingsResult.value;
    const summary = createEmptyFindingsSummary();
    
    summary.total = findings.length;
    
    for (const finding of findings) {
      // Count by status
      summary.by_status[finding.status]++;
      
      // Count by severity
      summary.by_severity[finding.severity]++;
      
      // Count blocking release (CRITICAL/HIGH that are not resolved)
      if (
        RELEASE_BLOCKING_SEVERITIES.includes(finding.severity) &&
        isOpenStatus(finding.status)
      ) {
        summary.blocking_release++;
      }
      
      // Count open critical
      if (finding.severity === 'CRITICAL' && isOpenStatus(finding.status)) {
        summary.open_critical++;
      }
      
      // Count open high
      if (finding.severity === 'HIGH' && isOpenStatus(finding.status)) {
        summary.open_high++;
      }
    }
    
    return ok(summary);
  }
  
  // ===========================================================================
  // Review Closure Operations
  // ===========================================================================
  
  /**
   * Checks if review can be closed for a task.
   * 
   * Requirements: R11.4, R11.5
   * 
   * @param taskId - Task ID to check
   * @returns Result with ReviewClosureCheck on success, or FindingError on failure
   * 
   * Closure rules:
   * - CRITICAL: Must be RESOLVED or WONT_FIX with approval (cannot be DEFERRED)
   * - HIGH: Must be RESOLVED or WONT_FIX with approval (cannot be DEFERRED)
   * - MEDIUM: Can be RESOLVED, WONT_FIX, or DEFERRED with approval
   * - LOW: Can be OPEN or DEFERRED (doesn't block)
   * - INFO: Doesn't block (can be any status)
   */
  async canCloseReview(taskId: string): Promise<CanCloseReviewResult> {
    const findingsResult = await this.getFindingsForTask(taskId);
    if (!findingsResult.success) {
      return findingsResult as unknown as CanCloseReviewResult;
    }
    
    const findings = findingsResult.value;
    const summaryResult = await this.getFindingsSummary(taskId);
    if (!summaryResult.success) {
      return summaryResult as unknown as CanCloseReviewResult;
    }
    
    const summary = summaryResult.value;
    const timestamp = getCurrentTimestamp();
    
    const blockers: Finding[] = [];
    const blockingReasons: string[] = [];
    const deferredFindings: Finding[] = [];
    const missingApprovals: MissingApprovalInfo[] = [];
    
    // Check each finding
    for (const finding of findings) {
      const { severity, status, finding_id } = finding;
      
      // CRITICAL: Must be RESOLVED or WONT_FIX (cannot be DEFERRED)
      if (severity === 'CRITICAL') {
        if (status === 'OPEN' || status === 'IN_PROGRESS') {
          blockers.push(finding);
          blockingReasons.push(`CRITICAL finding ${finding_id} is ${status} - must be RESOLVED or WONT_FIX`);
        }
        if (status === 'DEFERRED') {
          blockers.push(finding);
          blockingReasons.push(`CRITICAL finding ${finding_id} cannot be deferred - must be RESOLVED or WONT_FIX`);
        }
        continue;
      }
      
      // HIGH: Must be RESOLVED or WONT_FIX (cannot be DEFERRED)
      if (severity === 'HIGH') {
        if (status === 'OPEN' || status === 'IN_PROGRESS') {
          blockers.push(finding);
          blockingReasons.push(`HIGH finding ${finding_id} is ${status} - must be RESOLVED or WONT_FIX`);
        }
        if (status === 'DEFERRED') {
          blockers.push(finding);
          blockingReasons.push(`HIGH finding ${finding_id} cannot be deferred - must be RESOLVED or WONT_FIX`);
        }
        continue;
      }
      
      // MEDIUM: Must be RESOLVED, WONT_FIX, or DEFERRED with approval
      if (severity === 'MEDIUM') {
        if (status === 'OPEN' || status === 'IN_PROGRESS') {
          blockers.push(finding);
          blockingReasons.push(`MEDIUM finding ${finding_id} is ${status} - must be RESOLVED, WONT_FIX, or DEFERRED with approval`);
          missingApprovals.push({
            finding_id,
            severity,
            status,
            approval_needed: 'Resolve, mark as WONT_FIX, or defer with approval',
          });
        }
        if (status === 'DEFERRED') {
          // Check if deferral has approval
          if (!finding.deferral?.approved_by) {
            blockers.push(finding);
            blockingReasons.push(`MEDIUM finding ${finding_id} is DEFERRED but missing approval`);
            missingApprovals.push({
              finding_id,
              severity,
              status,
              approval_needed: 'Deferral approval required',
            });
          } else {
            deferredFindings.push(finding);
          }
        }
        if (status === 'WONT_FIX') {
          deferredFindings.push(finding); // WONT_FIX acts as explicit deferral
        }
        continue;
      }
      
      // LOW: Doesn't block - track if deferred
      if (severity === 'LOW') {
        if (status === 'DEFERRED') {
          deferredFindings.push(finding);
        }
        continue;
      }
      
      // INFO: Doesn't block - track if deferred
      if (severity === 'INFO') {
        if (status === 'DEFERRED') {
          deferredFindings.push(finding);
        }
        continue;
      }
    }
    
    const canClose = blockers.length === 0;
    
    const result: ReviewClosureCheck = {
      task_id: taskId,
      can_close: canClose,
      checked_at: timestamp,
      summary,
      blockers,
      blocking_reasons: blockingReasons,
      deferred_findings: deferredFindings,
      missing_approvals: missingApprovals,
    };
    
    return ok(result);
  }
  
  /**
   * Closes a review for a task.
   * 
   * Requirements: R11.5
   * 
   * @param taskId - Task ID to close review for
   * @param input - Close review input
   * @returns Result with ReviewClosureResult on success, or FindingError on failure
   */
  async closeReview(taskId: string, input: CloseReviewInput): Promise<CloseReviewResult> {
    // First check if review can be closed
    const canCloseResult = await this.canCloseReview(taskId);
    if (!canCloseResult.success) {
      return canCloseResult as unknown as CloseReviewResult;
    }
    
    const closure = canCloseResult.value;
    
    if (!closure.can_close) {
      return err(reviewCannotCloseError(taskId, closure.blocking_reasons));
    }
    
    const timestamp = getCurrentTimestamp();
    
    const result: ReviewClosureResult = {
      closed: true,
      task_id: taskId,
      closed_at: timestamp,
      closed_by: input.closed_by,
      summary: closure.summary,
      deferred_findings: closure.deferred_findings,
      notes: input.notes,
    };
    
    return ok(result);
  }
  
  /**
   * Defers a finding with approval.
   * 
   * Requirements: R11.4, R11.5
   * 
   * @param findingId - Finding ID to defer
   * @param input - Defer finding input with reason and approval
   * @returns Result with updated Finding on success, or FindingError on failure
   * 
   * Deferral rules:
   * - CRITICAL: Cannot be deferred
   * - HIGH: Cannot be deferred
   * - MEDIUM: Can be deferred with approval
   * - LOW: Can be deferred
   * - INFO: Can be deferred
   */
  async deferFinding(findingId: string, input: DeferFindingInput): Promise<DeferFindingResult> {
    // Validate required fields
    const missingFields = validateRequiredStringFields(
      {
        reason: input.reason,
        approved_by: input.approved_by,
      },
      ['reason', 'approved_by']
    );
    
    if (missingFields.length > 0) {
      return err(deferralApprovalRequiredError(findingId));
    }
    
    // Get existing finding
    const findingResult = await this.getFinding(findingId);
    if (!findingResult.success) {
      return findingResult;
    }
    
    const finding = findingResult.value;
    const timestamp = getCurrentTimestamp();
    
    // Check if severity allows deferral
    if (!canDeferSeverity(finding.severity)) {
      return err(cannotDeferSeverityError(findingId, finding.severity));
    }
    
    // Check if finding is already deferred
    if (finding.status === 'DEFERRED') {
      return err(createFindingError(
        FindingErrorCode.INVALID_STATUS_TRANSITION,
        `Finding ${findingId} is already DEFERRED`,
        { finding_id: findingId, status: finding.status },
        false,
        'Finding is already in DEFERRED status'
      ));
    }
    
    // Check if finding is in a closed status
    if (finding.status === 'RESOLVED' || finding.status === 'WONT_FIX' || finding.status === 'DUPLICATE') {
      return err(createFindingError(
        FindingErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot defer finding ${findingId} with status ${finding.status}`,
        { finding_id: findingId, status: finding.status },
        false,
        'Cannot defer a finding that is already resolved, marked as WONT_FIX, or duplicate'
      ));
    }
    
    // Create deferral info
    const deferralInfo: DeferralInfo = {
      reason: input.reason,
      approved_by: input.approved_by,
      deferred_at: timestamp,
      deferred_to: input.deferred_to,
      notes: input.notes,
    };
    
    // Create history entry
    const historyEntry: FindingHistoryEntry = {
      action: 'status_changed',
      timestamp,
      by: input.approved_by,
      from: finding.status,
      to: 'DEFERRED',
      details: `Deferred: ${input.reason}${input.deferred_to ? ` (to: ${input.deferred_to})` : ''}`,
    };
    
    // Update finding
    const updatedFinding: Finding = {
      ...finding,
      status: 'DEFERRED',
      deferral: deferralInfo,
      history: [...finding.history, historyEntry],
    };
    
    try {
      await this.writeFinding(updatedFinding);
      return ok(updatedFinding);
    } catch (error) {
      return err(writeFindingFailedError(
        finding.task_id,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
  
  // ===========================================================================
  // Reopen Operations
  // ===========================================================================
  
  /**
   * Reopens a finding with new evidence.
   * 
   * Requirements: R11.3
   * 
   * When is_different_issue=true:
   * - Creates a new finding with a new ID
   * - Links the new finding to the original via original_finding_id
   * - The original finding remains in its closed state
   * - Returns both original and new finding in result
   * 
   * When is_different_issue=false (default):
   * - Reopens the same finding with status=OPEN
   * - Clears resolution, resolved_at, and duplicate_of
   * - Adds history entry with reopen details
   * - Returns the reopened finding in result
   * 
   * @param findingId - The finding ID to reopen
   * @param input - Reopen input with new evidence, justification, and is_different_issue flag
   * @returns Result with ReopenFindingResultData on success, or FindingError on failure
   */
  async reopenFinding(
    findingId: string,
    input: ReopenFindingInput
  ): Promise<ReopenFindingResult> {
    // Validate required fields
    const missingFields = validateRequiredStringFields(
      {
        new_evidence: input.new_evidence,
        justification: input.justification,
        reopened_by: input.reopened_by,
      },
      ['new_evidence', 'justification', 'reopened_by']
    );
    
    if (missingFields.length > 0) {
      return err(reopenEvidenceRequiredError(findingId));
    }
    
    // Get existing finding
    const findingResult = await this.getFinding(findingId);
    if (!findingResult.success) {
      return findingResult as unknown as ReopenFindingResult;
    }
    
    const finding = findingResult.value;
    const timestamp = getCurrentTimestamp();
    
    // Handle is_different_issue case - create a new finding linked to original
    if (input.is_different_issue === true) {
      // For different issue, we can create from any status (open or closed)
      // Generate new finding ID
      const newFindingId = await this.generateUniqueFindingId();
      
      // Create history entry for new finding
      const newHistoryEntry: FindingHistoryEntry = {
        action: 'created',
        timestamp,
        by: input.reopened_by,
        details: `Created as different issue from ${findingId}. New evidence: ${input.new_evidence}. Justification: ${input.justification}`,
      };
      
      // Create new finding linked to original
      const newFinding: Finding = {
        finding_id: newFindingId,
        created_at: timestamp,
        task_id: finding.task_id,
        review_round: finding.review_round + 1, // Increment review round
        severity: finding.severity,
        category: finding.category,
        scope: finding.scope,
        description: `${finding.description}\n\n[New evidence from ${findingId}]: ${input.new_evidence}`,
        evidence: input.new_evidence,
        acceptance_criteria: finding.acceptance_criteria,
        owner_id: finding.owner_id,
        status: 'OPEN',
        resolution: undefined,
        deferral: undefined,
        resolved_at: undefined,
        history: [newHistoryEntry],
        duplicate_of: undefined,
        original_finding_id: findingId, // Link to original finding
        metadata: {
          ...finding.metadata,
          created_from_finding: findingId,
          creation_justification: input.justification,
        },
      };
      
      // Add history entry to original finding about the new finding
      const originalHistoryEntry: FindingHistoryEntry = {
        action: 'commented',
        timestamp,
        by: input.reopened_by,
        details: `Different issue created as ${newFindingId}. Original remains closed.`,
      };
      
      const updatedOriginalFinding: Finding = {
        ...finding,
        history: [...finding.history, originalHistoryEntry],
      };
      
      try {
        // Write both findings
        await this.writeFinding(newFinding);
        await this.writeFinding(updatedOriginalFinding);
        
        const result: ReopenFindingResultData = {
          finding: updatedOriginalFinding,
          new_finding: newFinding,
          created_new_finding: true,
        };
        
        return ok(result);
      } catch (error) {
        return err(writeFindingFailedError(
          finding.task_id,
          error instanceof Error ? error.message : 'Unknown error'
        ));
      }
    }
    
    // Default case: is_different_issue=false - reopen the same finding
    // Check if finding is already open
    if (isOpenStatus(finding.status)) {
      return err(findingAlreadyOpenError(findingId));
    }
    
    // Create history entry
    const historyEntry: FindingHistoryEntry = {
      action: 'reopened',
      timestamp,
      by: input.reopened_by,
      from: finding.status,
      to: 'OPEN',
      details: `Reopened: ${input.justification}. New evidence: ${input.new_evidence}`,
    };
    
    // Update finding
    const updatedFinding: Finding = {
      ...finding,
      status: 'OPEN',
      resolution: undefined,
      resolved_at: undefined,
      duplicate_of: undefined,
      deferral: undefined, // Clear deferral info too
      history: [...finding.history, historyEntry],
    };
    
    try {
      await this.writeFinding(updatedFinding);
      
      const result: ReopenFindingResultData = {
        finding: updatedFinding,
        new_finding: undefined,
        created_new_finding: false,
      };
      
      return ok(result);
    } catch (error) {
      return err(writeFindingFailedError(
        finding.task_id,
        error instanceof Error ? error.message : 'Unknown error'
      ));
    }
  }
  
  // ===========================================================================
  // Deletion Operations
  // ===========================================================================
  
  /**
   * Deletes a finding by ID.
   * 
   * @param findingId - The finding ID to delete
   * @returns Result with void on success, or FindingError on failure
   */
  async deleteFinding(findingId: string): Promise<DeleteFindingResult> {
    const filePath = this.getFindingFilePath(findingId);
    
    try {
      const exists = await this.fileExists(filePath);
      if (!exists) {
        return err(findingNotFoundError(findingId));
      }
      
      await fs.unlink(filePath);
      return ok(undefined);
    } catch (error) {
      return err(createFindingError(
        FindingErrorCode.DELETE_FAILED,
        `Failed to delete finding ${findingId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { finding_id: findingId },
        true,
        'Check file permissions and try again'
      ));
    }
  }
  
  // ===========================================================================
  // Bulk Operations
  // ===========================================================================
  
  /**
   * Lists all findings, optionally with query options.
   * 
   * @param options - Optional query options
   * @returns Result with Finding array on success, or FindingError on failure
   */
  async listFindings(options?: FindingQueryOptions): Promise<ListFindingsResult> {
    const storagePath = this.getAbsoluteStoragePath();
    
    try {
      // Ensure storage directory exists
      await this.ensureStorageDirectory();
      
      // Read all finding files
      const entries = await fs.readdir(storagePath, { withFileTypes: true });
      const yamlFiles = entries.filter(
        e => e.isFile() && e.name.endsWith('.yaml')
      );
      
      const findings: Finding[] = [];
      
      for (const file of yamlFiles) {
        const filePath = path.join(storagePath, file.name);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const finding = yaml.parse(content) as Finding;
          
          if (finding && finding.finding_id) {
            findings.push(finding);
          }
        } catch {
          // Skip corrupted files
          continue;
        }
      }
      
      // Apply filters and sorting
      const filteredFindings = options
        ? filterFindings(findings, options)
        : sortFindings(findings, 'created_at', 'desc');
      
      return ok(filteredFindings);
    } catch (error) {
      return err(createFindingError(
        FindingErrorCode.FINDING_CORRUPTED,
        `Failed to list findings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {},
        true,
        'Check storage directory permissions'
      ));
    }
  }
  
  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================
  
  /**
   * Gets the absolute path to the storage directory.
   */
  private getAbsoluteStoragePath(): string {
    return path.join(this.workspacePath, this.config.storagePath);
  }
  
  /**
   * Gets the file path for a finding.
   */
  private getFindingFilePath(findingId: string): string {
    return path.join(this.getAbsoluteStoragePath(), `${findingId}.yaml`);
  }
  
  /**
   * Ensures the storage directory exists.
   */
  private async ensureStorageDirectory(): Promise<void> {
    const storagePath = this.getAbsoluteStoragePath();
    await fs.mkdir(storagePath, { recursive: true });
  }
  
  /**
   * Checks if a file exists.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Writes a finding to file.
   */
  private async writeFinding(finding: Finding): Promise<void> {
    await this.ensureStorageDirectory();
    
    const filePath = this.getFindingFilePath(finding.finding_id);
    const content = yaml.stringify(finding, {
      indent: 2,
      lineWidth: 120,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });
    
    await fs.writeFile(filePath, content, 'utf-8');
  }
  
  /**
   * Generates a unique finding ID.
   */
  private async generateUniqueFindingId(): Promise<string> {
    const existingFindings = await this.listFindings();
    
    let maxNumber = 0;
    
    if (existingFindings.success) {
      for (const finding of existingFindings.value) {
        const match = finding.finding_id.match(/^FND-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      }
    }
    
    return generateFindingId(maxNumber + 1);
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new FileFindingRegister instance.
 * 
 * @param workspacePath - Path to the workspace root
 * @param config - Optional configuration
 * @returns FileFindingRegister instance
 */
export function createFileFindingRegister(
  workspacePath: string,
  config?: Partial<FindingRegisterConfig>
): FileFindingRegister {
  return new FileFindingRegister(workspacePath, config);
}
