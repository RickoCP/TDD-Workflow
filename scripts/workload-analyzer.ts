/**
 * Workload Analyzer - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Workload_Analyzer component
 * which calculates workload distribution and identifies bottlenecks across team members.
 * 
 * Requirements: 9.1, 10.1
 */

import { Result, ok, err, Role, VALID_ROLES } from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default threshold for identifying developers as potential bottlenecks.
 * Developers with more than this many tasks in IN_PROGRESS or BLOCKED status
 * are considered bottlenecks.
 * Requirements: 10.1
 */
export const DEFAULT_BOTTLENECK_THRESHOLD = 3;

/**
 * Task statuses used for workload calculations.
 */
export const TASK_STATUSES_FOR_WORKLOAD = [
  'TODO',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'VERIFY',
  'DONE',
] as const;

/**
 * Task statuses that indicate active work (for bottleneck detection).
 * Requirements: 10.1
 */
export const ACTIVE_TASK_STATUSES = ['IN_PROGRESS', 'BLOCKED'] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Task status type for workload calculations.
 */
export type TaskStatusForWorkload = typeof TASK_STATUSES_FOR_WORKLOAD[number];

/**
 * Active task status type for bottleneck detection.
 */
export type ActiveTaskStatus = typeof ACTIVE_TASK_STATUSES[number];

/**
 * Status counts - number of tasks per status for a developer.
 * Requirements: 9.1
 */
export interface StatusCounts {
  /** Number of tasks in TODO status */
  TODO: number;
  /** Number of tasks in READY status */
  READY: number;
  /** Number of tasks in IN_PROGRESS status */
  IN_PROGRESS: number;
  /** Number of tasks in BLOCKED status */
  BLOCKED: number;
  /** Number of tasks in VERIFY status */
  VERIFY: number;
  /** Number of tasks in DONE status */
  DONE: number;
}

/**
 * Workload metrics for a single developer.
 * Contains statistics about a developer's current task load.
 * Requirements: 9.1, 9.2
 */
export interface WorkloadMetrics {
  /** Total number of tasks assigned to this developer */
  totalTasks: number;
  /** Number of tasks by status */
  tasksByStatus: StatusCounts;
  /** Number of active tasks (IN_PROGRESS + BLOCKED) */
  activeTasks: number;
  /** Number of completed tasks (DONE) */
  completedTasks: number;
  /** Number of pending tasks (TODO + READY) */
  pendingTasks: number;
  /** Total estimated effort if task estimates are available (in story points or hours) */
  estimatedEffort: number | null;
  /** Remaining estimated effort for incomplete tasks */
  remainingEffort: number | null;
  /** Timestamp when metrics were calculated */
  calculatedAt: string;
}

/**
 * Workload data for a specific developer.
 * Combines developer identity with their workload metrics.
 * Requirements: 9.1
 */
export interface DeveloperWorkload {
  /** Developer unique identifier */
  developerId: string;
  /** Developer display name */
  developerName: string;
  /** Developer's assigned roles */
  roles: Role[];
  /** Workload metrics for this developer */
  metrics: WorkloadMetrics;
  /** Whether this developer is considered overloaded */
  isOverloaded: boolean;
  /** Whether this developer is considered underutilized */
  isUnderutilized: boolean;
}

/**
 * Workload statistics for a role.
 * Requirements: 10.2
 */
export interface RoleWorkloadStats {
  /** The role being analyzed */
  role: Role;
  /** Number of developers with this role */
  developerCount: number;
  /** Total tasks requiring this role */
  totalTasks: number;
  /** Tasks per developer ratio */
  tasksPerDeveloper: number;
  /** Whether this role has more tasks than developers (capacity issue) */
  hasCapacityIssue: boolean;
}

/**
 * How work is distributed across the team.
 * Requirements: 9.1, 9.2, 9.3
 */
export interface WorkloadDistribution {
  /** Total number of tasks across the team */
  totalTasks: number;
  /** Total number of team members */
  totalDevelopers: number;
  /** Average tasks per developer */
  averageTasksPerDeveloper: number;
  /** Standard deviation of task distribution */
  standardDeviation: number;
  /** Workload data for each developer */
  developerWorkloads: DeveloperWorkload[];
  /** Team-wide status counts */
  teamStatusCounts: StatusCounts;
  /** Workload stats by role */
  byRole: RoleWorkloadStats[];
  /** IDs of overloaded developers (above threshold) */
  overloadedDeveloperIds: string[];
  /** IDs of underutilized developers (significantly below average) */
  underutilizedDeveloperIds: string[];
  /** Timestamp when distribution was calculated */
  calculatedAt: string;
}

/**
 * Bottleneck type indicating the category of bottleneck.
 * Requirements: 10.1, 10.2
 */
export type BottleneckType = 'DEVELOPER' | 'ROLE';

/**
 * Severity of a bottleneck.
 */
export type BottleneckSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Represents an identified bottleneck in the workflow.
 * Requirements: 10.1, 10.2, 10.3
 */
export interface Bottleneck {
  /** Type of bottleneck */
  type: BottleneckType;
  /** Severity of the bottleneck */
  severity: BottleneckSeverity;
  /** Developer ID (if type is DEVELOPER) */
  developerId?: string;
  /** Developer name (if type is DEVELOPER) */
  developerName?: string;
  /** Role (if type is ROLE) */
  role?: Role;
  /** Number of active/pending tasks causing the bottleneck */
  taskCount: number;
  /** Threshold that was exceeded (for DEVELOPER type) */
  threshold?: number;
  /** Capacity ratio (tasks / developers) for ROLE type */
  capacityRatio?: number;
  /** Description of the bottleneck */
  description: string;
  /** Recommended action to resolve the bottleneck */
  recommendedAction: string;
  /** Timestamp when bottleneck was identified */
  identifiedAt: string;
}

/**
 * Recommendation for rebalancing workload.
 * Requirements: 10.3
 */
