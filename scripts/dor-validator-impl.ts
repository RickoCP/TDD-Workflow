/**
 * FileDoRValidator Implementation
 * 
 * Concrete implementation of the DoRValidator interface that validates
 * Definition of Ready conditions before tasks can transition to IN_PROGRESS.
 * 
 * This implementation performs 5 DoR condition checks:
 * 1. Acceptance criteria defined (non-empty)
 * 2. Blocking dependencies satisfied (all in DONE status)
 * 3. Linked decisions resolved (all DEC-xxx in RESOLVED status)
 * 4. Assignee has required role
 * 5. No active blockers (no BLOCKER-xxx with OPEN status)
 * 
 * Requirements: R01.1, R01.2, R01.3, R01.4, R01.5, R01.6
 */

import { Result, ok, err, ActorType } from './state-controller';
import {
  AuditLogger,
  createAuditEntry,
} from './audit-logger';
import {
  DoRValidator,
  DoRValidation,
  DoRCondition,
  DoRConditionType,
  RevalidationResult,
  RevalidationTrigger,
  AffectedTaskResult,
  CanStartWorkResult,
  DoRError,
  DoRErrorCode,
  ValidateDoRResult,
  RevalidateResult,
  GetDoRConditionsResult,
  CanStartWorkCheckResult,
  TaskForDoRValidation,
  TaskDependency,
  DecisionData,
  BlockerData,
  TaskStatusData,
  MemberRoleData,
  DoRValidatorConfig,
  ChangeType,
  DOR_CONDITION_IDS,
  DOR_CONDITION_DESCRIPTIONS,
  DOR_DEFAULTS,
  createDoRValidation,
  createPassingCondition,
  createFailingCondition,
  createRevalidationResult,
  createCanStartWorkResult,
  createDoRError,
  taskNotFoundForDoRError,
  dorNotMetError,
  taskBlockedError,
  createDefaultDoRValidatorConfig,
} from './dor-validator';

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Interface for task storage operations needed by DoRValidator.
 * Allows the implementation to work with different storage backends.
 */
export interface TaskStorageForDoR {
  /**
   * Gets a task by its ID.
   */
  getTask(taskId: string): TaskForDoRValidation | null;

  /**
   * Gets all tasks.
   */
  getAllTasks(): TaskForDoRValidation[];

  /**
   * Gets tasks that depend on a specific task.
   */
  getTasksDependingOn(taskId: string): TaskForDoRValidation[];

  /**
   * Gets tasks that reference a specific blocker.
   */
  getTasksWithBlocker(blockerId: string): TaskForDoRValidation[];

  /**
   * Gets tasks that link to a specific decision.
   */
  getTasksWithDecision(decisionId: string): TaskForDoRValidation[];

  /**
   * Updates the DoR check result for a task.
   */
  updateDoRCheckResult(taskId: string, validation: DoRValidation): void;

  /**
   * Gets the stored DoR check result for a task.
   */
  getDoRCheckResult(taskId: string): DoRValidation | null;
}

/**
 * Interface for decision storage operations.
 */
export interface DecisionStorageForDoR {
  /**
   * Gets a decision by its ID (DEC-xxx).
   */
  getDecision(decisionId: string): DecisionData | null;
}

/**
 * Interface for blocker storage operations.
 */
export interface BlockerStorageForDoR {
  /**
   * Gets a blocker by its ID (BLOCKER-xxx).
   */
  getBlocker(blockerId: string): BlockerData | null;
}

/**
 * Interface for team member operations.
 */
export interface TeamStorageForDoR {
  /**
   * Gets a team member by their ID.
   */
  getMember(memberId: string): MemberRoleData | null;
}

// =============================================================================
// In-Memory Storage Implementations (for testing)
// =============================================================================

/**
 * In-memory task storage for DoR validation testing.
 */
export class InMemoryTaskStorageForDoR implements TaskStorageForDoR {
  private tasks: Map<string, TaskForDoRValidation> = new Map();
  private dorResults: Map<string, DoRValidation> = new Map();

