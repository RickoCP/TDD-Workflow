/**
 * Release Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Release_Manager component
 * which provides release lifecycle management from planning through production deployment.
 * 
 * The Release_Manager ensures reliable releases by:
 * - Managing release state machine transitions
 * - Validating readiness checks before deployment
 * - Orchestrating staging and production deployments
 * - Handling rollback scenarios
 * - Recording approval gates
 * 
 * Requirements: R15.1, R15.2, R15.3, R15.4, R15.5, R15.6, R15.7, R15.8, R15.9, R15.10, R15.11
 */

import {
  ActorType,
  Result,
  ok,
  err,
} from './state-controller';

// =============================================================================
// Re-exports from state-controller for convenience
// =============================================================================

export { ActorType } from './state-controller';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default configuration values for release operations.
 * Requirements: R15
 */
export const RELEASE_DEFAULTS = {
  /** Directory name for release storage */
  STORAGE_DIR: '.kiro/sdlc/releases',
  /** Release ID prefix */
  ID_PREFIX: 'REL',
  /** Default monitoring period in minutes */
  DEFAULT_MONITORING_PERIOD_MINUTES: 30,
  /** Default staging verification timeout in minutes */
  DEFAULT_STAGING_TIMEOUT_MINUTES: 60,
  /** Default production deployment timeout in minutes */
  DEFAULT_PRODUCTION_TIMEOUT_MINUTES: 120,
  /** Default observation period before closure in hours */
  DEFAULT_OBSERVATION_PERIOD_HOURS: 24,
} as const;

// =============================================================================
// Type Definitions - Release Status
// =============================================================================

/**
 * Release status following the state machine in the design.
 * Requirements: R15.1
 * 
 * State transitions:
 * NOT_STARTED → PLANNING → READINESS_CHECK → STAGING → AWAITING_APPROVAL → 
 * PRODUCTION → MONITORING → CLOSED
 * 
 * Failure/terminal states:
 * READINESS_FAILED, STAGING_FAILED, PRODUCTION_FAILED, ROLLED_BACK, CANCELLED
 */
export type ReleaseStatus =
  | 'NOT_STARTED'       // Initial state, release not yet planned
  | 'PLANNING'          // Release is being planned
  | 'READINESS_CHECK'   // Running readiness validations
  | 'READINESS_FAILED'  // Readiness check failed
  | 'STAGING'           // Deploying to staging
  | 'STAGING_FAILED'    // Staging deployment or verification failed
  | 'AWAITING_APPROVAL' // Staging verified, waiting for production approval
  | 'PRODUCTION'        // Deploying to production
  | 'PRODUCTION_FAILED' // Production deployment failed
  | 'MONITORING'        // Production deployed, in observation period
  | 'ROLLED_BACK'       // Rolled back after issue
  | 'CLOSED'            // Release complete and closed
  | 'CANCELLED';        // Release cancelled

/**
 * Human-readable descriptions for release statuses.
 */
export const RELEASE_STATUS_DESCRIPTIONS: Record<ReleaseStatus, string> = {
  NOT_STARTED: 'Release has not been started',
  PLANNING: 'Release is being planned and configured',
  READINESS_CHECK: 'Running readiness validations',
  READINESS_FAILED: 'Readiness check failed - issues must be resolved',
  STAGING: 'Deploying to staging environment',
  STAGING_FAILED: 'Staging deployment or verification failed',
  AWAITING_APPROVAL: 'Staging verified, waiting for production approval',
  PRODUCTION: 'Deploying to production environment',
  PRODUCTION_FAILED: 'Production deployment failed',
  MONITORING: 'Production deployed, in observation period',
  ROLLED_BACK: 'Release was rolled back due to issues',
  CLOSED: 'Release completed successfully',
  CANCELLED: 'Release was cancelled',
};

/**
 * Valid state transitions for the release state machine.
 * Requirements: R15.1
 */
export const VALID_RELEASE_TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  NOT_STARTED: ['PLANNING'],
  PLANNING: ['READINESS_CHECK', 'CANCELLED'],
  READINESS_CHECK: ['READINESS_FAILED', 'STAGING', 'CANCELLED'],
  READINESS_FAILED: ['READINESS_CHECK', 'CANCELLED'],
  STAGING: ['STAGING_FAILED', 'AWAITING_APPROVAL', 'CANCELLED'],
  STAGING_FAILED: ['STAGING', 'CANCELLED'],
  AWAITING_APPROVAL: ['PRODUCTION', 'STAGING', 'CANCELLED'],
  PRODUCTION: ['PRODUCTION_FAILED', 'MONITORING'],
  PRODUCTION_FAILED: ['ROLLED_BACK', 'PRODUCTION'],
  MONITORING: ['ROLLED_BACK', 'CLOSED'],
  ROLLED_BACK: ['STAGING', 'CANCELLED'],
  CLOSED: [],  // Terminal state
  CANCELLED: [],  // Terminal state
};

/**
 * Terminal states that cannot transition further.
 */
export const TERMINAL_RELEASE_STATES: ReleaseStatus[] = ['CLOSED', 'CANCELLED'];

/**
 * Failure states that require remediation.
 */
export const FAILURE_RELEASE_STATES: ReleaseStatus[] = [
  'READINESS_FAILED',
  'STAGING_FAILED',
  'PRODUCTION_FAILED',
  'ROLLED_BACK',
];

// =============================================================================
// Type Definitions - Stage Status
// =============================================================================

/**
 * Status of an individual release stage.
 * Requirements: R15.2, R15.4, R15.6
 */
export type StageStatus =
  | 'NOT_STARTED'   // Stage not yet begun
  | 'IN_PROGRESS'   // Stage currently running
  | 'COMPLETED'     // Stage completed successfully
  | 'FAILED'        // Stage failed
  | 'SKIPPED';      // Stage was skipped

/**
 * Readiness check stage details.
 * Requirements: R15.2
 */
export interface ReadinessCheckStage {
  /** Stage status */
  status: StageStatus;
  /** ISO 8601 timestamp when check started */
  started_at: string | null;
  /** ISO 8601 timestamp when check completed */
  completed_at: string | null;
  /** Evidence ID for this stage */
  evidence_id: string | null;
  /** Readiness report ID */
  report_id: string | null;
  /** Number of checks passed */
  checks_passed: number;
  /** Number of checks failed */
  checks_failed: number;
  /** List of blockers preventing readiness */
  blockers: string[];
}

/**
 * Staging deployment stage details.
 * Requirements: R15.4
 */