export interface RebalanceRecommendation {
  /** Task ID to reassign */
  taskId: string;
  /** Task title */
  taskTitle: string;
  /** Current assignee developer ID */
  fromDeveloperId: string;
  /** Current assignee name */
  fromDeveloperName: string;
  /** Suggested new assignee developer ID */
  toDeveloperId: string;
  /** Suggested new assignee name */
  toDeveloperName: string;
  /** Reason for the recommendation */
  reason: string;
  /** Impact score (higher = more beneficial) */
  impactScore: number;
  /** Timestamp when recommendation was generated */
  generatedAt: string;
}

/**
 * Summary of workload for quick status reporting.
 */
export interface WorkloadSummary {
  /** Developer ID */
  developerId: string;
  /** Developer name */
  developerName: string;
  /** Total tasks assigned */
  totalTasks: number;
  /** Active tasks (IN_PROGRESS + BLOCKED) */
  activeTasks: number;
  /** Completed tasks (DONE) */
  completedTasks: number;
  /** Estimated effort remaining */
  remainingEffort: number | null;
  /** Whether developer is overloaded */
  isOverloaded: boolean;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Workload analyzer error codes following the task specification.
 * Error codes 1401-1405.
 * 
 * Note: These error codes are assigned as per task requirements for the
 * Workload_Analyzer component. The design document mentions range 1300-1399
 * for WORKLOAD_ERROR, but we follow the task specification here.
 */
export enum WorkloadErrorCode {
  /** Developer not found in team registry */
  DEVELOPER_NOT_FOUND = 1401,
  /** No tasks assigned to the developer */
  NO_TASKS_ASSIGNED = 1402,
  /** Error occurred during workload calculation */
  WORKLOAD_CALCULATION_ERROR = 1403,
  /** Invalid metrics query parameters */
  INVALID_METRICS_QUERY = 1404,
  /** Insufficient data to perform analysis */
  INSUFFICIENT_DATA = 1405,
}

/**
 * Workload error structure following the design specification.
 */
export interface WorkloadError {
  /** Error code from WorkloadErrorCode enum */
  code: WorkloadErrorCode;
  /** Error category */
  category: 'WORKLOAD_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    developer_id?: string;
    developer_name?: string;
    role?: string;
    query_params?: Record<string, unknown>;
    calculation_step?: string;
    data_source?: string;
    [key: string]: unknown;
  };
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** Timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a WorkloadError with the given code and details.
 */
export function createWorkloadError(
  code: WorkloadErrorCode,
  message: string,
  context?: WorkloadError['context'],
  suggested_action?: string
): WorkloadError {
  return {
    code,
    category: 'WORKLOAD_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "developer not found" error.
 */
export function developerNotFoundForWorkloadError(developerId: string): WorkloadError {
  return createWorkloadError(
    WorkloadErrorCode.DEVELOPER_NOT_FOUND,
    `Developer '${developerId}' not found in team registry`,
    { developer_id: developerId },
    'Verify the developer ID or register the developer first using team add'
  );
}

/**
 * Creates a "no tasks assigned" error.
 */
export function noTasksAssignedError(developerId: string, developerName?: string): WorkloadError {
  return createWorkloadError(
    WorkloadErrorCode.NO_TASKS_ASSIGNED,
    `Developer '${developerName || developerId}' has no tasks assigned`,
    { developer_id: developerId, developer_name: developerName },
    'Assign tasks to the developer or check the developer ID'
  );
}

/**
 * Creates a "workload calculation error".
 */
export function workloadCalculationError(
  calculationStep: string,
  details: string,
  developerId?: string
): WorkloadError {
  return createWorkloadError(
    WorkloadErrorCode.WORKLOAD_CALCULATION_ERROR,
    `Error calculating workload at step '${calculationStep}': ${details}`,
    { developer_id: developerId, calculation_step: calculationStep },
    'Check task data integrity and try again'
  );
}

/**
 * Creates an "invalid metrics query" error.
 */
export function invalidMetricsQueryError(
  invalidParam: string,
  expectedFormat: string,
  queryParams?: Record<string, unknown>
): WorkloadError {
  return createWorkloadError(
    WorkloadErrorCode.INVALID_METRICS_QUERY,
    `Invalid metrics query: parameter '${invalidParam}' is invalid. Expected ${expectedFormat}`,
    { query_params: queryParams },
    `Provide a valid value for '${invalidParam}'`
  );
}

/**
 * Creates an "insufficient data" error.
 */
export function insufficientDataError(
  dataSource: string,
  minimumRequired: string
): WorkloadError {
  return createWorkloadError(
    WorkloadErrorCode.INSUFFICIENT_DATA,
    `Insufficient data from '${dataSource}' to perform analysis. Minimum required: ${minimumRequired}`,
    { data_source: dataSource },
    `Ensure ${minimumRequired} is available before running analysis`
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Checks if a status string is a valid task status for workload calculations.
 */
export function isValidTaskStatusForWorkload(status: string): status is TaskStatusForWorkload {
  return TASK_STATUSES_FOR_WORKLOAD.includes(status as TaskStatusForWorkload);
}

/**
 * Checks if a status is an active task status (IN_PROGRESS or BLOCKED).
 */
export function isActiveTaskStatus(status: string): status is ActiveTaskStatus {
  return ACTIVE_TASK_STATUSES.includes(status as ActiveTaskStatus);
}

/**
 * Validates if a developer ID is valid format.
 */
export function isValidDeveloperIdForWorkload(developerId: string): boolean {
  return typeof developerId === 'string' && developerId.trim().length > 0;
}

/**
 * Validates threshold value for overload/underutilization detection.
 */
export function isValidThreshold(threshold: number): boolean {
  return typeof threshold === 'number' && threshold >= 0 && Number.isFinite(threshold);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates empty status counts.
 */
export function createEmptyStatusCounts(): StatusCounts {
  return {
    TODO: 0,
    READY: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    VERIFY: 0,
    DONE: 0,
  };
}

/**
 * Creates empty workload metrics.
 */
export function createEmptyWorkloadMetrics(): WorkloadMetrics {
  return {
    totalTasks: 0,
    tasksByStatus: createEmptyStatusCounts(),
    activeTasks: 0,
    completedTasks: 0,
    pendingTasks: 0,
    estimatedEffort: null,
    remainingEffort: null,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Calculates workload metrics from status counts.
 * @param statusCounts - The status counts to calculate from
 * @param estimatedEffort - Optional total estimated effort
 * @param completedEffort - Optional completed effort
 * @returns WorkloadMetrics
 */
export function calculateWorkloadMetrics(
  statusCounts: StatusCounts,
  estimatedEffort?: number | null,
  completedEffort?: number | null
): WorkloadMetrics {
  const totalTasks = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  const activeTasks = statusCounts.IN_PROGRESS + statusCounts.BLOCKED;
  const completedTasks = statusCounts.DONE;
  const pendingTasks = statusCounts.TODO + statusCounts.READY;

  const remainingEffort = estimatedEffort != null && completedEffort != null
    ? estimatedEffort - completedEffort
    : null;

  return {
    totalTasks,
    tasksByStatus: { ...statusCounts },
    activeTasks,
    completedTasks,
    pendingTasks,
    estimatedEffort: estimatedEffort ?? null,
    remainingEffort,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Calculates standard deviation of an array of numbers.
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Determines bottleneck severity based on the excess over threshold.
 */
export function determineBottleneckSeverity(
  count: number,
  threshold: number
): BottleneckSeverity {
  const excess = count - threshold;
  if (excess <= 1) return 'LOW';
  if (excess <= 3) return 'MEDIUM';
  if (excess <= 5) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Determines role bottleneck severity based on capacity ratio.
 */
export function determineRoleBottleneckSeverity(
  tasksPerDeveloper: number
): BottleneckSeverity {
  if (tasksPerDeveloper <= 2) return 'LOW';
  if (tasksPerDeveloper <= 4) return 'MEDIUM';
  if (tasksPerDeveloper <= 6) return 'HIGH';
  return 'CRITICAL';
}

/**
 * Creates a developer workload object.
 */
export function createDeveloperWorkload(
  developerId: string,
  developerName: string,
  roles: Role[],
  metrics: WorkloadMetrics,
  overloadThreshold: number = DEFAULT_BOTTLENECK_THRESHOLD,
  averageTaskCount: number = 0
): DeveloperWorkload {
  const isOverloaded = metrics.activeTasks > overloadThreshold;
  // Consider underutilized if below 50% of team average (and team average > 0)
  const isUnderutilized = averageTaskCount > 0 && metrics.totalTasks < averageTaskCount * 0.5;

  return {
    developerId,
    developerName,
    roles,
    metrics,
    isOverloaded,
    isUnderutilized,
  };
}

/**
 * Creates a bottleneck object for a developer.
 */
export function createDeveloperBottleneck(
  developerId: string,
  developerName: string,
  taskCount: number,
  threshold: number
): Bottleneck {
  const severity = determineBottleneckSeverity(taskCount, threshold);
  
  return {
    type: 'DEVELOPER',
    severity,
    developerId,
    developerName,
    taskCount,
    threshold,
    description: `Developer '${developerName}' has ${taskCount} active tasks, exceeding the threshold of ${threshold}`,
    recommendedAction: `Consider reassigning some tasks from '${developerName}' to reduce their workload`,
    identifiedAt: new Date().toISOString(),
  };
}

/**
 * Creates a bottleneck object for a role capacity issue.
 */
export function createRoleBottleneck(
  role: Role,
  taskCount: number,
  developerCount: number
): Bottleneck {
  const capacityRatio = developerCount > 0 ? taskCount / developerCount : taskCount;
  const severity = determineRoleBottleneckSeverity(capacityRatio);
  
  return {
    type: 'ROLE',
    severity,
    role,
    taskCount,
    capacityRatio,
    description: `Role '${role}' has ${taskCount} pending tasks with only ${developerCount} developer(s) available (${capacityRatio.toFixed(1)} tasks per developer)`,
    recommendedAction: developerCount === 0
      ? `Add developers with '${role}' role to the team`
      : `Consider adding more developers with '${role}' role or redistributing tasks`,
    identifiedAt: new Date().toISOString(),
  };
}

/**
 * Creates a rebalance recommendation.
 */
export function createRebalanceRecommendation(
  taskId: string,
  taskTitle: string,
  fromDeveloperId: string,
  fromDeveloperName: string,
  toDeveloperId: string,
  toDeveloperName: string,
  reason: string,
  impactScore: number
): RebalanceRecommendation {
  return {
    taskId,
    taskTitle,
    fromDeveloperId,
    fromDeveloperName,
    toDeveloperId,
    toDeveloperName,
    reason,
    impactScore,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Workload_Analyzer Interface
// =============================================================================

/**
 * Workload_Analyzer interface for calculating workload distribution
 * and identifying bottlenecks across team members.
 * 
 * Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3
 */
export interface Workload_Analyzer {
  // =========================================================================
  // Analysis operations
  // =========================================================================

  /**
   * Calculates workload metrics for a specific developer.
   * 
   * Requirements: 9.1, 9.2
   * 
   * @param developerId - The ID of the developer to analyze
   * @returns Result with WorkloadSummary on success or WorkloadError on failure
   * 
   * Errors:
   * - DEVELOPER_NOT_FOUND: If the developer doesn't exist
   * - WORKLOAD_CALCULATION_ERROR: If calculation fails
   */
  getDeveloperWorkload(developerId: string): Result<DeveloperWorkload, WorkloadError>;

  /**
   * Gets workload metrics for the entire team.
   * 
   * Requirements: 9.1
   * 
   * @returns Result with array of DeveloperWorkload on success or WorkloadError on failure
   * 
   * Errors:
   * - INSUFFICIENT_DATA: If no team members exist
   * - WORKLOAD_CALCULATION_ERROR: If calculation fails
   */
  getTeamWorkload(): Result<DeveloperWorkload[], WorkloadError>;

  /**
   * Gets the workload distribution analysis for the team.
   * 
   * Requirements: 9.1, 9.2, 9.3
   * 
   * @returns Result with WorkloadDistribution on success or WorkloadError on failure
   * 
   * Errors:
   * - INSUFFICIENT_DATA: If no team members or tasks exist
   * - WORKLOAD_CALCULATION_ERROR: If calculation fails
   */
  getWorkloadDistribution(): Result<WorkloadDistribution, WorkloadError>;

  /**
   * Identifies bottlenecks in the workflow.
   * 
   * Requirements: 10.1, 10.2, 10.3
   * 
   * @returns Array of identified bottlenecks (may be empty)
   */
  identifyBottlenecks(): Bottleneck[];

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets task count by status for a developer.
   * 
   * Requirements: 9.1
   * 
   * @param developerId - The ID of the developer
   * @returns Result with StatusCounts on success or WorkloadError on failure
   * 
   * Errors:
   * - DEVELOPER_NOT_FOUND: If the developer doesn't exist
   */
  getTaskCountByStatus(developerId: string): Result<StatusCounts, WorkloadError>;

  /**
   * Gets the estimated effort for a developer.
   * 
   * Requirements: 9.2
   * 
   * @param developerId - The ID of the developer
   * @returns Result with estimated effort (null if not available) or WorkloadError
   * 
   * Errors:
   * - DEVELOPER_NOT_FOUND: If the developer doesn't exist
   */
  getEstimatedEffort(developerId: string): Result<number | null, WorkloadError>;

  /**
   * Gets the team average tasks per developer.
   * 
   * @returns Team average (0 if no developers)
   */
  getTeamAverage(): number;

  /**
   * Finds developers with workload above the specified threshold.
   * 
   * Requirements: 10.1
   * 
   * @param threshold - The threshold for active tasks (defaults to DEFAULT_BOTTLENECK_THRESHOLD)
   * @returns Array of developer IDs with workload above threshold
   */
  getOverloadedDevelopers(threshold?: number): string[];

  /**
   * Finds developers with workload significantly below team average.
   * 
   * Requirements: 9.3
   * 
   * @param threshold - The percentage of average below which is considered underutilized (0-1, default 0.5)
   * @returns Array of developer IDs with capacity available
   */
  getUnderutilizedDevelopers(threshold?: number): string[];

  // =========================================================================
  // Recommendations
  // =========================================================================

  /**
   * Gets recommendations for rebalancing workload.
   * 
   * @returns Array of rebalance recommendations sorted by impact score
   */
  getRebalanceRecommendations(): RebalanceRecommendation[];

  /**
   * Suggests reassignment for a specific task to improve workload balance.
   * 
   * @param taskId - The ID of the task to potentially reassign
   * @returns Result with RebalanceRecommendation if suggestion available, null if no improvement possible, or WorkloadError
   * 
   * Errors:
   * - INVALID_METRICS_QUERY: If task ID is invalid
   * - INSUFFICIENT_DATA: If not enough data to make recommendation
   */
  suggestReassignment(taskId: string): Result<RebalanceRecommendation | null, WorkloadError>;
}

// =============================================================================
// Task Interface for Workload Analyzer
// =============================================================================

/**
 * Task data required by Workload_Analyzer.
 */
export interface TaskForWorkload {
  /** Unique task identifier */
  id: string;
  /** Task title */
  title: string;
  /** Current task status */
  status: TaskStatusForWorkload;
  /** Assignee developer ID (optional) */
  assignee?: string | null;
  /** Role required for this task (optional) */
  role_required?: Role | null;
  /** Estimated effort in story points or hours (optional) */
  estimated_effort?: number | null;
  /** Actual effort spent (optional) */
  actual_effort?: number | null;
}

/**
 * Team member data required by Workload_Analyzer.
 */
export interface TeamMemberForWorkload {
  /** Developer unique identifier */
  id: string;
  /** Developer display name */
  name: string;
  /** Developer's assigned roles */
  roles: Role[];
  /** Developer status */
  status: 'ACTIVE' | 'INACTIVE';
}

// =============================================================================
// Storage Interfaces
// =============================================================================

/**
 * Interface for task storage operations needed by Workload_Analyzer.
 */
export interface TaskStorageForWorkload {
  /**
   * Gets a task by its ID.
   * @param taskId - The ID of the task to retrieve
   * @returns The task if found, null otherwise
   */
  getTask(taskId: string): TaskForWorkload | null;

  /**
   * Gets all tasks.
   * @returns Array of all tasks
   */
  getAllTasks(): TaskForWorkload[];

  /**
   * Gets tasks assigned to a specific developer.
   * @param developerId - The developer ID to filter by
   * @returns Array of tasks assigned to the developer
   */
  getTasksByDeveloper(developerId: string): TaskForWorkload[];

  /**
   * Gets tasks requiring a specific role.
   * @param role - The role to filter by
   * @returns Array of tasks requiring the role
   */
  getTasksByRole(role: Role): TaskForWorkload[];
}

/**
 * Interface for team storage operations needed by Workload_Analyzer.
 */
export interface TeamStorageForWorkload {
  /**
   * Gets a team member by ID.
   * @param developerId - The developer ID
   * @returns The team member if found, null otherwise
   */
  getMember(developerId: string): TeamMemberForWorkload | null;

  /**
   * Gets all team members.
   * @returns Array of all team members
   */
  getAllMembers(): TeamMemberForWorkload[];

  /**
   * Gets team members with a specific role.
   * @param role - The role to filter by
   * @returns Array of team members with the role
   */
  getMembersByRole(role: Role): TeamMemberForWorkload[];

  /**
   * Validates if a developer ID exists.
   * @param developerId - The developer ID to validate
   * @returns true if developer exists, false otherwise
   */
  validateDeveloperId(developerId: string): boolean;
}

// =============================================================================
// In-Memory Storage Implementations
// =============================================================================

/**
 * In-memory task storage implementation for testing.
 */
export class InMemoryTaskStorageForWorkload implements TaskStorageForWorkload {
  private tasks: Map<string, TaskForWorkload> = new Map();

  /**
   * Adds a task to storage.
   */
  addTask(task: TaskForWorkload): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): TaskForWorkload | null {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : null;
  }

  /**
   * Gets all tasks.
   */
  getAllTasks(): TaskForWorkload[] {
    return Array.from(this.tasks.values()).map(t => ({ ...t }));
  }

  /**
   * Gets tasks assigned to a specific developer.
   */
  getTasksByDeveloper(developerId: string): TaskForWorkload[] {
    return this.getAllTasks().filter(t => t.assignee === developerId);
  }

  /**
   * Gets tasks requiring a specific role.
   */
  getTasksByRole(role: Role): TaskForWorkload[] {
    return this.getAllTasks().filter(t => t.role_required === role);
  }

  /**
   * Updates a task in storage.
   */
  updateTask(task: TaskForWorkload): void {
    this.tasks.set(task.id, { ...task });
  }

  /**
   * Removes a task from storage.
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
  }

  /**
   * Clears all tasks from storage.
   */
  clear(): void {
    this.tasks.clear();
  }

  /**
   * Gets the number of tasks in storage.
   */
  get size(): number {
    return this.tasks.size;
  }
}

/**
 * In-memory team storage implementation for testing.
 */
export class InMemoryTeamStorageForWorkload implements TeamStorageForWorkload {
  private members: Map<string, TeamMemberForWorkload> = new Map();

  /**
   * Adds a team member to storage.
   */
  addMember(member: TeamMemberForWorkload): void {
    this.members.set(member.id, { ...member, roles: [...member.roles] });
  }

  /**
   * Gets a team member by ID.
   */
  getMember(developerId: string): TeamMemberForWorkload | null {
    const member = this.members.get(developerId);
    return member ? { ...member, roles: [...member.roles] } : null;
  }

  /**
   * Gets all team members.
   */
  getAllMembers(): TeamMemberForWorkload[] {
    return Array.from(this.members.values()).map(m => ({ ...m, roles: [...m.roles] }));
  }

  /**
   * Gets team members with a specific role.
   */
  getMembersByRole(role: Role): TeamMemberForWorkload[] {
    return this.getAllMembers().filter(m => m.roles.includes(role) && m.status === 'ACTIVE');
  }

  /**
   * Validates if a developer ID exists.
   */
  validateDeveloperId(developerId: string): boolean {
    return this.members.has(developerId);
  }

  /**
   * Updates a team member in storage.
   */
  updateMember(member: TeamMemberForWorkload): void {
    this.members.set(member.id, { ...member, roles: [...member.roles] });
  }

  /**
   * Removes a team member from storage.
   */
  removeMember(developerId: string): void {
    this.members.delete(developerId);
  }

  /**
   * Clears all members from storage.
   */
  clear(): void {
    this.members.clear();
  }

  /**
   * Gets the number of members in storage.
   */
  get size(): number {
    return this.members.size;
  }
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for WorkloadAnalyzerImpl.
 */
export interface WorkloadAnalyzerConfig {
  /** Task storage backend */
  taskStorage: TaskStorageForWorkload;
  /** Team storage backend */
  teamStorage: TeamStorageForWorkload;
  /** Threshold for identifying bottlenecks (default: DEFAULT_BOTTLENECK_THRESHOLD) */
  bottleneckThreshold?: number;
  /** Threshold for underutilization (percentage of average, default: 0.5) */
  underutilizationThreshold?: number;
}

// =============================================================================
// WorkloadAnalyzerImpl Implementation
// =============================================================================

/**
 * Implementation of the Workload_Analyzer interface.
 * 
 * Calculates workload distribution and identifies bottlenecks across team members.
 * 
 * Requirements: 9.1, 9.2, 9.3, 10.1, 10.2, 10.3
 */
export class WorkloadAnalyzerImpl implements Workload_Analyzer {
  private config: WorkloadAnalyzerConfig;

  constructor(config: WorkloadAnalyzerConfig) {
    this.config = {
      ...config,
      bottleneckThreshold: config.bottleneckThreshold ?? DEFAULT_BOTTLENECK_THRESHOLD,
      underutilizationThreshold: config.underutilizationThreshold ?? 0.5,
    };
  }

  // =========================================================================
  // Analysis operations
  // =========================================================================

  /**
   * Calculates workload metrics for a specific developer.
   * 
   * Requirements: 9.1, 9.2
   * 
   * @param developerId - The ID of the developer to analyze
   * @returns Result with DeveloperWorkload on success or WorkloadError on failure
   */
  getDeveloperWorkload(developerId: string): Result<DeveloperWorkload, WorkloadError> {
    // Validate developer ID format
    if (!isValidDeveloperIdForWorkload(developerId)) {
      return err(createWorkloadError(
        WorkloadErrorCode.INVALID_METRICS_QUERY,
        'Developer ID must be a non-empty string',
        { developer_id: developerId },
        'Provide a valid developer ID'
      ));
    }

    // Check if developer exists
    const member = this.config.teamStorage.getMember(developerId);
    if (!member) {
      return err(developerNotFoundForWorkloadError(developerId));
    }

    // Get tasks assigned to this developer
    const tasks = this.config.taskStorage.getTasksByDeveloper(developerId);

    // Calculate status counts
    const statusCounts = this.calculateStatusCountsForTasks(tasks);

    // Calculate estimated effort
    const { totalEffort, completedEffort } = this.calculateEffortForTasks(tasks);

    // Calculate workload metrics
    const metrics = calculateWorkloadMetrics(statusCounts, totalEffort, completedEffort);

    // Get team average for comparison
    const teamAverage = this.getTeamAverage();

    // Create developer workload
    const workload = createDeveloperWorkload(
      member.id,
      member.name,
      member.roles,
      metrics,
      this.config.bottleneckThreshold,
      teamAverage
    );

    return ok(workload);
  }

  /**
   * Gets workload metrics for the entire team.
   * 
   * Requirements: 9.1
   * 
   * @returns Result with array of DeveloperWorkload on success or WorkloadError on failure
   */
  getTeamWorkload(): Result<DeveloperWorkload[], WorkloadError> {
    const members = this.config.teamStorage.getAllMembers();

    if (members.length === 0) {
      return err(insufficientDataError('team storage', 'at least one team member'));
    }

    const teamAverage = this.getTeamAverage();
    const workloads: DeveloperWorkload[] = [];

    for (const member of members) {
      // Get tasks assigned to this developer
      const tasks = this.config.taskStorage.getTasksByDeveloper(member.id);

      // Calculate status counts
      const statusCounts = this.calculateStatusCountsForTasks(tasks);

      // Calculate estimated effort
      const { totalEffort, completedEffort } = this.calculateEffortForTasks(tasks);

      // Calculate workload metrics
      const metrics = calculateWorkloadMetrics(statusCounts, totalEffort, completedEffort);

      // Create developer workload
      const workload = createDeveloperWorkload(
        member.id,
        member.name,
        member.roles,
        metrics,
        this.config.bottleneckThreshold,
        teamAverage
      );

      workloads.push(workload);
    }

    return ok(workloads);
  }

  /**
   * Gets the workload distribution analysis for the team.
   * 
   * Requirements: 9.1, 9.2, 9.3
   * 
   * @returns Result with WorkloadDistribution on success or WorkloadError on failure
   */
  getWorkloadDistribution(): Result<WorkloadDistribution, WorkloadError> {
    // Get team workloads
    const teamWorkloadResult = this.getTeamWorkload();
    if (!teamWorkloadResult.success) {
      return teamWorkloadResult;
    }

    const developerWorkloads = teamWorkloadResult.value;
    const allTasks = this.config.taskStorage.getAllTasks();
    const members = this.config.teamStorage.getAllMembers();

    // Calculate total tasks
    const totalTasks = allTasks.length;
    const totalDevelopers = developerWorkloads.length;

    // Calculate average tasks per developer
    const averageTasksPerDeveloper = totalDevelopers > 0 
      ? totalTasks / totalDevelopers 
      : 0;

    // Calculate standard deviation
    const taskCounts = developerWorkloads.map(w => w.metrics.totalTasks);
    const standardDeviation = calculateStandardDeviation(taskCounts);

    // Calculate team-wide status counts
    const teamStatusCounts = this.calculateTeamStatusCounts(allTasks);

    // Calculate workload stats by role
    const byRole = this.calculateRoleWorkloadStats(allTasks, members);

    // Find overloaded and underutilized developers
    // Requirement 9.3: Identify developers with significantly higher or lower workload
    const overloadedDeveloperIds = developerWorkloads
      .filter(w => w.isOverloaded)
      .map(w => w.developerId);

    const underutilizedDeveloperIds = developerWorkloads
      .filter(w => w.isUnderutilized)
      .map(w => w.developerId);

    const distribution: WorkloadDistribution = {
      totalTasks,
      totalDevelopers,
      averageTasksPerDeveloper,
      standardDeviation,
      developerWorkloads,
      teamStatusCounts,
      byRole,
      overloadedDeveloperIds,
      underutilizedDeveloperIds,
      calculatedAt: new Date().toISOString(),
    };

    return ok(distribution);
  }

  /**
   * Identifies bottlenecks in the workflow.
   * 
   * Requirements: 10.1, 10.2, 10.3
   * 
   * @returns Array of identified bottlenecks (may be empty)
   */
  identifyBottlenecks(): Bottleneck[] {
    const bottlenecks: Bottleneck[] = [];

    // Get team workloads
    const teamWorkloadResult = this.getTeamWorkload();
    if (teamWorkloadResult.success) {
      // Requirement 10.1: Identify developers with >3 tasks in IN_PROGRESS or BLOCKED status
      for (const workload of teamWorkloadResult.value) {
        if (workload.metrics.activeTasks > this.config.bottleneckThreshold!) {
          bottlenecks.push(
            createDeveloperBottleneck(
              workload.developerId,
              workload.developerName,
              workload.metrics.activeTasks,
              this.config.bottleneckThreshold!
            )
          );
        }
      }
    }

    // Requirement 10.2: Identify roles with more pending tasks than available developers
    const allTasks = this.config.taskStorage.getAllTasks();
    const members = this.config.teamStorage.getAllMembers();
    const roleStats = this.calculateRoleWorkloadStats(allTasks, members);

    for (const roleStat of roleStats) {
      if (roleStat.hasCapacityIssue) {
        bottlenecks.push(
          createRoleBottleneck(
            roleStat.role,
            roleStat.totalTasks,
            roleStat.developerCount
          )
        );
      }
    }

    return bottlenecks;
  }

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets task count by status for a developer.
   * 
   * Requirements: 9.1
   * 
   * @param developerId - The ID of the developer
   * @returns Result with StatusCounts on success or WorkloadError on failure
   */
  getTaskCountByStatus(developerId: string): Result<StatusCounts, WorkloadError> {
    // Validate developer ID format
    if (!isValidDeveloperIdForWorkload(developerId)) {
      return err(createWorkloadError(
        WorkloadErrorCode.INVALID_METRICS_QUERY,
        'Developer ID must be a non-empty string',
        { developer_id: developerId },
        'Provide a valid developer ID'
      ));
    }

    // Check if developer exists
    if (!this.config.teamStorage.validateDeveloperId(developerId)) {
      return err(developerNotFoundForWorkloadError(developerId));
    }

    // Get tasks assigned to this developer
    const tasks = this.config.taskStorage.getTasksByDeveloper(developerId);

    // Calculate status counts
    const statusCounts = this.calculateStatusCountsForTasks(tasks);

    return ok(statusCounts);
  }

  /**
   * Gets the estimated effort for a developer.
   * 
   * Requirements: 9.2
   * 
   * @param developerId - The ID of the developer
   * @returns Result with estimated effort (null if not available) or WorkloadError
   */
  getEstimatedEffort(developerId: string): Result<number | null, WorkloadError> {
    // Validate developer ID format
    if (!isValidDeveloperIdForWorkload(developerId)) {
      return err(createWorkloadError(
        WorkloadErrorCode.INVALID_METRICS_QUERY,
        'Developer ID must be a non-empty string',
        { developer_id: developerId },
        'Provide a valid developer ID'
      ));
    }

    // Check if developer exists
    if (!this.config.teamStorage.validateDeveloperId(developerId)) {
      return err(developerNotFoundForWorkloadError(developerId));
    }

    // Get tasks assigned to this developer
    const tasks = this.config.taskStorage.getTasksByDeveloper(developerId);

    // Calculate estimated effort
    const { totalEffort } = this.calculateEffortForTasks(tasks);

    return ok(totalEffort);
  }

  /**
   * Gets the team average tasks per developer.
   * 
   * @returns Team average (0 if no developers)
   */
  getTeamAverage(): number {
    const members = this.config.teamStorage.getAllMembers();
    if (members.length === 0) {
      return 0;
    }

    const allTasks = this.config.taskStorage.getAllTasks();
    
    // Count only assigned tasks for team average
    let assignedTaskCount = 0;
    for (const member of members) {
      const memberTasks = this.config.taskStorage.getTasksByDeveloper(member.id);
      assignedTaskCount += memberTasks.length;
    }

    return assignedTaskCount / members.length;
  }

  /**
   * Finds developers with workload above the specified threshold.
   * 
   * Requirements: 10.1
   * 
   * @param threshold - The threshold for active tasks (defaults to DEFAULT_BOTTLENECK_THRESHOLD)
   * @returns Array of developer IDs with workload above threshold
   */
  getOverloadedDevelopers(threshold?: number): string[] {
    const actualThreshold = threshold ?? this.config.bottleneckThreshold ?? DEFAULT_BOTTLENECK_THRESHOLD;
    const overloaded: string[] = [];

    const members = this.config.teamStorage.getAllMembers();
    for (const member of members) {
      const tasks = this.config.taskStorage.getTasksByDeveloper(member.id);
      const statusCounts = this.calculateStatusCountsForTasks(tasks);
      const activeTasks = statusCounts.IN_PROGRESS + statusCounts.BLOCKED;

      if (activeTasks > actualThreshold) {
        overloaded.push(member.id);
      }
    }

    return overloaded;
  }

  /**
   * Finds developers with workload significantly below team average.
   * 
   * Requirements: 9.3
   * 
   * @param threshold - The percentage of average below which is considered underutilized (0-1, default 0.5)
   * @returns Array of developer IDs with capacity available
   */
  getUnderutilizedDevelopers(threshold?: number): string[] {
    const actualThreshold = threshold ?? this.config.underutilizationThreshold ?? 0.5;
    const teamAverage = this.getTeamAverage();
    
    if (teamAverage === 0) {
      return [];
    }

    const underutilized: string[] = [];
    const members = this.config.teamStorage.getAllMembers();

    for (const member of members) {
      const tasks = this.config.taskStorage.getTasksByDeveloper(member.id);
      if (tasks.length < teamAverage * actualThreshold) {
        underutilized.push(member.id);
      }
    }

    return underutilized;
  }

  // =========================================================================
  // Recommendations
  // =========================================================================

  /**
   * Gets recommendations for rebalancing workload.
   * 
   * @returns Array of rebalance recommendations sorted by impact score
   */
  getRebalanceRecommendations(): RebalanceRecommendation[] {
    const recommendations: RebalanceRecommendation[] = [];

    // Get overloaded and underutilized developers
    const overloadedIds = this.getOverloadedDevelopers();
    const underutilizedIds = this.getUnderutilizedDevelopers();

    if (overloadedIds.length === 0 || underutilizedIds.length === 0) {
      return recommendations;
    }

    // For each overloaded developer, find tasks that could be reassigned
    for (const overloadedId of overloadedIds) {
      const overloadedMember = this.config.teamStorage.getMember(overloadedId);
      if (!overloadedMember) continue;

      const tasks = this.config.taskStorage.getTasksByDeveloper(overloadedId);

      // Look at TODO and READY tasks as candidates for reassignment
      const reassignableTasks = tasks.filter(
        t => t.status === 'TODO' || t.status === 'READY'
      );

      for (const task of reassignableTasks) {
        // Find an underutilized developer with the required role
        for (const underutilizedId of underutilizedIds) {
          const underutilizedMember = this.config.teamStorage.getMember(underutilizedId);
          if (!underutilizedMember) continue;

          // Check if developer has the required role (if specified)
          if (task.role_required) {
            if (!underutilizedMember.roles.includes(task.role_required)) {
              continue;
            }
          }

          // Calculate impact score (higher = more beneficial)
          const overloadedTasks = this.config.taskStorage.getTasksByDeveloper(overloadedId).length;
          const underutilizedTasks = this.config.taskStorage.getTasksByDeveloper(underutilizedId).length;
          const impactScore = overloadedTasks - underutilizedTasks;

          recommendations.push(
            createRebalanceRecommendation(
              task.id,
              task.title,
              overloadedId,
              overloadedMember.name,
              underutilizedId,
              underutilizedMember.name,
              `Move task from overloaded developer (${overloadedTasks} tasks) to underutilized developer (${underutilizedTasks} tasks)`,
              impactScore
            )
          );

          // Only recommend one target per task
          break;
        }
      }
    }

    // Sort by impact score (highest first)
    return recommendations.sort((a, b) => b.impactScore - a.impactScore);
  }

  /**
   * Suggests reassignment for a specific task to improve workload balance.
   * 
   * @param taskId - The ID of the task to potentially reassign
   * @returns Result with RebalanceRecommendation if suggestion available, null if no improvement possible, or WorkloadError
   */
  suggestReassignment(taskId: string): Result<RebalanceRecommendation | null, WorkloadError> {
    // Validate task ID
    if (!taskId || typeof taskId !== 'string' || taskId.trim() === '') {
      return err(invalidMetricsQueryError('taskId', 'a non-empty string'));
    }

    // Get the task
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(createWorkloadError(
        WorkloadErrorCode.INVALID_METRICS_QUERY,
        `Task '${taskId}' not found`,
        { query_params: { taskId } },
        'Verify the task ID is correct'
      ));
    }

    // Check if task is assignable (not in progress or done)
    if (task.status === 'IN_PROGRESS' || task.status === 'DONE' || task.status === 'VERIFY') {
      return ok(null); // Cannot reassign tasks that are in progress or done
    }

    // Get current assignee's workload
    const currentAssignee = task.assignee;
    if (!currentAssignee) {
      return ok(null); // Task is not assigned, no reassignment needed
    }

    const currentMember = this.config.teamStorage.getMember(currentAssignee);
    if (!currentMember) {
      return ok(null);
    }

    const currentTasks = this.config.taskStorage.getTasksByDeveloper(currentAssignee);
    const currentTaskCount = currentTasks.length;

    // Find a developer with fewer tasks and the required role
    const allMembers = this.config.teamStorage.getAllMembers();
    let bestCandidate: { member: TeamMemberForWorkload; taskCount: number } | null = null;

    for (const member of allMembers) {
      if (member.id === currentAssignee || member.status !== 'ACTIVE') {
        continue;
      }

      // Check if developer has the required role
      if (task.role_required && !member.roles.includes(task.role_required)) {
        continue;
      }

      const memberTaskCount = this.config.taskStorage.getTasksByDeveloper(member.id).length;

      // Only suggest if target has significantly fewer tasks
      if (memberTaskCount < currentTaskCount - 1) {
        if (!bestCandidate || memberTaskCount < bestCandidate.taskCount) {
          bestCandidate = { member, taskCount: memberTaskCount };
        }
      }
    }

    if (!bestCandidate) {
      return ok(null);
    }

    const impactScore = currentTaskCount - bestCandidate.taskCount;
    const recommendation = createRebalanceRecommendation(
      task.id,
      task.title,
      currentAssignee,
      currentMember.name,
      bestCandidate.member.id,
      bestCandidate.member.name,
      `Reassigning would reduce workload imbalance from ${currentTaskCount} tasks to ${bestCandidate.taskCount} tasks`,
      impactScore
    );

    return ok(recommendation);
  }

  // =========================================================================
  // Private helper methods
  // =========================================================================

  /**
   * Calculates status counts for a list of tasks.
   */
  private calculateStatusCountsForTasks(tasks: TaskForWorkload[]): StatusCounts {
    const counts = createEmptyStatusCounts();

    for (const task of tasks) {
      if (isValidTaskStatusForWorkload(task.status)) {
        counts[task.status]++;
      }
    }

    return counts;
  }

  /**
   * Calculates team-wide status counts.
   */
  private calculateTeamStatusCounts(tasks: TaskForWorkload[]): StatusCounts {
    return this.calculateStatusCountsForTasks(tasks);
  }

  /**
   * Calculates effort metrics for a list of tasks.
   */
  private calculateEffortForTasks(tasks: TaskForWorkload[]): {
    totalEffort: number | null;
    completedEffort: number | null;
  } {
    let totalEffort: number | null = null;
    let completedEffort: number | null = null;
    let hasEstimates = false;

    for (const task of tasks) {
      if (task.estimated_effort != null) {
        hasEstimates = true;
        totalEffort = (totalEffort ?? 0) + task.estimated_effort;

        if (task.status === 'DONE') {
          completedEffort = (completedEffort ?? 0) + (task.actual_effort ?? task.estimated_effort);
        }
      }
    }

    // Only return values if at least one task has estimates
    return {
      totalEffort: hasEstimates ? totalEffort : null,
      completedEffort: hasEstimates ? completedEffort : null,
    };
  }

  /**
   * Calculates workload stats by role.
   * 
   * Requirements: 10.2
   */
  private calculateRoleWorkloadStats(
    tasks: TaskForWorkload[],
    members: TeamMemberForWorkload[]
  ): RoleWorkloadStats[] {
    const roleStats: RoleWorkloadStats[] = [];

    for (const role of VALID_ROLES) {
      // Count developers with this role
      const developersWithRole = members.filter(
        m => m.roles.includes(role) && m.status === 'ACTIVE'
      );
      const developerCount = developersWithRole.length;

      // Count tasks requiring this role (excluding DONE tasks)
      const tasksForRole = tasks.filter(
        t => t.role_required === role && t.status !== 'DONE'
      );
      const totalTasks = tasksForRole.length;

      // Calculate tasks per developer
      const tasksPerDeveloper = developerCount > 0 ? totalTasks / developerCount : totalTasks;

      // Determine if there's a capacity issue (more tasks than developers)
      const hasCapacityIssue = totalTasks > developerCount && totalTasks > 0;

      roleStats.push({
        role,
        developerCount,
        totalTasks,
        tasksPerDeveloper,
        hasCapacityIssue,
      });
    }

    return roleStats;
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { Result, ok, err, Role, VALID_ROLES };