  addTask(task: TaskForDoRValidation): void {
    this.tasks.set(task.id, { ...task });
  }

  getTask(taskId: string): TaskForDoRValidation | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  getAllTasks(): TaskForDoRValidation[] {
    return Array.from(this.tasks.values()).map(t => ({ ...t }));
  }

  getTasksDependingOn(taskId: string): TaskForDoRValidation[] {
    return Array.from(this.tasks.values())
      .filter(task => task.depends_on?.some(dep => dep.task_id === taskId))
      .map(t => ({ ...t }));
  }

  getTasksWithBlocker(blockerId: string): TaskForDoRValidation[] {
    return Array.from(this.tasks.values())
      .filter(task => task.blocker_refs?.includes(blockerId))
      .map(t => ({ ...t }));
  }

  getTasksWithDecision(decisionId: string): TaskForDoRValidation[] {
    return Array.from(this.tasks.values())
      .filter(task => task.linked_decisions?.includes(decisionId))
      .map(t => ({ ...t }));
  }

  updateDoRCheckResult(taskId: string, validation: DoRValidation): void {
    this.dorResults.set(taskId, validation);
  }

  getDoRCheckResult(taskId: string): DoRValidation | null {
    return this.dorResults.get(taskId) || null;
  }

  updateTask(task: TaskForDoRValidation): void {
    this.tasks.set(task.id, { ...task });
  }

  clear(): void {
    this.tasks.clear();
    this.dorResults.clear();
  }
}

/**
 * In-memory decision storage for DoR validation testing.
 */
export class InMemoryDecisionStorageForDoR implements DecisionStorageForDoR {
  private decisions: Map<string, DecisionData> = new Map();

  addDecision(decision: DecisionData): void {
    this.decisions.set(decision.id, { ...decision });
  }

  getDecision(decisionId: string): DecisionData | null {
    const decision = this.decisions.get(decisionId);
    return decision ? { ...decision } : null;
  }

  clear(): void {
    this.decisions.clear();
  }
}

/**
 * In-memory blocker storage for DoR validation testing.
 */
export class InMemoryBlockerStorageForDoR implements BlockerStorageForDoR {
  private blockers: Map<string, BlockerData> = new Map();

  addBlocker(blocker: BlockerData): void {
    this.blockers.set(blocker.id, { ...blocker });
  }

  getBlocker(blockerId: string): BlockerData | null {
    const blocker = this.blockers.get(blockerId);
    return blocker ? { ...blocker } : null;
  }

  clear(): void {
    this.blockers.clear();
  }
}

/**
 * In-memory team storage for DoR validation testing.
 */
export class InMemoryTeamStorageForDoR implements TeamStorageForDoR {
  private members: Map<string, MemberRoleData> = new Map();

  addMember(member: MemberRoleData): void {
    this.members.set(member.id, { ...member });
  }

  getMember(memberId: string): MemberRoleData | null {
    const member = this.members.get(memberId);
    return member ? { ...member } : null;
  }

  clear(): void {
    this.members.clear();
  }
}

// =============================================================================
// FileDoRValidator Configuration
// =============================================================================

/**
 * Configuration for FileDoRValidator.
 */
export interface FileDoRValidatorConfig extends DoRValidatorConfig {
  /** Task storage backend */
  taskStorage: TaskStorageForDoR;
  /** Decision storage backend */
  decisionStorage: DecisionStorageForDoR;
  /** Blocker storage backend */
  blockerStorage: BlockerStorageForDoR;
  /** Team storage backend */
  teamStorage: TeamStorageForDoR;
  /** Optional audit logger for logging DoR check results */
  auditLogger?: AuditLogger;
}

// =============================================================================
// FileDoRValidator Implementation
// =============================================================================

/**
 * FileDoRValidator - Concrete implementation of DoRValidator.
 * 
 * Validates Definition of Ready conditions for tasks:
 * 1. Acceptance criteria defined (non-empty)
 * 2. Blocking dependencies satisfied (all in DONE status)
 * 3. Linked decisions resolved (all DEC-xxx in RESOLVED status)
 * 4. Assignee has required role
 * 5. No active blockers (no BLOCKER-xxx with OPEN status)
 * 
 * Requirements: R01.1, R01.2, R01.3, R01.4, R01.5, R01.6
 */