export interface StagingStage {
  /** Stage status */
  status: StageStatus;
  /** ISO 8601 timestamp when deployment started */
  started_at: string | null;
  /** ISO 8601 timestamp when deployed */
  deployed_at: string | null;
  /** ISO 8601 timestamp when verification completed */
  verified_at: string | null;
  /** ISO 8601 timestamp when completed */
  completed_at: string | null;
  /** Evidence ID for deployment */
  deploy_evidence_id: string | null;
  /** Evidence ID for verification */
  verify_evidence_id: string | null;
  /** Staging environment URL/identifier */
  environment: string | null;
  /** Health check results */
  health_checks_passed: boolean | null;
  /** Smoke test results */
  smoke_tests_passed: boolean | null;
  /** Integration test results */
  integration_tests_passed: boolean | null;
  /** Deployment notes */
  notes: string | null;
}

/**
 * Production deployment stage details.
 * Requirements: R15.5, R15.6
 */
export interface ProductionStage {
  /** Stage status */
  status: StageStatus;
  /** ISO 8601 timestamp when deployment started */
  started_at: string | null;
  /** ISO 8601 timestamp when deployed */
  deployed_at: string | null;
  /** ISO 8601 timestamp when verification completed */
  verified_at: string | null;
  /** ISO 8601 timestamp when completed */
  completed_at: string | null;
  /** Evidence ID for deployment */
  deploy_evidence_id: string | null;
  /** Evidence ID for verification */
  verify_evidence_id: string | null;
  /** Production environment URL/identifier */
  environment: string | null;
  /** Health check results */
  health_checks_passed: boolean | null;
  /** Smoke test results */
  smoke_tests_passed: boolean | null;
  /** Approver ID who approved production deployment */
  approved_by: string | null;
  /** ISO 8601 timestamp when approved */
  approved_at: string | null;
  /** Approval notes */
  approval_notes: string | null;
  /** Monitoring period end time */
  monitoring_ends_at: string | null;
  /** Deployment notes */
  notes: string | null;
}

/**
 * Combined release stages.
 * Requirements: R15.1
 */
export interface ReleaseStages {
  /** Readiness check stage */
  readiness_check: ReadinessCheckStage;
  /** Staging deployment stage */
  staging: StagingStage;
  /** Production deployment stage */
  production: ProductionStage;
}

// =============================================================================
// Type Definitions - Release Artifact
// =============================================================================

/**
 * Release artifact information.
 * Requirements: R15.3
 */
