/**
 * FileEvidenceManager Implementation
 * 
 * Concrete implementation of the EvidenceManager interface that uses
 * file-based storage for evidence records with YAML serialization.
 * 
 * This module provides evidence lifecycle management with:
 * - Evidence creation with full metadata capture
 * - Git state correlation (commit SHA, branch, dirty status)
 * - File hash computation for staleness tracking
 * - YAML-based evidence storage
 * 
 * Requirements: R06.1, R06.2, R06.4, R06.5
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import * as crypto from 'node:crypto';

import {
  EvidenceManager,
  Evidence,
  EvidenceInput,
  EvidenceType,
  EvidenceResultStatus,
  EvidenceGitState,
  EvidenceExecutor,
  ExecutionDetails,
  EvidenceResult,
  StalenessInfo,
  StalenessReason,
  StalenessCheck,
  FileHash,
  GateStatus,
  GateValidation,
  QualityGate,
  EvidenceError,
  EvidenceErrorCode,
  CreateEvidenceResult,
  GetEvidenceResult,
  ListEvidenceResult,
  CheckStalenessResult,
  MarkStaleResult,
  ValidateGateResult,
  DeleteEvidenceResult,
  EVIDENCE_DEFAULTS,
  generateEvidenceId,
  createEvidenceError,
  evidenceNotFoundError,
  writeEvidenceFailedError,
  evidenceGitStateError,
  missingRequiredFieldsError,
  invalidEvidenceTypeError,
  isValidEvidenceType,
  isValidResultStatus,
  createDefaultStalenessInfo,
  createFileHash,
  createExecutionDetails,
  createEvidenceResult,
  createEvidenceGitState,
  createEvidenceExecutor,
  sortEvidenceByDate,
  filterEvidenceByTask,
  filterEvidenceByType,
} from './evidence-manager';

import {
  ActorType,
  TddPhase,
  Result,
  ok,
  err,
} from './state-controller';

import {
  AuditLogger,
  createAuditEntry,
} from './audit-logger';

// =============================================================================
// Git Client Interface
// =============================================================================

/**
 * Git client interface for abstracting git operations.
 * This allows for easy mocking in tests.
 */
export interface GitClient {
  /** Gets the current commit SHA */
  getCurrentCommitSha(): Promise<string>;
  /** Gets the current branch name */
  getCurrentBranch(): Promise<string>;
  /** Checks if the working tree has uncommitted changes */
  isWorkingTreeDirty(): Promise<boolean>;
  /** Gets list of uncommitted files */
  getUncommittedFiles(): Promise<string[]>;
  /** Checks if a commit exists and is reachable */
  commitExists(sha: string): Promise<boolean>;
  /** Gets the hash of a file for staleness tracking */
  getFileHash(filePath: string): Promise<string>;
  /** Gets changed files between two commits */
  getChangedFilesBetween(fromSha: string, toSha: string): Promise<string[]>;
}

/**
 * Mock git client for testing.
 * All methods can be overridden for specific test scenarios.
 */
export interface MockGitClient extends GitClient {}

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for FileEvidenceManager.
 */
export interface FileEvidenceManagerConfig {
  /** Path to evidence storage directory */
  storagePath: string;
  /** Git client for git operations */
  gitClient: GitClient;
  /** Path to evidence logs directory (optional) */
  logsPath?: string;
  /** Hash algorithm for file staleness tracking */
  hashAlgorithm?: 'sha256' | 'md5';
  /** Optional audit logger for logging evidence events */
  auditLogger?: AuditLogger;
}

// =============================================================================
// Sequence Counter for Evidence IDs
// =============================================================================

/**
 * In-memory sequence counter for evidence IDs.
 * Maps task+type to current sequence number.
 */
const sequenceCounters: Map<string, number> = new Map();

/**
 * Gets the next sequence number for a given task and type.
 */
function getNextSequence(taskId: string, type: EvidenceType): number {
  const key = `${taskId}:${type}`;
  const current = sequenceCounters.get(key) ?? 0;
  const next = current + 1;
  sequenceCounters.set(key, next);
  return next;
}