export class FileDoRValidator implements DoRValidator {
  private config: FileDoRValidatorConfig;
  private readonly auditLogger?: AuditLogger;

  constructor(config: FileDoRValidatorConfig) {
    this.config = {
      ...createDefaultDoRValidatorConfig(),
      ...config,
    };
    this.auditLogger = config.auditLogger;
  }

  // ===========================================================================
  // Audit Logging Helper
  // ===========================================================================

  /**
   * Logs a DoR check event to the audit logger (fire-and-forget).
   */
  private logDoRCheckEvent(
    taskId: string,
    passed: boolean,
    failedConditions?: string[]
  ): void {
    if (!this.auditLogger) return;

    const entry = createAuditEntry({
      actor_id: 'SYSTEM',
      actor_type: 'SYSTEM' as ActorType,
      action: passed ? 'DOR_CHECK_PASSED' : 'DOR_CHECK_FAILED',
      resource_type: 'Task',
      resource_id: taskId,
      reason: passed 
        ? `DoR validation passed for task ${taskId}` 
        : `DoR validation failed: ${failedConditions?.join(', ') || 'unknown'}`,
      outcome: 'SUCCESS',
    });

    // Fire-and-forget
    this.auditLogger.log(entry).catch(() => {
      // Silently ignore audit log failures
    });
  }

  // ===========================================================================
  // Validation Operations
  // ===========================================================================