export interface ReleaseArtifact {
  /** Artifact identifier */
  artifact_id: string;
  /** Artifact type (e.g., 'docker-image', 'npm-package', 'binary') */
  type: string;
  /** Version/tag of the artifact */
  version: string;
  /** Git tag for this release */
  git_tag: string | null;
  /** Git commit SHA for this release */
  commit_sha: string;
  /** Artifact location/registry URL */
  location: string | null;
  /** Artifact checksum for verification */
  checksum: string | null;
  /** Checksum algorithm (e.g., 'sha256') */
  checksum_algorithm: string | null;
  /** Build timestamp */
  built_at: string;
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

// =============================================================================
// Type Definitions - Release
// =============================================================================

/**
 * Complete release record.
 * Requirements: R15.1, R15.3
 */
export interface Release {
  /** Unique release identifier (REL-xxx) */
  release_id: string;
  /** Release version (semver or custom scheme) */
  version: string;
  /** Current release status */
  status: ReleaseStatus;
  /** Release stages with their details */
  stages: ReleaseStages;
  /** Whether rollback is available */
  rollback_available: boolean;
  /** Previous version for rollback (if applicable) */
  previous_version: string | null;
  /** Release artifact information */
  artifact: ReleaseArtifact | null;
  /** ISO 8601 timestamp when release was created */
  created_at: string;
  /** ID of actor who created the release */
  created_by: string;
  /** ISO 8601 timestamp when release was closed (if closed) */
  closed_at: string | null;
  /** Release notes/changelog */
  release_notes: string | null;
  /** Known issues documented for this release */
  known_issues: string[];
  /** Configuration used for this release */
  config: ReleaseConfig;
  /** History of status transitions */
  status_history: ReleaseStatusTransition[];
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

/**
 * Release status transition history entry.
 */
export interface ReleaseStatusTransition {
  /** Previous status */
  from_status: ReleaseStatus;
  /** New status */
  to_status: ReleaseStatus;
  /** ISO 8601 timestamp of transition */
  timestamp: string;
  /** Actor who triggered the transition */
  actor_id: string;
  /** Reason for transition */
  reason: string | null;
}

// =============================================================================
// Type Definitions - Release Configuration
// =============================================================================

/**
 * Integration mode for release deployment.
 * Requirements: R07.7
 */
export type IntegrationMode = 'serial' | 'merge_queue' | 'manual';

/**
 * Merge queue provider.
 * Requirements: R07.7
 */
export type MergeQueueProvider = 'github' | 'gitlab' | 'none';

/**
 * Release configuration.
 * Requirements: R15
 */
export interface ReleaseConfig {
  /** Integration mode */
  integration_mode: IntegrationMode;
  /** Merge queue provider (if using merge_queue mode) */
  merge_queue_provider: MergeQueueProvider;
  /** Monitoring period in minutes after production deployment */
  monitoring_period_minutes: number;
  /** Staging verification timeout in minutes */
  staging_timeout_minutes: number;
  /** Production deployment timeout in minutes */
  production_timeout_minutes: number;
  /** Observation period before closure in hours */
  observation_period_hours: number;
  /** Require explicit human approval for production */
  require_human_approval: boolean;
  /** Staging environment identifier */
  staging_environment: string | null;
  /** Production environment identifier */
  production_environment: string | null;
  /** Rollback triggers (error rate thresholds, etc.) */
  rollback_triggers: RollbackTrigger[];
  /** Custom gates that must pass before production */
  custom_gates: string[];
  /** Skip staging (deploy directly to production) - use with caution */
  skip_staging: boolean;
}

/**
 * Rollback trigger configuration.
 * Requirements: R15.7
 */
export interface RollbackTrigger {
  /** Trigger type */
  type: 'error_rate' | 'health_check' | 'latency' | 'manual' | 'custom';
  /** Threshold value (interpretation depends on type) */
  threshold: number | null;
  /** Duration in seconds before trigger activates */
  duration_seconds: number | null;
  /** Whether this trigger is enabled */
  enabled: boolean;
  /** Human-readable description */
  description: string;
}

// =============================================================================
// Type Definitions - Readiness Report
// =============================================================================

/**
 * Task summary for readiness report.
 * Requirements: R15.2
 */
export interface TaskSummary {
  /** Total number of tasks */
  total: number;
  /** Number of tasks in DONE status */
  done: number;
  /** Number of blocked tasks */
  blocked: number;
  /** Number of tasks in progress */
  in_progress: number;
  /** Number of tasks not started */
  not_started: number;
  /** IDs of tasks not yet done */
  incomplete_task_ids: string[];
}

/**
 * Evidence summary for readiness report.
 * Requirements: R15.2
 */
export interface EvidenceSummary {
  /** Total number of required evidence */
  total: number;
  /** Number of valid (not stale) evidence */
  valid: number;
  /** Number of stale evidence */
  stale: number;
  /** Number of missing evidence */
  missing: number;
  /** IDs of stale evidence */
  stale_evidence_ids: string[];
  /** IDs of missing evidence */
  missing_evidence_ids: string[];
}

/**
 * Findings summary for readiness report.
 * Requirements: R15.2
 */
export interface FindingsSummary {
  /** Number of critical findings */
  critical: number;
  /** Number of high severity findings */
  high: number;
  /** Number of medium severity findings */
  medium: number;
  /** Number of low severity findings */
  low: number;
  /** Total open findings (all severities) */
  open: number;
  /** Finding IDs blocking release */
  blocking_finding_ids: string[];
}

/**
 * Gates summary for readiness report.
 * Requirements: R15.2
 */
export interface GatesSummary {
  /** Gates that passed */
  passed: string[];
  /** Gates that failed */
  failed: string[];
  /** Gates that are pending */
  pending: string[];
  /** Gates that were skipped */
  skipped: string[];
}

/**
 * Documentation status for readiness report.
 * Requirements: R15.2
 */
export interface DocumentationStatus {
  /** Whether documentation is complete */
  complete: boolean;
  /** Missing documentation items */
  missing_items: string[];
  /** Whether release notes are drafted */
  release_notes_drafted: boolean;
  /** Whether known issues are documented */
  known_issues_documented: boolean;
}

/**
 * Complete readiness report.
 * Requirements: R15.2
 */
export interface ReadinessReport {
  /** Report ID */
  report_id: string;
  /** Release ID this report is for */
  release_id: string;
  /** Whether release is ready */
  ready: boolean;
  /** ISO 8601 timestamp when report was generated */
  generated_at: string;
  /** Task summary */
  tasks: TaskSummary;
  /** Evidence summary */
  evidence: EvidenceSummary;
  /** Findings summary */
  findings: FindingsSummary;
  /** Gates summary */
  gates: GatesSummary;
  /** Documentation status */
  documentation: DocumentationStatus;
  /** List of blockers preventing readiness */
  blockers: string[];
  /** Recommendations for addressing issues */
  recommendations: string[];
}

// =============================================================================
// Type Definitions - Deployment
// =============================================================================

/**
 * Deployment status.
 * Requirements: R15.4, R15.6
 */
export type DeploymentStatus =
  | 'PENDING'      // Deployment not yet started
  | 'IN_PROGRESS'  // Deployment in progress
  | 'COMPLETED'    // Deployment completed successfully
  | 'FAILED'       // Deployment failed
  | 'ROLLED_BACK'; // Deployment was rolled back

/**
 * Deployment result.
 * Requirements: R15.4, R15.6
 */
export interface DeploymentResult {
  /** Whether deployment was successful */
  success: boolean;
  /** Deployment status */
  status: DeploymentStatus;
  /** Environment deployed to */
  environment: string;
  /** ISO 8601 timestamp when deployment started */
  started_at: string;
  /** ISO 8601 timestamp when deployment completed */
  completed_at: string | null;
  /** Duration in milliseconds */
  duration_ms: number | null;
  /** Deployed artifact info */
  artifact: ReleaseArtifact | null;
  /** Health check results */
  health_check_passed: boolean | null;
  /** Smoke test results */
  smoke_test_passed: boolean | null;
  /** Error message if failed */
  error_message: string | null;
  /** Evidence ID for this deployment */
  evidence_id: string | null;
  /** Deployment logs path */
  logs_path: string | null;
}

// =============================================================================
// Type Definitions - Verification
// =============================================================================

/**
 * Verification type.
 * Requirements: R15.4, R15.6
 */
export type VerificationType =
  | 'smoke_test'         // Basic smoke tests
  | 'health_check'       // Health check endpoints
  | 'integration_test'   // Integration tests
  | 'regression_test'    // Regression test suite
  | 'performance_test'   // Performance benchmarks
  | 'security_scan'      // Security validation
  | 'manual';            // Manual verification

/**
 * Individual verification check result.
 */
export interface VerificationCheck {
  /** Check type */
  type: VerificationType;
  /** Whether check passed */
  passed: boolean;
  /** Check duration in milliseconds */
  duration_ms: number;
  /** Details about the check */
  details: string | null;
  /** Evidence ID for this check */
  evidence_id: string | null;
}

/**
 * Complete verification result.
 * Requirements: R15.4
 */
export interface VerificationResult {
  /** Whether verification passed overall */
  passed: boolean;
  /** Environment verified */
  environment: string;
  /** ISO 8601 timestamp when verification started */
  started_at: string;
  /** ISO 8601 timestamp when verification completed */
  completed_at: string;
  /** Total duration in milliseconds */
  duration_ms: number;
  /** Individual check results */
  checks: VerificationCheck[];
  /** Checks that passed */
  passed_checks: VerificationType[];
  /** Checks that failed */
  failed_checks: VerificationType[];
  /** Error message if verification failed */
  error_message: string | null;
  /** Combined evidence ID */
  evidence_id: string | null;
}

// =============================================================================
// Type Definitions - Approval
// =============================================================================

/**
 * Approval status.
 * Requirements: R15.5
 */
export type ApprovalStatus =
  | 'PENDING'    // Approval requested, waiting for response
  | 'APPROVED'   // Approved for production
  | 'DENIED'     // Denied, needs more work
  | 'EXPIRED';   // Approval request expired

/**
 * Approval request.
 * Requirements: R15.5
 */
export interface ApprovalRequest {
  /** Approval request ID */
  request_id: string;
  /** Release ID this approval is for */
  release_id: string;
  /** Current approval status */
  status: ApprovalStatus;
  /** ISO 8601 timestamp when request was created */
  requested_at: string;
  /** ID of actor who requested approval */
  requested_by: string;
  /** ISO 8601 timestamp when approval was processed (if processed) */
  processed_at: string | null;
  /** ID of actor who processed the approval */
  processed_by: string | null;
  /** Approval notes (from approver) */
  notes: string | null;
  /** Commit SHA that was approved */
  commit_sha: string;
  /** Link to staging verification evidence */
  staging_evidence_id: string | null;
  /** ISO 8601 timestamp when request expires */
  expires_at: string | null;
  /** Required capabilities for approval */
  required_capability: string;
}

// =============================================================================
// Type Definitions - Rollback
// =============================================================================

/**
 * Rollback status.
 * Requirements: R15.7, R15.8
 */
export type RollbackStatus =
  | 'NOT_NEEDED'   // No rollback necessary
  | 'IN_PROGRESS'  // Rollback in progress
  | 'COMPLETED'    // Rollback completed
  | 'FAILED';      // Rollback failed

/**
 * Rollback result.
 * Requirements: R15.8
 */
export interface RollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Rollback status */
  status: RollbackStatus;
  /** ISO 8601 timestamp when rollback started */
  started_at: string;
  /** ISO 8601 timestamp when rollback completed */
  completed_at: string | null;
  /** Duration in milliseconds */
  duration_ms: number | null;
  /** Version that was active before rollback */
  from_version: string;
  /** Version rolled back to */
  to_version: string;
  /** Reason for rollback */
  reason: string;
  /** Trigger that caused rollback (if automatic) */
  trigger: RollbackTrigger | null;
  /** Health verified after rollback */
  health_verified: boolean;
  /** Error message if failed */
  error_message: string | null;
  /** Incident ID if incident was created */
  incident_id: string | null;
  /** Evidence ID for this rollback */
  evidence_id: string | null;
}

// =============================================================================
// Type Definitions - Release Input
// =============================================================================

/**
 * Input for planning a new release.
 */
export interface PlanReleaseInput {
  /** Release version */
  version: string;
  /** Release configuration (optional, will use defaults) */
  config?: Partial<ReleaseConfig>;
  /** Release notes */
  release_notes?: string;
  /** Known issues */
  known_issues?: string[];
  /** Previous version for rollback (optional) */
  previous_version?: string;
  /** Creator ID */
  created_by: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Release error codes following the design specification.
 * Error codes in range 3300-3399 for RELEASE_ERROR category.
 * Requirements: R15
 */
export enum ReleaseErrorCode {
  /** Release not found */
  RELEASE_NOT_FOUND = 3301,
  /** Release corrupted or invalid format */
  RELEASE_CORRUPTED = 3302,
  /** Invalid release status transition */
  INVALID_STATUS_TRANSITION = 3303,
  /** Readiness check failed */
  READINESS_CHECK_FAILED = 3304,
  /** Staging deployment failed */
  STAGING_DEPLOY_FAILED = 3305,
  /** Staging verification failed */
  STAGING_VERIFY_FAILED = 3306,
  /** Production approval required */
  APPROVAL_REQUIRED = 3307,
  /** Production approval denied */
  APPROVAL_DENIED = 3308,
  /** Production approval expired */
  APPROVAL_EXPIRED = 3309,
  /** Production deployment failed */
  PRODUCTION_DEPLOY_FAILED = 3310,
  /** Rollback failed */
  ROLLBACK_FAILED = 3311,
  /** Release already exists with version */
  DUPLICATE_VERSION = 3312,
  /** Release already closed */
  ALREADY_CLOSED = 3313,
  /** Release cancelled */
  ALREADY_CANCELLED = 3314,
  /** Missing required fields */
  MISSING_REQUIRED_FIELDS = 3315,
  /** Invalid version format */
  INVALID_VERSION_FORMAT = 3316,
  /** Artifact not found */
  ARTIFACT_NOT_FOUND = 3317,
  /** Environment not configured */
  ENVIRONMENT_NOT_CONFIGURED = 3318,
  /** Health check failed */
  HEALTH_CHECK_FAILED = 3319,
  /** Same version already deployed */
  DUPLICATE_DEPLOYMENT = 3320,
  /** Previous stage not completed */
  PREREQUISITE_NOT_MET = 3321,
  /** Write release failed */
  WRITE_FAILED = 3322,
  /** Delete release failed */
  DELETE_FAILED = 3323,
  /** Invalid configuration */
  INVALID_CONFIG = 3324,
  /** Monitoring period not complete */
  MONITORING_INCOMPLETE = 3325,
  /** Cannot rollback - no previous version */
  NO_ROLLBACK_TARGET = 3326,
}

/**
 * Release error structure following the design specification.
 */
export interface ReleaseError {
  /** Error code from ReleaseErrorCode enum */
  code: ReleaseErrorCode;
  /** Error category */
  category: 'RELEASE_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    release_id?: string;
    version?: string;
    from_status?: ReleaseStatus;
    to_status?: ReleaseStatus;
    environment?: string;
    details?: string;
    [key: string]: unknown;
  };
  /** Whether the operation can be retried */
  recoverable: boolean;
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** Timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a ReleaseError with the given code and details.
 */
export function createReleaseError(
  code: ReleaseErrorCode,
  message: string,
  context?: ReleaseError['context'],
  recoverable: boolean = false,
  suggested_action?: string
): ReleaseError {
  return {
    code,
    category: 'RELEASE_ERROR',
    message,
    context,
    recoverable,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "release not found" error.
 */
export function releaseNotFoundError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.RELEASE_NOT_FOUND,
    `Release ${releaseId} not found`,
    { release_id: releaseId },
    false,
    'Verify the release ID is correct or list available releases'
  );
}

/**
 * Creates a "release corrupted" error.
 */
export function releaseCorruptedError(
  releaseId: string,
  details?: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.RELEASE_CORRUPTED,
    `Release ${releaseId} is corrupted: ${details || 'Invalid format'}`,
    { release_id: releaseId, details },
    false,
    'Delete the corrupted release and create a new one'
  );
}

/**
 * Creates an "invalid status transition" error.
 * Requirements: R15.1
 */
export function invalidStatusTransitionError(
  releaseId: string,
  fromStatus: ReleaseStatus,
  toStatus: ReleaseStatus
): ReleaseError {
  const validTransitions = VALID_RELEASE_TRANSITIONS[fromStatus];
  return createReleaseError(
    ReleaseErrorCode.INVALID_STATUS_TRANSITION,
    `Invalid release status transition: ${fromStatus} → ${toStatus}`,
    { 
      release_id: releaseId, 
      from_status: fromStatus, 
      to_status: toStatus,
      valid_transitions: validTransitions,
    },
    false,
    `Valid transitions from ${fromStatus}: ${validTransitions.join(', ') || 'none (terminal state)'}`
  );
}

/**
 * Creates a "readiness check failed" error.
 * Requirements: R15.2
 */
export function readinessCheckFailedError(
  releaseId: string,
  blockers: string[]
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.READINESS_CHECK_FAILED,
    `Readiness check failed for release ${releaseId}: ${blockers.length} blocker(s)`,
    { release_id: releaseId, blockers, details: blockers.join('; ') },
    true,
    'Address the blockers and re-run readiness check'
  );
}