/**
 * Resets sequence counter (for testing).
 */
export function resetSequenceCounters(): void {
  sequenceCounters.clear();
}

// =============================================================================
// FileEvidenceManager Implementation
// =============================================================================

/**
 * File-based implementation of the EvidenceManager interface.
 * 
 * This implementation:
 * - Stores evidence as YAML files in the configured storage directory
 * - Captures git state for each evidence record
 * - Computes file hashes for staleness tracking
 * - Generates unique evidence IDs
 * 
 * Requirements: R06.1, R06.2, R06.4, R06.5
 */
export class FileEvidenceManager implements EvidenceManager {
  private readonly storagePath: string;
  private readonly logsPath: string;
  private readonly gitClient: GitClient;
  private readonly hashAlgorithm: 'sha256' | 'md5';
  private readonly auditLogger?: AuditLogger;

  /**
   * Creates a new FileEvidenceManager instance.
   * 
   * @param config - Configuration options for the manager
   */
  constructor(config: FileEvidenceManagerConfig) {
    this.storagePath = config.storagePath;
    this.logsPath = config.logsPath ?? path.join(config.storagePath, 'logs');
    this.gitClient = config.gitClient;
    this.hashAlgorithm = config.hashAlgorithm ?? 'sha256';
    this.auditLogger = config.auditLogger;
  }

  // ===========================================================================
  // Audit Logging Helper
  // ===========================================================================

  /**
   * Logs an evidence event to the audit logger (fire-and-forget).
   * 
   * @param action - The action type (e.g., 'EVIDENCE_CREATED')
   * @param evidenceId - The evidence ID
   * @param taskId - The task ID
   * @param executorId - The executor who performed the action
   * @param executorType - The executor type
   * @param reason - Optional reason for the action
   */
  private logEvidenceEvent(
    action: string,
    evidenceId: string,
    taskId: string,
    executorId: string,
    executorType: ActorType,
    reason?: string
  ): void {
    if (!this.auditLogger) return;

    const entry = createAuditEntry({
      actor_id: executorId,
      actor_type: executorType,
      action,
      resource_type: 'Evidence',
      resource_id: evidenceId,
      reason,
      outcome: 'SUCCESS',
    });

    // Fire-and-forget: don't wait for logging to complete
    this.auditLogger.log(entry).catch(() => {
      // Silently ignore audit log failures
    });
  }

  // ===========================================================================
  // Creation Operations
  // ===========================================================================