  /**
   * Validates Definition of Ready for a task.
   * 
   * Requirements: R01.1, R01.2, R01.5
   */
  async validateDoR(taskId: string): Promise<ValidateDoRResult> {
    // Get the task
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForDoRError(taskId));
    }

    // Run all condition checks
    const conditions = await this.runAllConditionChecks(task);

    // Create validation result
    const validation = createDoRValidation(taskId, conditions);

    // Store the DoR check result (R01.5)
    this.config.taskStorage.updateDoRCheckResult(taskId, validation);

    // Log the DoR check result
    const failedConditions = conditions
      .filter(c => !c.passed)
      .map(c => c.id);
    this.logDoRCheckEvent(taskId, validation.passed, failedConditions);

    return ok(validation);
  }

  // ===========================================================================
  // Revalidation Operations
  // ===========================================================================

  /**
   * Re-validates DoR for all tasks affected by a change.
   * 
   * Requirements: R01.6
   */
  async revalidateAffectedTasks(changedTaskId: string): Promise<RevalidateResult> {
    // Get tasks that depend on the changed task
    const dependentTasks = this.config.taskStorage.getTasksDependingOn(changedTaskId);

    const affectedResults: AffectedTaskResult[] = [];

    for (const task of dependentTasks) {
      // Get previous DoR status from stored result
      const previousValidation = this.config.taskStorage.getDoRCheckResult(task.id);
      const previousStatus = previousValidation?.passed ?? false;

      // Revalidate
      const validationResult = await this.validateDoR(task.id);
      if (!validationResult.success) {
        continue; // Skip if validation failed
      }

      const newStatus = validationResult.value.passed;
      const statusChanged = previousStatus !== newStatus;

      affectedResults.push({
        task_id: task.id,
        previous_status: previousStatus,
        new_status: newStatus,
        status_changed: statusChanged,
        validation: validationResult.value,
      });
    }

    // Determine trigger reason based on context (simplified)
    const triggerReason: RevalidationTrigger = 'dependency_completed';

    return ok(createRevalidationResult(changedTaskId, triggerReason, affectedResults));
  }

  /**
   * Re-validates DoR for all tasks affected by a dependency completion.
   * Called when an upstream task completes (transitions to DONE status).
   * 
   * Requirements: R01.6
   */
  async revalidateOnDependencyComplete(completedTaskId: string): Promise<RevalidateResult> {
    // Get tasks that have blocking dependency on the completed task
    const dependentTasks = this.config.taskStorage.getTasksDependingOn(completedTaskId);
    
    // Filter to only tasks with blocking dependencies
    const blockingDependentTasks = dependentTasks.filter(task => 
      task.depends_on?.some(dep => 
        dep.task_id === completedTaskId && dep.type === 'blocking'
      )
    );

    const affectedResults: AffectedTaskResult[] = [];

    for (const task of blockingDependentTasks) {
      // Get previous DoR status from stored result
      const previousValidation = this.config.taskStorage.getDoRCheckResult(task.id);
      const previousStatus = previousValidation?.passed ?? false;

      // Revalidate
      const validationResult = await this.validateDoR(task.id);
      if (!validationResult.success) {
        continue; // Skip if validation failed
      }

      const newStatus = validationResult.value.passed;
      const statusChanged = previousStatus !== newStatus;

      affectedResults.push({
        task_id: task.id,
        previous_status: previousStatus,
        new_status: newStatus,
        status_changed: statusChanged,
        validation: validationResult.value,
      });
    }

    return ok(createRevalidationResult(completedTaskId, 'dependency_completed', affectedResults));
  }

  /**
   * Re-validates DoR for all tasks affected by a blocker resolution.
   * Called when a blocker is resolved (status changes to CLOSED).
   * 
   * Requirements: R01.6
   */
  async revalidateOnBlockerResolved(blockerId: string): Promise<RevalidateResult> {
    // Get tasks that reference this blocker
    const blockedTasks = this.config.taskStorage.getTasksWithBlocker(blockerId);

    const affectedResults: AffectedTaskResult[] = [];

    for (const task of blockedTasks) {
      // Get previous DoR status from stored result
      const previousValidation = this.config.taskStorage.getDoRCheckResult(task.id);
      const previousStatus = previousValidation?.passed ?? false;

      // Revalidate
      const validationResult = await this.validateDoR(task.id);
      if (!validationResult.success) {
        continue; // Skip if validation failed
      }

      const newStatus = validationResult.value.passed;
      const statusChanged = previousStatus !== newStatus;

      affectedResults.push({
        task_id: task.id,
        previous_status: previousStatus,
        new_status: newStatus,
        status_changed: statusChanged,
        validation: validationResult.value,
      });
    }

    return ok(createRevalidationResult(blockerId, 'blocker_resolved', affectedResults));
  }

  /**
   * Re-validates DoR for all tasks affected by a decision resolution.
   * Called when a linked decision is resolved.
   * 
   * Requirements: R01.6
   */
  async revalidateOnDecisionResolved(decisionId: string): Promise<RevalidateResult> {
    // Get tasks that link to this decision
    const linkedTasks = this.config.taskStorage.getTasksWithDecision(decisionId);

    const affectedResults: AffectedTaskResult[] = [];

    for (const task of linkedTasks) {
      // Get previous DoR status from stored result
      const previousValidation = this.config.taskStorage.getDoRCheckResult(task.id);
      const previousStatus = previousValidation?.passed ?? false;

      // Revalidate
      const validationResult = await this.validateDoR(task.id);
      if (!validationResult.success) {
        continue; // Skip if validation failed
      }

      const newStatus = validationResult.value.passed;
      const statusChanged = previousStatus !== newStatus;

      affectedResults.push({
        task_id: task.id,
        previous_status: previousStatus,
        new_status: newStatus,
        status_changed: statusChanged,
        validation: validationResult.value,
      });
    }

    return ok(createRevalidationResult(decisionId, 'decision_resolved', affectedResults));
  }

  /**
   * Generic method to find tasks needing revalidation based on change type.
   * 
   * Requirements: R01.6
   */
  async getTasksNeedingRevalidation(
    changeType: ChangeType, 
    changeId: string
  ): Promise<Result<TaskForDoRValidation[], DoRError>> {
    let tasks: TaskForDoRValidation[] = [];

    switch (changeType) {
      case 'dependency':
        // Get tasks that depend on this task
        tasks = this.config.taskStorage.getTasksDependingOn(changeId);
        // Filter to only tasks with blocking dependencies
        tasks = tasks.filter(task => 
          task.depends_on?.some(dep => 
            dep.task_id === changeId && dep.type === 'blocking'
          )
        );
        break;
      case 'blocker':
        // Get tasks that reference this blocker
        tasks = this.config.taskStorage.getTasksWithBlocker(changeId);
        break;
      case 'decision':
        // Get tasks that link to this decision
        tasks = this.config.taskStorage.getTasksWithDecision(changeId);
        break;
      default:
        return err(createDoRError(
          DoRErrorCode.INVALID_CONFIG,
          `Unknown change type: ${changeType}`,
          { details: `Valid change types are: dependency, blocker, decision` },
          false
        ));
    }

    return ok(tasks);
  }

  // ===========================================================================
  // Condition Query Operations
  // ===========================================================================

  /**
   * Gets DoR conditions for a task without performing full validation.
   * 
   * Requirements: R01.2
   */
  async getDoRConditions(taskId: string): Promise<GetDoRConditionsResult> {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForDoRError(taskId));
    }

    const conditions = await this.runAllConditionChecks(task);
    return ok(conditions);
  }

  // ===========================================================================
  // Work Start Check
  // ===========================================================================

  /**
   * Checks if work can be started on a task.
   * 
   * Requirements: R01.1, R01.3, R01.4
   */
  async canStartWork(taskId: string): Promise<CanStartWorkCheckResult> {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForDoRError(taskId));
    }

    // Check for active blockers first (R01.4)
    if (task.blocked && task.blocker_refs && task.blocker_refs.length > 0) {
      return err(taskBlockedError(taskId, task.blocker_refs));
    }

    // Run full DoR validation
    const validationResult = await this.validateDoR(taskId);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    const validation = validationResult.value;
    const additionalBlockers: string[] = [];
    const suggestions: string[] = [];

    // Generate suggestions for failed conditions
    for (const condition of validation.conditions) {
      if (!condition.passed) {
        switch (condition.type) {
          case 'acceptance_criteria':
            suggestions.push('Define acceptance criteria for this task');
            break;
          case 'dependencies':
            suggestions.push('Complete blocking dependencies before starting');
            break;
          case 'decisions':
            suggestions.push('Resolve linked decisions before starting');
            break;
          case 'role_match':
            suggestions.push('Assign to someone with the required role or add the role');
            break;
          case 'no_blockers':
            suggestions.push('Resolve active blockers before starting');
            break;
        }
      }
    }

    return ok(createCanStartWorkResult(validation, additionalBlockers, suggestions));
  }

  // ===========================================================================
  // Private Helper Methods - Condition Checks
  // ===========================================================================

  /**
   * Runs all DoR condition checks for a task.
   */
  private async runAllConditionChecks(task: TaskForDoRValidation): Promise<DoRCondition[]> {
    const conditions: DoRCondition[] = [];

    // Condition 1: Acceptance criteria defined (R01.2)
    conditions.push(this.checkAcceptanceCriteriaDefined(task));

    // Condition 2: Blocking dependencies complete (R01.2)
    conditions.push(this.checkBlockingDependenciesComplete(task));

    // Condition 3: Decisions resolved (R01.2)
    conditions.push(this.checkDecisionsResolved(task));

    // Condition 4: Assignee has required role (R01.2)
    conditions.push(this.checkAssigneeHasRole(task));

    // Condition 5: No active blockers (R01.2, R01.4)
    conditions.push(this.checkNoActiveBlockers(task));

    return conditions;
  }

  /**
   * Checks if acceptance criteria are defined and non-empty.
   * Requirements: R01.2 - "Scope dan acceptance criteria terdefinisi (non-empty)"
   */
  private checkAcceptanceCriteriaDefined(task: TaskForDoRValidation): DoRCondition {
    const conditionId = DOR_CONDITION_IDS.ACCEPTANCE_CRITERIA;
    const description = DOR_CONDITION_DESCRIPTIONS[conditionId];
    const type: DoRConditionType = 'acceptance_criteria';

    // Check if acceptance_criteria exists and is non-empty
    const ac = task.acceptance_criteria;
    const hasAC = ac !== undefined && Array.isArray(ac) && ac.length >= (this.config.minAcceptanceCriteria ?? 1);
    
    // Also check that each AC is non-empty string
    const validAC = hasAC && ac!.every(criteria => typeof criteria === 'string' && criteria.trim().length > 0);

    if (validAC) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `${ac!.length} acceptance criteria present`
      );
    }

    const details = !ac || ac.length === 0
      ? 'No acceptance criteria defined'
      : `Only ${ac.filter(c => typeof c === 'string' && c.trim().length > 0).length} valid acceptance criteria (minimum: ${this.config.minAcceptanceCriteria ?? 1})`;

    return createFailingCondition(
      conditionId,
      type,
      description,
      details,
      {
        expected: this.config.minAcceptanceCriteria ?? 1,
        actual: ac?.filter(c => typeof c === 'string' && c.trim().length > 0).length ?? 0,
      }
    );
  }

  /**
   * Checks if all blocking dependencies are in DONE status.
   * Requirements: R01.2 - "Semua blocking dependencies dalam status DONE"
   */
  private checkBlockingDependenciesComplete(task: TaskForDoRValidation): DoRCondition {
    const conditionId = DOR_CONDITION_IDS.DEPENDENCIES;
    const description = DOR_CONDITION_DESCRIPTIONS[conditionId];
    const type: DoRConditionType = 'dependencies';

    const dependencies = task.depends_on ?? [];
    const blockingDeps = dependencies.filter(dep => dep.type === 'blocking');

    if (blockingDeps.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        'No blocking dependencies'
      );
    }

    // Check each blocking dependency
    const unmetDeps: string[] = [];
    for (const dep of blockingDeps) {
      const depTask = this.config.taskStorage.getTask(dep.task_id);
      if (!depTask) {
        unmetDeps.push(`${dep.task_id} (not found)`);
      } else if (depTask.status !== 'DONE') {
        unmetDeps.push(`${dep.task_id} (status: ${depTask.status})`);
      }
    }

    if (unmetDeps.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `All ${blockingDeps.length} blocking dependencies satisfied`
      );
    }

    return createFailingCondition(
      conditionId,
      type,
      description,
      `Unmet blocking dependencies: ${unmetDeps.join(', ')}`,
      {
        failed_items: unmetDeps,
        expected: 0,
        actual: unmetDeps.length,
      }
    );
  }

  /**
   * Checks if all linked decisions are resolved.
   * Requirements: R01.2 - "Keputusan yang menghambat (linked DEC-xxx) telah resolved"
   */
  private checkDecisionsResolved(task: TaskForDoRValidation): DoRCondition {
    const conditionId = DOR_CONDITION_IDS.DECISIONS;
    const description = DOR_CONDITION_DESCRIPTIONS[conditionId];
    const type: DoRConditionType = 'decisions';

    const linkedDecisions = task.linked_decisions ?? [];

    if (linkedDecisions.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        'No linked decisions'
      );
    }

    // Check each linked decision
    const unresolvedDecisions: string[] = [];
    for (const decisionId of linkedDecisions) {
      const decision = this.config.decisionStorage.getDecision(decisionId);
      if (!decision) {
        unresolvedDecisions.push(`${decisionId} (not found)`);
      } else if (decision.status !== 'RESOLVED') {
        unresolvedDecisions.push(`${decisionId} (status: ${decision.status})`);
      }
    }

    if (unresolvedDecisions.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `All ${linkedDecisions.length} linked decisions resolved`
      );
    }

    return createFailingCondition(
      conditionId,
      type,
      description,
      `Unresolved decisions: ${unresolvedDecisions.join(', ')}`,
      {
        failed_items: unresolvedDecisions,
        expected: 0,
        actual: unresolvedDecisions.length,
      }
    );
  }

  /**
   * Checks if the assignee has the required role.
   * Requirements: R01.2 - "Assignee memiliki role yang sesuai dengan role_required"
   */
  private checkAssigneeHasRole(task: TaskForDoRValidation): DoRCondition {
    const conditionId = DOR_CONDITION_IDS.ROLE_MATCH;
    const description = DOR_CONDITION_DESCRIPTIONS[conditionId];
    const type: DoRConditionType = 'role_match';

    const assignment = task.assignment;
    const roleRequired = assignment?.role_required;

    // If no role is required, condition passes
    if (!roleRequired || roleRequired === null) {
      if (this.config.skipRoleValidationIfNotRequired) {
        return createPassingCondition(
          conditionId,
          type,
          description,
          'No role requirement specified'
        );
      }
    }

    // If role is required but no assignee, check config
    const assignee = assignment?.assignee;
    if (!assignee || assignee === null) {
      if (this.config.requireAssigneeForRoleCheck && roleRequired) {
        return createFailingCondition(
          conditionId,
          type,
          description,
          `No assignee for task requiring '${roleRequired}' role`,
          {
            expected: roleRequired,
            actual: null,
          }
        );
      }
      return createPassingCondition(
        conditionId,
        type,
        description,
        'No assignee and no role requirement'
      );
    }

    // No role required but has assignee - passes
    if (!roleRequired) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `Assignee ${assignee} present (no role requirement)`
      );
    }

    // Check if assignee has the required role
    const member = this.config.teamStorage.getMember(assignee);
    if (!member) {
      return createFailingCondition(
        conditionId,
        type,
        description,
        `Assignee '${assignee}' not found in team`,
        {
          expected: roleRequired,
          actual: 'member not found',
        }
      );
    }

    const hasRole = member.roles.includes(roleRequired);
    if (hasRole) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `Assignee '${assignee}' has '${roleRequired}' role`
      );
    }

    return createFailingCondition(
      conditionId,
      type,
      description,
      `Assignee '${assignee}' lacks '${roleRequired}' role (has: ${member.roles.join(', ')})`,
      {
        expected: roleRequired,
        actual: member.roles.join(', '),
      }
    );
  }

  /**
   * Checks if there are no active blockers.
   * Requirements: R01.2, R01.4 - "WHEN task memiliki blocker aktif (BLOCKER-xxx dengan status OPEN)"
   */
  private checkNoActiveBlockers(task: TaskForDoRValidation): DoRCondition {
    const conditionId = DOR_CONDITION_IDS.NO_BLOCKERS;
    const description = DOR_CONDITION_DESCRIPTIONS[conditionId];
    const type: DoRConditionType = 'no_blockers';

    // Check the blocked flag first
    if (task.blocked === true) {
      const blockerRefs = task.blocker_refs ?? [];
      return createFailingCondition(
        conditionId,
        type,
        description,
        `Task is blocked: ${blockerRefs.join(', ') || 'reason not specified'}`,
        {
          failed_items: blockerRefs,
          actual: blockerRefs.length,
        }
      );
    }

    const blockerRefs = task.blocker_refs ?? [];
    if (blockerRefs.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        'No blockers'
      );
    }

    // Check each blocker's status
    const activeBlockers: string[] = [];
    for (const blockerId of blockerRefs) {
      const blocker = this.config.blockerStorage.getBlocker(blockerId);
      if (!blocker) {
        // Blocker reference exists but blocker not found - treat as active (conservative)
        activeBlockers.push(`${blockerId} (not found)`);
      } else if (blocker.status === 'OPEN') {
        activeBlockers.push(blockerId);
      }
      // CLOSED blockers are ignored
    }

    if (activeBlockers.length === 0) {
      return createPassingCondition(
        conditionId,
        type,
        description,
        `All ${blockerRefs.length} blockers resolved`
      );
    }

    return createFailingCondition(
      conditionId,
      type,
      description,
      `Active blockers: ${activeBlockers.join(', ')}`,
      {
        failed_items: activeBlockers,
        expected: 0,
        actual: activeBlockers.length,
      }
    );
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a FileDoRValidator with the given configuration.
 */
export function createFileDoRValidator(config: FileDoRValidatorConfig): FileDoRValidator {
  return new FileDoRValidator(config);
}