/**
 * Creates a "staging deployment failed" error.
 * Requirements: R15.4
 */
export function stagingDeployFailedError(
  releaseId: string,
  reason: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.STAGING_DEPLOY_FAILED,
    `Staging deployment failed for release ${releaseId}: ${reason}`,
    { release_id: releaseId, environment: 'staging', details: reason },
    true,
    'Check deployment logs and resolve the issue, then retry'
  );
}

/**
 * Creates a "staging verification failed" error.
 * Requirements: R15.4
 */
export function stagingVerifyFailedError(
  releaseId: string,
  failedChecks: string[]
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.STAGING_VERIFY_FAILED,
    `Staging verification failed for release ${releaseId}: ${failedChecks.join(', ')}`,
    { release_id: releaseId, environment: 'staging', failed_checks: failedChecks },
    true,
    'Fix the failing checks and re-verify staging'
  );
}

/**
 * Creates an "approval required" error.
 * Requirements: R15.5
 */
export function approvalRequiredError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.APPROVAL_REQUIRED,
    `Production approval required for release ${releaseId}`,
    { release_id: releaseId },
    false,
    'Request production approval from an authorized approver'
  );
}

/**
 * Creates an "approval denied" error.
 * Requirements: R15.5
 */
export function approvalDeniedError(
  releaseId: string,
  reason?: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.APPROVAL_DENIED,
    `Production approval denied for release ${releaseId}${reason ? `: ${reason}` : ''}`,
    { release_id: releaseId, details: reason },
    true,
    'Address the feedback and request approval again'
  );
}