  /**
   * Creates evidence record with full metadata.
   * 
   * Requirements: R06.1
   * 
   * @param input - Evidence input data
   * @returns Result with Evidence on success, or EvidenceError on failure
   * 
   * Behavior:
   * - Validates required fields
   * - Captures current git state
   * - Computes file hashes for related files
   * - Generates unique evidence ID
   * - Stores evidence to YAML file
   */
  async createEvidence(input: EvidenceInput): Promise<CreateEvidenceResult> {
    try {
      // Step 1: Validate required fields
      const validationError = this.validateInput(input);
      if (validationError) {
        return { success: false, error: validationError };
      }

      // Step 2: Capture git state
      let gitState: EvidenceGitState;
      try {
        gitState = await this.captureGitState();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          error: evidenceGitStateError(message),
        };
      }

      // Step 3: Compute file hashes for related files
      const fileHashes = await this.computeFileHashes(input.related_files ?? []);

      // Step 4: Generate evidence ID
      const evidenceId = this.generateId(input.task_id, input.type, input.tdd_phase);

      // Step 5: Build the evidence record
      const now = new Date().toISOString();
      const evidence: Evidence = {
        evidence_id: evidenceId,
        created_at: now,
        type: input.type,
        task_id: input.task_id,
        tdd_phase: input.tdd_phase,
        requirement_refs: input.requirement_refs,
        ac_refs: input.ac_refs,
        git_state: gitState,
        execution: {
          command: input.command,
          working_directory: input.working_directory,
          config: input.config,
          environment: undefined, // Could be added later
          timestamp: now,
          duration_ms: input.duration_ms,
          exit_code: input.exit_code,
        },
        result: input.result,
        executor: {
          id: input.executor_id,
          type: input.executor_type,
        },
        staleness: {
          stale: false,
          stale_reason: null,
          checked_at: now,
          related_files: fileHashes,
        },
        metadata: input.note ? { note: input.note } : undefined,
      };

      // Step 6: Store evidence to file
      await this.storeEvidence(evidence);

      // Log the evidence creation event
      this.logEvidenceEvent(
        'EVIDENCE_CREATED',
        evidenceId,
        input.task_id,
        input.executor_id,
        input.executor_type,
        `Evidence created for task ${input.task_id}, type ${input.type}, phase ${input.tdd_phase || 'N/A'}`
      );

      return { success: true, value: evidence };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: writeEvidenceFailedError(input.task_id, message),
      };
    }
  }

  // ===========================================================================
  // Retrieval Operations
  // ===========================================================================

  /**
   * Gets evidence by ID.
   * 
   * @param evidenceId - The evidence ID to retrieve
   * @returns Result with Evidence on success, or EvidenceError on failure
   */
  async getEvidence(evidenceId: string): Promise<GetEvidenceResult> {
    try {
      const filePath = path.join(this.storagePath, `${evidenceId}.yaml`);
      const content = await fs.readFile(filePath, 'utf-8');
      const evidence = yaml.parse(content) as Evidence;
      return { success: true, value: evidence };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: false, error: evidenceNotFoundError(evidenceId) };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createEvidenceError(
          EvidenceErrorCode.EVIDENCE_CORRUPTED,
          `Failed to read evidence ${evidenceId}: ${message}`,
          { evidence_id: evidenceId, details: message },
          false
        ),
      };
    }
  }

  /**
   * Lists evidence, optionally filtered by task.
   * 
   * @param taskId - Optional task ID to filter by
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  async listEvidence(taskId?: string): Promise<ListEvidenceResult> {
    try {
      // Ensure storage directory exists
      try {
        await fs.access(this.storagePath);
      } catch {
        // Directory doesn't exist, return empty list
        return { success: true, value: [] };
      }

      const files = await fs.readdir(this.storagePath);
      const yamlFiles = files.filter(f => f.endsWith('.yaml'));
      
      const evidenceList: Evidence[] = [];
      for (const file of yamlFiles) {
        try {
          const content = await fs.readFile(path.join(this.storagePath, file), 'utf-8');
          const evidence = yaml.parse(content) as Evidence;
          if (!taskId || evidence.task_id === taskId) {
            evidenceList.push(evidence);
          }
        } catch {
          // Skip corrupted files
          continue;
        }
      }

      // Sort by creation time (newest first)
      return { success: true, value: sortEvidenceByDate(evidenceList) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createEvidenceError(
          EvidenceErrorCode.EVIDENCE_CORRUPTED,
          `Failed to list evidence: ${message}`,
          { details: message },
          true
        ),
      };
    }
  }

  /**
   * Lists evidence for a task filtered by type.
   * 
   * @param taskId - Task ID to get evidence for
   * @param type - Evidence type to filter by
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  async listEvidenceByType(
    taskId: string,
    type: EvidenceType
  ): Promise<ListEvidenceResult> {
    const result = await this.listEvidence(taskId);
    if (!result.success) {
      return result;
    }
    return { success: true, value: filterEvidenceByType(result.value, type) };
  }

  /**
   * Gets the latest evidence for a task and optional phase.
   * 
   * @param taskId - Task ID to get latest evidence for
   * @param tddPhase - Optional TDD phase to filter by
   * @returns Result with Evidence on success, null if none found, or EvidenceError on failure
   */
  async getLatestEvidence(
    taskId: string,
    tddPhase?: TddPhase
  ): Promise<Result<Evidence | null, EvidenceError>> {
    const result = await this.listEvidence(taskId);
    if (!result.success) {
      return result;
    }

    let filtered = result.value;
    if (tddPhase) {
      filtered = filtered.filter(e => e.tdd_phase === tddPhase);
    }

    if (filtered.length === 0) {
      return { success: true, value: null };
    }

    // Already sorted by date (newest first)
    return { success: true, value: filtered[0] };
  }

  // ===========================================================================
  // Staleness Operations
  // ===========================================================================

  /**
   * Checks if evidence is stale.
   * Compares commit SHA and file hashes with current state.
   * 
   * Requirements: R06.4, R06.5
   * 
   * @param evidenceId - The evidence ID to check
   * @returns Result with StalenessCheck on success, or EvidenceError on failure
   */
  async checkStaleness(evidenceId: string): Promise<CheckStalenessResult> {
    // Get evidence
    const getResult = await this.getEvidence(evidenceId);
    if (!getResult.success) {
      return getResult;
    }
    const evidence = getResult.value;
    const now = new Date().toISOString();

    try {
      // Check if commit still exists
      const commitExists = await this.gitClient.commitExists(evidence.git_state.commit_sha);
      if (!commitExists) {
        return {
          success: true,
          value: {
            evidence_id: evidenceId,
            stale: true,
            reason: 'COMMIT_NOT_FOUND',
            details: `Commit ${evidence.git_state.commit_sha} no longer exists`,
            checked_at: now,
            evidence_commit_sha: evidence.git_state.commit_sha,
          },
        };
      }

      // Check if HEAD has moved
      const currentCommit = await this.gitClient.getCurrentCommitSha();
      if (currentCommit !== evidence.git_state.commit_sha) {
        // Check if related files changed
        const changedFiles = await this.gitClient.getChangedFilesBetween(
          evidence.git_state.commit_sha,
          currentCommit
        );
        
        const relatedPaths = evidence.staleness.related_files.map(f => f.path);
        const affectedFiles = changedFiles.filter(f => relatedPaths.includes(f));

        if (affectedFiles.length > 0) {
          return {
            success: true,
            value: {
              evidence_id: evidenceId,
              stale: true,
              reason: 'FILES_MODIFIED',
              details: `Files changed since evidence: ${affectedFiles.join(', ')}`,
              checked_at: now,
              affected_files: affectedFiles,
              current_commit_sha: currentCommit,
              evidence_commit_sha: evidence.git_state.commit_sha,
            },
          };
        }

        // Commit changed but related files not affected
        return {
          success: true,
          value: {
            evidence_id: evidenceId,
            stale: true,
            reason: 'COMMIT_CHANGED',
            details: `HEAD moved from ${evidence.git_state.commit_sha} to ${currentCommit}, but related files unchanged`,
            checked_at: now,
            current_commit_sha: currentCommit,
            evidence_commit_sha: evidence.git_state.commit_sha,
          },
        };
      }

      // Not stale
      return {
        success: true,
        value: {
          evidence_id: evidenceId,
          stale: false,
          reason: null,
          details: null,
          checked_at: now,
          current_commit_sha: currentCommit,
          evidence_commit_sha: evidence.git_state.commit_sha,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: evidenceGitStateError(message),
      };
    }
  }

  /**
   * Marks evidence as stale with reason.
   * 
   * Requirements: R06.5
   * 
   * @param evidenceId - The evidence ID to mark as stale
   * @param reason - Reason for marking as stale
   * @returns Result with void on success, or EvidenceError on failure
   */
  async markStale(
    evidenceId: string,
    reason: StalenessReason
  ): Promise<MarkStaleResult> {
    // Get evidence
    const getResult = await this.getEvidence(evidenceId);
    if (!getResult.success) {
      return getResult;
    }

    // Update staleness
    const evidence = getResult.value;
    evidence.staleness.stale = true;
    evidence.staleness.stale_reason = reason;
    evidence.staleness.checked_at = new Date().toISOString();

    // Store updated evidence
    try {
      await this.storeEvidence(evidence);
      return { success: true, value: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: writeEvidenceFailedError(evidence.task_id, message),
      };
    }
  }

  /**
   * Gets all stale evidence for a task.
   * 
   * @param taskId - Task ID to check
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  async getStaleEvidence(taskId: string): Promise<ListEvidenceResult> {
    const result = await this.listEvidence(taskId);
    if (!result.success) {
      return result;
    }
    return {
      success: true,
      value: result.value.filter(e => e.staleness.stale),
    };
  }

  /**
   * Gets all stale evidence for a release.
   * 
   * @param releaseId - Release ID to check
   * @returns Result with Evidence array on success, or EvidenceError on failure
   */
  async getStaleEvidenceForRelease(releaseId: string): Promise<ListEvidenceResult> {
    // TODO: Implement when Release_Manager integration is available
    // For now, return all stale evidence
    const result = await this.listEvidence();
    if (!result.success) {
      return result;
    }
    return {
      success: true,
      value: result.value.filter(e => e.staleness.stale),
    };
  }

  // ===========================================================================
  // Quality Gate Operations
  // ===========================================================================

  /**
   * Validates quality gate requirements for a task.
   * 
   * Requirements: R06.7
   * 
   * @param taskId - Task ID to validate
   * @param gate - Quality gate to validate
   * @param gateConfig - Optional gate configuration (uses default if not provided)
   * @returns Result with GateStatus on success, or EvidenceError on failure
   * 
   * Validation checks:
   * - Required evidence exists for the gate
   * - Evidence is not stale
   * - Pass rate meets minimum (if applicable)
   */
  async validateGate(
    taskId: string,
    gate: QualityGate,
    gateConfig?: QualityGateValidationConfig
  ): Promise<Result<GateStatus, EvidenceError>> {
    const now = new Date().toISOString();
    
    // Get configuration with defaults
    const config = gateConfig ?? getDefaultGateConfig(gate);
    
    // Get evidence for this task
    const listResult = await this.listEvidence(taskId);
    if (!listResult.success) {
      return listResult;
    }
    
    // Filter evidence relevant to this gate
    const relevantEvidence = listResult.value.filter(e => 
      this.isEvidenceForGate(e, gate)
    );
    
    // If gate is not required and no evidence exists, mark as SKIPPED
    if (!config.required && relevantEvidence.length === 0) {
      return {
        success: true,
        value: {
          gate,
          status: 'SKIPPED',
          required: false,
          evidence_ids: [],
          all_evidence_fresh: true,
          message: `Gate '${gate}' is not required and no evidence found`,
          validated_at: now,
        },
      };
    }
    
    // If gate is required but no evidence exists, mark as FAILED
    if (config.required && relevantEvidence.length === 0) {
      return {
        success: true,
        value: {
          gate,
          status: 'FAILED',
          required: true,
          evidence_ids: [],
          all_evidence_fresh: true,
          message: `Gate '${gate}' requires evidence but none found`,
          validated_at: now,
        },
      };
    }
    
    // Check staleness of all relevant evidence
    const staleEvidence: string[] = [];
    for (const e of relevantEvidence) {
      if (e.staleness.stale) {
        staleEvidence.push(e.evidence_id);
      } else if (!config.allowStale) {
        // Perform fresh staleness check
        const stalenessResult = await this.checkStaleness(e.evidence_id);
        if (stalenessResult.success && stalenessResult.value.stale) {
          staleEvidence.push(e.evidence_id);
        }
      }
    }
    
    const allEvidenceFresh = staleEvidence.length === 0;
    const evidenceIds = relevantEvidence.map(e => e.evidence_id);
    
    // If stale evidence exists and stale evidence is not allowed, mark as FAILED
    if (!config.allowStale && !allEvidenceFresh) {
      return {
        success: true,
        value: {
          gate,
          status: 'FAILED',
          required: config.required,
          evidence_ids: evidenceIds,
          all_evidence_fresh: false,
          message: `Gate '${gate}' has stale evidence: ${staleEvidence.join(', ')}`,
          validated_at: now,
        },
      };
    }
    
    // Get the latest evidence for pass rate calculation
    const latestEvidence = relevantEvidence[0]; // Already sorted by date
    
    // Calculate pass rate if applicable
    const passRate = this.calculatePassRate(latestEvidence);
    const requiredPassRate = config.minPassRate ?? 100;
    
    // Check if pass rate meets minimum
    if (passRate !== null && passRate < requiredPassRate) {
      return {
        success: true,
        value: {
          gate,
          status: 'FAILED',
          required: config.required,
          evidence_ids: evidenceIds,
          all_evidence_fresh: allEvidenceFresh,
          pass_rate: passRate,
          required_pass_rate: requiredPassRate,
          message: `Gate '${gate}' pass rate ${passRate}% below required ${requiredPassRate}%`,
          validated_at: now,
        },
      };
    }
    
    // Check evidence result status
    const latestResult = latestEvidence.result.status;
    if (latestResult !== 'PASS' && latestResult !== 'NOT_APPLICABLE') {
      return {
        success: true,
        value: {
          gate,
          status: 'FAILED',
          required: config.required,
          evidence_ids: evidenceIds,
          all_evidence_fresh: allEvidenceFresh,
          pass_rate: passRate ?? undefined,
          required_pass_rate: requiredPassRate,
          message: `Gate '${gate}' latest evidence status is ${latestResult}`,
          validated_at: now,
        },
      };
    }
    
    // All checks passed
    return {
      success: true,
      value: {
        gate,
        status: 'PASSED',
        required: config.required,
        evidence_ids: evidenceIds,
        all_evidence_fresh: allEvidenceFresh,
        pass_rate: passRate ?? undefined,
        required_pass_rate: requiredPassRate,
        message: `Gate '${gate}' passed all checks`,
        validated_at: now,
      },
    };
  }

  /**
   * Validates all quality gates for a task.
   * 
   * Requirements: R06.7
   * 
   * @param taskId - Task ID to validate
   * @param gatesConfig - Optional gates configuration (uses defaults if not provided)
   * @returns Result with GateValidation on success, or EvidenceError on failure
   */
  async validateAllGates(
    taskId: string,
    gatesConfig?: QualityGatesValidationConfig
  ): Promise<ValidateGateResult> {
    const now = new Date().toISOString();
    const config = gatesConfig ?? getDefaultGatesConfig();
    
    const gates: GateStatus[] = [];
    const passedGates: QualityGate[] = [];
    const failedGates: QualityGate[] = [];
    const blockers: string[] = [];
    
    // Validate each configured gate
    for (const gate of config.gates) {
      const gateConfig = config.gateConfigs?.[gate] ?? getDefaultGateConfig(gate);
      
      const result = await this.validateGate(taskId, gate, gateConfig);
      
      if (!result.success) {
        // Error during validation - treat as failed
        gates.push({
          gate,
          status: 'FAILED',
          required: gateConfig.required,
          evidence_ids: [],
          all_evidence_fresh: true,
          message: `Validation error: ${result.error.message}`,
          validated_at: now,
        });
        failedGates.push(gate);
        if (gateConfig.required) {
          blockers.push(`Gate '${gate}' validation failed: ${result.error.message}`);
        }
        continue;
      }
      
      gates.push(result.value);
      
      if (result.value.status === 'PASSED') {
        passedGates.push(gate);
      } else if (result.value.status === 'FAILED') {
        failedGates.push(gate);
        if (gateConfig.required) {
          blockers.push(result.value.message);
        }
      }
      // SKIPPED and PENDING don't affect passed/failed lists
    }
    
    const passed = blockers.length === 0;
    
    return {
      success: true,
      value: {
        task_id: taskId,
        passed,
        validated_at: now,
        gates,
        passed_gates: passedGates,
        failed_gates: failedGates,
        blockers,
      },
    };
  }
  
  // ===========================================================================
  // Quality Gate Helper Methods
  // ===========================================================================
  
  /**
   * Checks if evidence is relevant for a given quality gate.
   * 
   * @param evidence - Evidence to check
   * @param gate - Quality gate to match
   * @returns True if evidence is relevant for the gate
   */
  private isEvidenceForGate(evidence: Evidence, gate: QualityGate): boolean {
    const evidenceTypeToGateMap: Partial<Record<EvidenceType, QualityGate[]>> = {
      'UNIT_TEST': ['unit_test'],
      'TDD_RED': ['unit_test'],
      'TDD_GREEN': ['unit_test'],
      'TDD_REFACTOR': ['unit_test'],
      'TDD_VERIFY': ['unit_test'],
      'INTEGRATION_TEST': ['integration_test'],
      'E2E_TEST': ['e2e_test'],
      'LINT': ['lint'],
      'TYPE_CHECK': ['type_check'],
      'SECURITY_SCAN': ['security_scan'],
      'BUILD': ['build'],
      'MANUAL_REVIEW': ['manual_review'],
    };
    
    const gatesForType = evidenceTypeToGateMap[evidence.type];
    return gatesForType?.includes(gate) ?? false;
  }
  
  /**
   * Calculates pass rate from evidence result.
   * 
   * @param evidence - Evidence to calculate pass rate from
   * @returns Pass rate as percentage (0-100), or null if not applicable
   */
  private calculatePassRate(evidence: Evidence): number | null {
    const result = evidence.result;
    
    // If explicit test counts are available, calculate rate
    if (result.tests_total !== undefined && result.tests_total > 0) {
      const passed = result.tests_passed ?? 0;
      return Math.round((passed / result.tests_total) * 100);
    }
    
    // If coverage is available, use it
    if (result.coverage_percent !== undefined) {
      return result.coverage_percent;
    }
    
    // For simple PASS/FAIL, return 100/0
    if (result.status === 'PASS') {
      return 100;
    } else if (result.status === 'FAIL') {
      return 0;
    }
    
    return null;
  }

  // ===========================================================================
  // Deletion Operations
  // ===========================================================================

  /**
   * Deletes evidence by ID.
   * 
   * @param evidenceId - The evidence ID to delete
   * @returns Result with void on success, or EvidenceError on failure
   */
  async deleteEvidence(evidenceId: string): Promise<DeleteEvidenceResult> {
    try {
      const filePath = path.join(this.storagePath, `${evidenceId}.yaml`);
      await fs.unlink(filePath);
      return { success: true, value: undefined };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { success: false, error: evidenceNotFoundError(evidenceId) };
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: createEvidenceError(
          EvidenceErrorCode.DELETE_FAILED,
          `Failed to delete evidence ${evidenceId}: ${message}`,
          { evidence_id: evidenceId, details: message },
          true
        ),
      };
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  /**
   * Validates evidence input fields.
   * 
   * @param input - Evidence input to validate
   * @returns EvidenceError if validation fails, null otherwise
   */
  private validateInput(input: EvidenceInput): EvidenceError | null {
    // Check required fields
    const missingFields: string[] = [];
    
    if (!input.task_id || input.task_id.trim() === '') {
      missingFields.push('task_id');
    }
    if (!input.command || input.command.trim() === '') {
      missingFields.push('command');
    }
    if (!input.executor_id || input.executor_id.trim() === '') {
      missingFields.push('executor_id');
    }

    if (missingFields.length > 0) {
      return missingRequiredFieldsError(missingFields);
    }

    // Validate evidence type
    if (!isValidEvidenceType(input.type)) {
      return invalidEvidenceTypeError(input.type as string);
    }

    // Validate result status
    if (!isValidResultStatus(input.result.status)) {
      return createEvidenceError(
        EvidenceErrorCode.INVALID_RESULT_STATUS,
        `Invalid result status: ${input.result.status}`,
        { details: `Invalid status: ${input.result.status}` },
        false,
        'Use a valid result status: PASS, FAIL, BLOCKED, NOT_RUN, NOT_APPLICABLE, ERROR'
      );
    }

    return null;
  }

  /**
   * Captures current git state.
   * 
   * @returns Promise resolving to EvidenceGitState
   * @throws Error if git operations fail
   */
  private async captureGitState(): Promise<EvidenceGitState> {
    const commitSha = await this.gitClient.getCurrentCommitSha();
    const branch = await this.gitClient.getCurrentBranch();
    const dirty = await this.gitClient.isWorkingTreeDirty();
    const uncommittedFiles = dirty ? await this.gitClient.getUncommittedFiles() : [];

    return createEvidenceGitState(commitSha, branch, dirty, uncommittedFiles);
  }

  /**
   * Computes file hashes for staleness tracking.
   * 
   * @param filePaths - Array of file paths to hash
   * @returns Promise resolving to array of FileHash
   */
  private async computeFileHashes(filePaths: string[]): Promise<FileHash[]> {
    const hashes: FileHash[] = [];

    for (const filePath of filePaths) {
      try {
        const hash = await this.gitClient.getFileHash(filePath);
        hashes.push(createFileHash(filePath, hash, this.hashAlgorithm));
      } catch {
        // Skip files that can't be hashed (may not exist yet)
        continue;
      }
    }

    return hashes;
  }

  /**
   * Generates a unique evidence ID.
   * 
   * @param taskId - Task ID
   * @param type - Evidence type
   * @param tddPhase - Optional TDD phase
   * @returns Unique evidence ID
   */
  private generateId(taskId: string, type: EvidenceType, tddPhase?: TddPhase): string {
    if (tddPhase && type.startsWith('TDD_')) {
      return generateEvidenceId(taskId, type, tddPhase);
    }
    
    const sequence = getNextSequence(taskId, type);
    return generateEvidenceId(taskId, type, undefined, sequence);
  }

  /**
   * Stores evidence to YAML file.
   * 
   * @param evidence - Evidence to store
   */
  private async storeEvidence(evidence: Evidence): Promise<void> {
    // Ensure storage directory exists
    await fs.mkdir(this.storagePath, { recursive: true });

    // Write evidence to file
    const filePath = path.join(this.storagePath, `${evidence.evidence_id}.yaml`);
    const content = yaml.stringify(evidence, {
      indent: 2,
      lineWidth: 120,
    });

    await fs.writeFile(filePath, content, 'utf-8');
  }
}

// =============================================================================
// Quality Gate Configuration Types
// =============================================================================

/**
 * Configuration for validating a single quality gate.
 * Requirements: R06.7
 */
export interface QualityGateValidationConfig {
  /** Whether this gate is required */
  required: boolean;
  /** Minimum pass rate (0-100), default 100 */
  minPassRate?: number;
  /** Whether to allow stale evidence, default false */
  allowStale?: boolean;
}

/**
 * Configuration for validating all quality gates.
 * Requirements: R06.7
 */
export interface QualityGatesValidationConfig {
  /** List of gates to validate */
  gates: QualityGate[];
  /** Per-gate configuration */
  gateConfigs?: Partial<Record<QualityGate, QualityGateValidationConfig>>;
}

// =============================================================================
// Quality Gate Default Configuration Helpers
// =============================================================================

/**
 * Default configurations for each quality gate.
 * Requirements: R06.7
 */
const DEFAULT_GATE_CONFIGS: Record<QualityGate, QualityGateValidationConfig> = {
  unit_test: { required: true, minPassRate: 100, allowStale: false },
  integration_test: { required: true, minPassRate: 100, allowStale: false },
  e2e_test: { required: false, minPassRate: 100, allowStale: false },
  lint: { required: true, allowStale: false },
  type_check: { required: true, allowStale: false },
  security_scan: { required: false, allowStale: false },
  build: { required: false, allowStale: false },
  manual_review: { required: false, allowStale: true },
};

/**
 * Gets default configuration for a quality gate.
 * 
 * @param gate - Quality gate to get config for
 * @returns Default configuration for the gate
 */
export function getDefaultGateConfig(gate: QualityGate): QualityGateValidationConfig {
  return DEFAULT_GATE_CONFIGS[gate] ?? { required: false, allowStale: false };
}

/**
 * Gets default configuration for all quality gates validation.
 * 
 * @returns Default configuration for validating all gates
 */
export function getDefaultGatesConfig(): QualityGatesValidationConfig {
  return {
    gates: ['unit_test', 'integration_test', 'lint', 'type_check'],
    gateConfigs: {
      unit_test: DEFAULT_GATE_CONFIGS.unit_test,
      integration_test: DEFAULT_GATE_CONFIGS.integration_test,
      lint: DEFAULT_GATE_CONFIGS.lint,
      type_check: DEFAULT_GATE_CONFIGS.type_check,
    },
  };
}