/**
 * Creates an "approval expired" error.
 */
export function approvalExpiredError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.APPROVAL_EXPIRED,
    `Production approval expired for release ${releaseId}`,
    { release_id: releaseId },
    true,
    'Request a new production approval'
  );
}

/**
 * Creates a "production deployment failed" error.
 * Requirements: R15.6
 */
export function productionDeployFailedError(
  releaseId: string,
  reason: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.PRODUCTION_DEPLOY_FAILED,
    `Production deployment failed for release ${releaseId}: ${reason}`,
    { release_id: releaseId, environment: 'production', details: reason },
    true,
    'Consider rollback or fix the issue and retry'
  );
}

/**
 * Creates a "rollback failed" error.
 * Requirements: R15.8
 */
export function rollbackFailedError(
  releaseId: string,
  reason: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.ROLLBACK_FAILED,
    `Rollback failed for release ${releaseId}: ${reason}`,
    { release_id: releaseId, details: reason },
    true,
    'Manual intervention may be required to restore service'
  );
}

/**
 * Creates a "duplicate version" error.
 * Requirements: R15.11
 */
export function duplicateVersionError(version: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.DUPLICATE_VERSION,
    `Release with version ${version} already exists`,
    { version },
    false,
    'Use a different version number or update the existing release'
  );
}

/**
 * Creates an "already closed" error.
 * Requirements: R15.10
 */
export function alreadyClosedError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.ALREADY_CLOSED,
    `Release ${releaseId} is already closed`,
    { release_id: releaseId },
    false,
    'Create a new release if additional changes are needed'
  );
}

/**
 * Creates an "already cancelled" error.
 */
export function alreadyCancelledError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.ALREADY_CANCELLED,
    `Release ${releaseId} is already cancelled`,
    { release_id: releaseId },
    false,
    'Create a new release if the work should continue'
  );
}

/**
 * Creates a "missing required fields" error.
 */
export function missingRequiredFieldsError(fields: string[]): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.MISSING_REQUIRED_FIELDS,
    `Missing required fields: ${fields.join(', ')}`,
    { missing_fields: fields },
    false,
    'Provide all required fields when creating a release'
  );
}

/**
 * Creates a "prerequisite not met" error.
 */
export function prerequisiteNotMetError(
  releaseId: string,
  prerequisite: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.PREREQUISITE_NOT_MET,
    `Prerequisite not met for release ${releaseId}: ${prerequisite}`,
    { release_id: releaseId, details: prerequisite },
    true,
    `Complete the prerequisite: ${prerequisite}`
  );
}

/**
 * Creates a "write failed" error.
 */
export function writeReleaseFailedError(
  releaseId: string,
  details?: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.WRITE_FAILED,
    `Failed to write release ${releaseId}: ${details || 'Unknown error'}`,
    { release_id: releaseId, details },
    true,
    'Check disk space and permissions, then retry'
  );
}

/**
 * Creates a "no rollback target" error.
 * Requirements: R15.8
 */
export function noRollbackTargetError(releaseId: string): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.NO_ROLLBACK_TARGET,
    `Cannot rollback release ${releaseId}: no previous version available`,
    { release_id: releaseId },
    false,
    'Manual intervention required - no automatic rollback target'
  );
}

/**
 * Creates a "duplicate deployment" error.
 * Requirements: R15.11
 */
export function duplicateDeploymentError(
  version: string,
  environment: string
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.DUPLICATE_DEPLOYMENT,
    `Version ${version} already deployed to ${environment}`,
    { version, environment },
    false,
    'Use a different version or provide explicit override justification'
  );
}

/**
 * Creates a "monitoring incomplete" error.
 * Requirements: R15.10
 */
export function monitoringIncompleteError(
  releaseId: string,
  remainingMinutes: number
): ReleaseError {
  return createReleaseError(
    ReleaseErrorCode.MONITORING_INCOMPLETE,
    `Cannot close release ${releaseId}: ${remainingMinutes} minutes remaining in monitoring period`,
    { release_id: releaseId, remaining_minutes: remainingMinutes },
    false,
    `Wait ${remainingMinutes} more minutes or override with justification`
  );
}

// =============================================================================
// Custom Error Classes
// =============================================================================

/**
 * Custom error class for release not found.
 */
export class ReleaseNotFoundError extends Error {
  public readonly code = ReleaseErrorCode.RELEASE_NOT_FOUND;
  public readonly releaseId: string;

  constructor(releaseId: string) {
    super(`Release ${releaseId} not found`);
    this.name = 'ReleaseNotFoundError';
    this.releaseId = releaseId;
  }

  toReleaseError(): ReleaseError {
    return releaseNotFoundError(this.releaseId);
  }
}

/**
 * Custom error class for invalid status transition.
 */
export class InvalidReleaseTransitionError extends Error {
  public readonly code = ReleaseErrorCode.INVALID_STATUS_TRANSITION;
  public readonly releaseId: string;
  public readonly fromStatus: ReleaseStatus;
  public readonly toStatus: ReleaseStatus;

  constructor(releaseId: string, fromStatus: ReleaseStatus, toStatus: ReleaseStatus) {
    super(`Invalid release status transition: ${fromStatus} → ${toStatus}`);
    this.name = 'InvalidReleaseTransitionError';
    this.releaseId = releaseId;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }

  toReleaseError(): ReleaseError {
    return invalidStatusTransitionError(this.releaseId, this.fromStatus, this.toStatus);
  }
}

/**
 * Custom error class for readiness check failure.
 */
export class ReadinessCheckFailedError extends Error {
  public readonly code = ReleaseErrorCode.READINESS_CHECK_FAILED;
  public readonly releaseId: string;
  public readonly blockers: string[];

  constructor(releaseId: string, blockers: string[]) {
    super(`Readiness check failed: ${blockers.length} blocker(s)`);
    this.name = 'ReadinessCheckFailedError';
    this.releaseId = releaseId;
    this.blockers = blockers;
  }

  toReleaseError(): ReleaseError {
    return readinessCheckFailedError(this.releaseId, this.blockers);
  }
}

/**
 * Custom error class for approval required.
 */
export class ApprovalRequiredError extends Error {
  public readonly code = ReleaseErrorCode.APPROVAL_REQUIRED;
  public readonly releaseId: string;

  constructor(releaseId: string) {
    super(`Production approval required for release ${releaseId}`);
    this.name = 'ApprovalRequiredError';
    this.releaseId = releaseId;
  }

  toReleaseError(): ReleaseError {
    return approvalRequiredError(this.releaseId);
  }
}

// =============================================================================
// Result Types
// =============================================================================

/**
 * Result type for release planning.
 */
export type PlanReleaseResult = Result<Release, ReleaseError>;

/**
 * Result type for readiness check.
 */
export type CheckReadinessResult = Result<ReadinessReport, ReleaseError>;

/**
 * Result type for deployment operations.
 */
export type DeployResult = Result<DeploymentResult, ReleaseError>;

/**
 * Result type for verification operations.
 */
export type VerifyResult = Result<VerificationResult, ReleaseError>;

/**
 * Result type for approval operations.
 */
export type ApprovalRequestResult = Result<ApprovalRequest, ReleaseError>;

/**
 * Result type for recording approval.
 */
export type RecordApprovalResult = Result<void, ReleaseError>;

/**
 * Result type for rollback operations.
 */
export type RollbackOperationResult = Result<RollbackResult, ReleaseError>;

/**
 * Result type for closing release.
 */
export type CloseReleaseResult = Result<ClosureResult, ReleaseError>;

/**
 * Result type for checking closure status.
 */
export type GetClosureStatusResult = Result<ClosureStatus, ReleaseError>;

// =============================================================================
// Type Definitions - Closure
// =============================================================================

/**
 * Status indicating whether a release can be closed.
 * Requirements: R15.10
 */
export interface ClosureStatus {
  /** Whether the release can be closed */
  can_close: boolean;
  /** The release's current status */
  release_status: ReleaseStatus;
  /** Whether the monitoring period has elapsed */
  monitoring_complete: boolean;
  /** ISO 8601 timestamp when monitoring ends (if in monitoring) */
  monitoring_ends_at: string | null;
  /** Minutes remaining in monitoring period (0 if complete) */
  remaining_minutes: number;
  /** Reasons why closure is blocked (if any) */
  blockers: string[];
  /** Whether early closure is allowed (requires justification) */
  early_closure_allowed: boolean;
}

/**
 * Input for closing a release with optional early closure.
 * Requirements: R15.10
 */
export interface CloseReleaseInput {
  /** Reason for closure (optional for normal closure, required for early closure) */
  reason?: string;
  /** ID of the person/system closing the release */
  closed_by: string;
  /** Force early closure before monitoring completes (requires reason) */
  force_early_closure?: boolean;
}

/**
 * Final metrics recorded when a release is closed.
 * Requirements: R15.10
 */
export interface ClosureMetrics {
  /** Total duration in milliseconds from planning to close */
  total_duration_ms: number;
  /** Duration from production deployment to close in milliseconds */
  production_to_close_ms: number;
  /** Monitoring duration in milliseconds */
  monitoring_duration_ms: number;
  /** Number of tasks in the release */
  task_count: number;
  /** Number of rollbacks during this release */
  rollback_count: number;
  /** Whether any issues were detected during monitoring */
  issues_during_monitoring: boolean;
  /** Time spent in each stage */
  stage_durations: {
    planning_ms: number | null;
    readiness_check_ms: number | null;
    staging_ms: number | null;
    approval_ms: number | null;
    production_ms: number | null;
    monitoring_ms: number | null;
  };
}

/**
 * Result from closing a release.
 * Requirements: R15.10
 */
export interface ClosureResult {
  /** Release ID that was closed */
  release_id: string;
  /** Version that was closed */
  version: string;
  /** ISO 8601 timestamp when release was closed */
  closed_at: string;
  /** ID of the actor who closed the release */
  closed_by: string;
  /** Reason for closure */
  closure_reason: string | null;
  /** Whether this was an early closure */
  early_closure: boolean;
  /** Final metrics for the release */
  metrics: ClosureMetrics;
  /** Summary of the release lifecycle */
  summary: string;
}

/**
 * Result type for getting a release.
 */
export type GetReleaseResult = Result<Release, ReleaseError>;

/**
 * Result type for listing releases.
 */
export type ListReleasesResult = Result<Release[], ReleaseError>;

/**
 * Result type for cancelling a release.
 */
export type CancelReleaseResult = Result<Release, ReleaseError>;

// =============================================================================
// ReleaseManager Interface
// =============================================================================

/**
 * ReleaseManager interface for release lifecycle management.
 * 
 * This component ensures:
 * - Release state machine transitions are valid
 * - Readiness checks validate all prerequisites
 * - Staging and production deployments are orchestrated
 * - Approval gates are enforced
 * - Rollback procedures are available
 * 
 * Requirements: R15.1, R15.2, R15.3, R15.4, R15.5, R15.6, R15.7, R15.8, R15.9, R15.10, R15.11
 */
export interface ReleaseManager {
  // =========================================================================
  // Planning Operations
  // =========================================================================

  /**
   * Plans a new release.
   * 
   * Requirements: R15.1
   * 
   * @param input - Release planning input
   * @returns Result with Release on success, or ReleaseError on failure
   * 
   * Behavior:
   * - Creates a new release with NOT_STARTED status
   * - Generates unique release ID
   * - Initializes all stages to NOT_STARTED
   * - Validates version format
   * - Checks for duplicate version
   */
  planRelease(input: PlanReleaseInput): Promise<PlanReleaseResult>;

  // =========================================================================
  // Readiness Operations
  // =========================================================================

  /**
   * Runs readiness check for a release.
   * 
   * Requirements: R15.2
   * 
   * @param releaseId - The release ID to check
   * @returns Result with ReadinessReport on success, or ReleaseError on failure
   * 
   * Checks performed:
   * - All committed tasks are DONE
   * - All required evidence is valid (not stale)
   * - No unresolved CRITICAL/HIGH findings
   * - Documentation is complete
   * - Known issues are documented
   * - Release notes are drafted
   */
  checkReadiness(releaseId: string): Promise<CheckReadinessResult>;

  // =========================================================================
  // Staging Operations
  // =========================================================================

  /**
   * Deploys to staging environment.
   * 
   * Requirements: R15.4
   * 
   * @param releaseId - The release ID to deploy
   * @returns Result with DeploymentResult on success, or ReleaseError on failure
   * 
   * Behavior:
   * - Deploys release artifact to staging
   * - Records deployment evidence
   * - Updates release status to STAGING
   * 
   * Prerequisites:
   * - Readiness check must have passed
   * - Release must be in READINESS_CHECK or STAGING_FAILED status
   */
  deployToStaging(releaseId: string): Promise<DeployResult>;

  /**
   * Verifies staging deployment.
   * 
   * Requirements: R15.4
   * 
   * @param releaseId - The release ID to verify
   * @returns Result with VerificationResult on success, or ReleaseError on failure
   * 
   * Checks performed:
   * - Smoke tests pass
   * - Health checks pass
   * - Integration tests pass (if configured)
   * 
   * On success:
   * - Updates release status to AWAITING_APPROVAL
   * - Records verification evidence
   */
  verifyStaging(releaseId: string): Promise<VerifyResult>;

  // =========================================================================
  // Approval Operations
  // =========================================================================

  /**
   * Requests production approval.
   * 
   * Requirements: R15.5
   * 
   * @param releaseId - The release ID to request approval for
   * @returns Result with ApprovalRequest on success, or ReleaseError on failure
   * 
   * Prerequisites:
   * - Staging verification must have passed
   * - Release must be in AWAITING_APPROVAL status
   */
  requestProductionApproval(releaseId: string): Promise<ApprovalRequestResult>;

  /**
   * Records production approval decision.
   * 
   * Requirements: R15.5
   * 
   * @param releaseId - The release ID
   * @param approverId - ID of the approver
   * @param approved - Whether the release was approved
   * @param notes - Optional approval notes
   * @returns Result with void on success, or ReleaseError on failure
   * 
   * Behavior:
   * - If approved: enables production deployment
   * - If denied: returns release to STAGING status for fixes
   * - Records approval decision with timestamp
   * 
   * Requirements:
   * - Approver must have APPROVE_GATE capability
   * - Must be explicit human approval (not AI agent)
   */
  recordApproval(
    releaseId: string,
    approverId: string,
    approved: boolean,
    notes?: string
  ): Promise<RecordApprovalResult>;

  // =========================================================================
  // Production Operations
  // =========================================================================

  /**
   * Deploys to production environment.
   * 
   * Requirements: R15.6
   * 
   * @param releaseId - The release ID to deploy
   * @returns Result with DeploymentResult on success, or ReleaseError on failure
   * 
   * Behavior:
   * - Deploys same artifact as staging (no rebuild)
   * - Runs smoke tests
   * - Verifies health checks
   * - Enters monitoring period
   * 
   * Prerequisites:
   * - Production approval must be granted
   * - Release must be in AWAITING_APPROVAL status with approval
   */
  deployToProduction(releaseId: string): Promise<DeployResult>;

  // =========================================================================
  // Rollback Operations
  // =========================================================================

  /**
   * Initiates rollback.
   * 
   * Requirements: R15.7, R15.8
   * 
   * @param releaseId - The release ID to rollback
   * @param reason - Reason for rollback
   * @returns Result with RollbackResult on success, or ReleaseError on failure
   * 
   * Behavior:
   * - Records rollback decision and reason
   * - Restores previous version
   * - Verifies previous version health
   * - Creates incident record if applicable
   * 
   * Note:
   * - Rollback does not automatically restore database
   * - Migration rollback plan should be documented separately
   */
  rollback(releaseId: string, reason: string): Promise<RollbackOperationResult>;

  // =========================================================================
  // Closure Operations
  // =========================================================================

  /**
   * Closes release after successful observation period.
   * 
   * Requirements: R15.10
   * 
   * @param releaseId - The release ID to close
   * @param input - Closure input with optional early closure settings
   * @returns Result with ClosureResult on success, or ReleaseError on failure
   * 
   * Prerequisites:
   * - Release must be in MONITORING status
   * - Observation period must be complete (or force_early_closure with reason)
   * - No critical issues during monitoring
   * 
   * Behavior:
   * - Records final metrics (duration, task count, etc.)
   * - Archives release artifacts (marks as archived)
   * - Updates status to CLOSED
   * - Records who closed it and why
   * - Generates closure summary/report
   */
  closeRelease(releaseId: string, input: CloseReleaseInput): Promise<CloseReleaseResult>;

  /**
   * Gets closure status for a release.
   * 
   * Requirements: R15.10
   * 
   * @param releaseId - The release ID to check
   * @returns Result with ClosureStatus on success, or ReleaseError on failure
   * 
   * Checks:
   * - Release is in MONITORING status
   * - Monitoring period has elapsed (monitoring_ends_at has passed)
   * - Returns time remaining if monitoring not complete
   * - Indicates if early closure is available
   */
  getClosureStatus(releaseId: string): Promise<GetClosureStatusResult>;

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets a release by ID.
   * 
   * @param releaseId - The release ID to retrieve
   * @returns Result with Release on success, or ReleaseError on failure
   */
  getRelease(releaseId: string): Promise<GetReleaseResult>;

  /**
   * Gets a release by version.
   * 
   * @param version - The version to look up
   * @returns Result with Release on success (null if not found), or ReleaseError on failure
   */
  getReleaseByVersion(version: string): Promise<Result<Release | null, ReleaseError>>;

  /**
   * Lists all releases.
   * 
   * @param filter - Optional filter criteria
   * @returns Result with Release array on success, or ReleaseError on failure
   */
  listReleases(filter?: ReleaseFilter): Promise<ListReleasesResult>;

  /**
   * Gets the current active release (if any).
   * 
   * @returns Result with Release on success (null if none active), or ReleaseError on failure
   */
  getActiveRelease(): Promise<Result<Release | null, ReleaseError>>;

  // =========================================================================
  // Cancellation Operations
  // =========================================================================

  /**
   * Cancels a release.
   * 
   * @param releaseId - The release ID to cancel
   * @param reason - Reason for cancellation
   * @returns Result with updated Release on success, or ReleaseError on failure
   * 
   * Note:
   * - Can only cancel releases that are not in terminal states
   * - Cannot cancel a release that has been deployed to production
   */
  cancelRelease(releaseId: string, reason: string): Promise<CancelReleaseResult>;
}

// =============================================================================
// Filter Types
// =============================================================================

/**
 * Filter criteria for listing releases.
 */
export interface ReleaseFilter {
  /** Filter by status */
  status?: ReleaseStatus | ReleaseStatus[];
  /** Filter by version prefix/pattern */
  version_prefix?: string;
  /** Filter by created after date */
  created_after?: string;
  /** Filter by created before date */
  created_before?: string;
  /** Filter by creator */
  created_by?: string;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort order */
  sort?: 'created_at_asc' | 'created_at_desc' | 'version_asc' | 'version_desc';
}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for ReleaseManager implementation.
 */
export interface ReleaseManagerConfig {
  /** Path to release storage directory */
  storagePath?: string;
  /** Default release configuration */
  defaultConfig?: Partial<ReleaseConfig>;
  /** State controller for state management */
  stateControllerPath?: string;
  /** Evidence manager for evidence operations */
  evidenceManagerPath?: string;
  /** Finding register for findings queries */
  findingRegisterPath?: string;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates default release configuration.
 * Requirements: R15
 */
export function createDefaultReleaseConfig(): ReleaseConfig {
  return {
    integration_mode: 'serial',
    merge_queue_provider: 'none',
    monitoring_period_minutes: RELEASE_DEFAULTS.DEFAULT_MONITORING_PERIOD_MINUTES,
    staging_timeout_minutes: RELEASE_DEFAULTS.DEFAULT_STAGING_TIMEOUT_MINUTES,
    production_timeout_minutes: RELEASE_DEFAULTS.DEFAULT_PRODUCTION_TIMEOUT_MINUTES,
    observation_period_hours: RELEASE_DEFAULTS.DEFAULT_OBSERVATION_PERIOD_HOURS,
    require_human_approval: true,
    staging_environment: null,
    production_environment: null,
    rollback_triggers: [
      {
        type: 'health_check',
        threshold: null,
        duration_seconds: 60,
        enabled: true,
        description: 'Rollback if health check fails for 60 seconds',
      },
      {
        type: 'error_rate',
        threshold: 5, // 5% error rate
        duration_seconds: 300,
        enabled: true,
        description: 'Rollback if error rate exceeds 5% for 5 minutes',
      },
      {
        type: 'manual',
        threshold: null,
        duration_seconds: null,
        enabled: true,
        description: 'Manual rollback trigger',
      },
    ],
    custom_gates: [],
    skip_staging: false,
  };
}

/**
 * Creates default release stages.
 * Requirements: R15.1
 */
export function createDefaultReleaseStages(): ReleaseStages {
  return {
    readiness_check: {
      status: 'NOT_STARTED',
      started_at: null,
      completed_at: null,
      evidence_id: null,
      report_id: null,
      checks_passed: 0,
      checks_failed: 0,
      blockers: [],
    },
    staging: {
      status: 'NOT_STARTED',
      started_at: null,
      deployed_at: null,
      verified_at: null,
      completed_at: null,
      deploy_evidence_id: null,
      verify_evidence_id: null,
      environment: null,
      health_checks_passed: null,
      smoke_tests_passed: null,
      integration_tests_passed: null,
      notes: null,
    },
    production: {
      status: 'NOT_STARTED',
      started_at: null,
      deployed_at: null,
      verified_at: null,
      completed_at: null,
      deploy_evidence_id: null,
      verify_evidence_id: null,
      environment: null,
      health_checks_passed: null,
      smoke_tests_passed: null,
      approved_by: null,
      approved_at: null,
      approval_notes: null,
      monitoring_ends_at: null,
      notes: null,
    },
  };
}

/**
 * Validates if a release status transition is valid.
 * Requirements: R15.1
 * 
 * @param fromStatus - Current status
 * @param toStatus - Target status
 * @returns Whether the transition is valid
 */
export function isValidReleaseTransition(
  fromStatus: ReleaseStatus,
  toStatus: ReleaseStatus
): boolean {
  const validTransitions = VALID_RELEASE_TRANSITIONS[fromStatus];
  return validTransitions.includes(toStatus);
}

/**
 * Checks if a release status is terminal (cannot transition further).
 * 
 * @param status - Status to check
 * @returns Whether the status is terminal
 */
export function isTerminalReleaseStatus(status: ReleaseStatus): boolean {
  return TERMINAL_RELEASE_STATES.includes(status);
}

/**
 * Checks if a release status is a failure state.
 * 
 * @param status - Status to check
 * @returns Whether the status is a failure state
 */
export function isFailureReleaseStatus(status: ReleaseStatus): boolean {
  return FAILURE_RELEASE_STATES.includes(status);
}

/**
 * Generates a unique release ID.
 * 
 * @param timestamp - Optional timestamp for ID generation
 * @returns Generated release ID
 */
export function generateReleaseId(timestamp?: Date): string {
  const now = timestamp || new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${RELEASE_DEFAULTS.ID_PREFIX}-${dateStr}-${timeStr}-${random}`;
}

/**
 * Generates a unique readiness report ID.
 * 
 * @param releaseId - The release ID this report is for
 * @returns Generated report ID
 */
export function generateReadinessReportId(releaseId: string): string {
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15);
  return `RR-${releaseId}-${timestamp}`;
}

/**
 * Generates a unique approval request ID.
 * 
 * @param releaseId - The release ID this approval is for
 * @returns Generated approval request ID
 */
export function generateApprovalRequestId(releaseId: string): string {
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15);
  return `AR-${releaseId}-${timestamp}`;
}
