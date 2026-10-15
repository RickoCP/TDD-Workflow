/**
 * Dependency Resolver - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Dependency_Resolver component
 * which analyzes and manages task dependencies, including cross-role dependencies.
 * 
 * Requirements: 7.1, 7.2
 */

import { Result, ok, err, Role } from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid dependency types.
 * Requirements: 7.2
 */
export const DEPENDENCY_TYPES = ['blocking', 'non_blocking'] as const;

/**
 * Task statuses relevant to dependency resolution.
 */
export const TASK_STATUSES_FOR_DEPS = [
  'TODO',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'VERIFY',
  'DONE',
] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Dependency type derived from valid dependency types constant.
 * Requirements: 7.2
 */
export type DependencyType = typeof DEPENDENCY_TYPES[number];

/**
 * Task status type for dependency operations.
 */
export type TaskStatusForDeps = typeof TASK_STATUSES_FOR_DEPS[number];

/**
 * Dependency specification.
 * Requirements: 7.1, 7.2
 */
export interface Dependency {
  /** ID of the task that has the dependency */
  taskId: string;
  /** ID of the task this task depends on */
  dependsOn: string;
  /** Type of dependency - blocking or non_blocking */
  type: DependencyType;
  /** Reason for the dependency (optional) */
  reason?: string;
  /** Role of the source task (for cross-role visualization) */
  sourceRole?: Role;
  /** Role of the target task (for cross-role visualization) */
  targetRole?: Role;
}

/**
 * Cycle detection result returned by detectCycles method.
 * Requirements: 7.5
 */
export interface CycleDetectionResult {
  /** Whether a cycle was detected */
  hasCycle: boolean;
  /** The path of task IDs forming the cycle (if any) */
  cyclePath: string[];
  /** Human-readable description of the cycle */
  description?: string;
}

/**
 * Mermaid diagram output for visualization.
 * Requirements: 8.1, 8.4
 */
export interface MermaidDiagram {
  /** The Mermaid diagram syntax */
  content: string;
  /** Diagram type (e.g., 'flowchart', 'graph') */
  type: string;
  /** Task IDs on the critical path */
  criticalPath: string[];
  /** Cross-role dependencies highlighted */
  crossRoleDependencies: Dependency[];
}

/**
 * Task type used by Dependency_Resolver.
 */
export interface TaskForDeps {
  /** Unique task identifier */
  id: string;
  /** Task title */
  title: string;
  /** Current task status */
  status: TaskStatusForDeps;
  /** Role required for this task (optional) */
  role_required?: Role;
  /** Assignee developer ID (optional) */
  assignee?: string;
  /** Dependencies for this task */
  depends_on?: DependencyInput[];
}

/**
 * Input format for dependency specification (matches YAML schema).
 */
export interface DependencyInput {
  /** ID of the task this task depends on */
  task_id: string;
  /** Type of dependency */
  type: DependencyType;
  /** Reason for the dependency (optional) */
  reason?: string;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Dependency error codes following the design specification.
 * Error codes in range 1200-1299.
 */
export enum DependencyErrorCode {
  /** Cycle detected in dependency graph */
  CIRCULAR_DEPENDENCY = 1201,
  /** Referenced task doesn't exist */
  DEPENDENCY_NOT_FOUND = 1202,
  /** Type not blocking/non_blocking */
  INVALID_DEPENDENCY_TYPE = 1203,
  /** Task depends on itself */
  SELF_DEPENDENCY = 1204,
  /** Cannot start due to blocking dependency */
  BLOCKING_DEP_UNSATISFIED = 1205,
  /** Cannot complete due to non-blocking dependency */
  NON_BLOCKING_DEP_UNSATISFIED = 1206,
  /** Task not found in storage */
  TASK_NOT_FOUND = 1207,
  /** Dependency already exists */
  DEPENDENCY_ALREADY_EXISTS = 1208,
}

/**
 * Dependency error structure following the design specification.
 */
export interface DependencyError {
  /** Error code from DependencyErrorCode enum */
  code: DependencyErrorCode;
  /** Error category */
  category: 'DEPENDENCY_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    task_id?: string;
    depends_on?: string;
    dependency_type?: string;
    cycle_path?: string[];
    unsatisfied_dependencies?: string[];
    valid_types?: readonly string[];
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
 * Creates a DependencyError with the given code and details.
 */
export function createDependencyError(
  code: DependencyErrorCode,
  message: string,
  context?: DependencyError['context'],
  suggested_action?: string
): DependencyError {
  return {
    code,
    category: 'DEPENDENCY_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "circular dependency" error.
 * Requirements: 7.5
 */
export function circularDependencyError(taskId: string, dependsOn: string, cyclePath: string[]): DependencyError {
  return createDependencyError(
    DependencyErrorCode.CIRCULAR_DEPENDENCY,
    `Adding dependency from '${taskId}' to '${dependsOn}' would create a circular dependency: ${cyclePath.join(' → ')}`,
    { task_id: taskId, depends_on: dependsOn, cycle_path: cyclePath },
    'Remove one of the dependencies in the cycle to break the circular reference'
  );
}

/**
 * Creates a "dependency not found" error.
 */
export function dependencyNotFoundError(taskId: string, dependsOn: string): DependencyError {
  return createDependencyError(
    DependencyErrorCode.DEPENDENCY_NOT_FOUND,
    `Dependency task '${dependsOn}' not found`,
    { task_id: taskId, depends_on: dependsOn },
    'Verify the task ID exists or create the dependency task first'
  );
}

/**
 * Creates an "invalid dependency type" error.
 */
export function invalidDependencyTypeError(taskId: string, invalidType: string): DependencyError {
  return createDependencyError(
    DependencyErrorCode.INVALID_DEPENDENCY_TYPE,
    `Invalid dependency type '${invalidType}'`,
    { task_id: taskId, dependency_type: invalidType, valid_types: DEPENDENCY_TYPES },
    `Use one of the valid dependency types: ${DEPENDENCY_TYPES.join(', ')}`
  );
}

/**
 * Creates a "self dependency" error.
 */
export function selfDependencyError(taskId: string): DependencyError {
  return createDependencyError(
    DependencyErrorCode.SELF_DEPENDENCY,
    `Task '${taskId}' cannot depend on itself`,
    { task_id: taskId, depends_on: taskId },
    'Remove the self-reference from the dependency list'
  );
}

/**
 * Creates a "blocking dependency unsatisfied" error.
 * Requirements: 7.3
 */
export function blockingDepUnsatisfiedError(taskId: string, unsatisfiedDeps: string[]): DependencyError {
  return createDependencyError(
    DependencyErrorCode.BLOCKING_DEP_UNSATISFIED,
    `Task '${taskId}' cannot transition to IN_PROGRESS: blocking dependencies are not satisfied`,
    { task_id: taskId, unsatisfied_dependencies: unsatisfiedDeps },
    `Complete the following blocking dependencies first: ${unsatisfiedDeps.join(', ')}`
  );
}

/**
 * Creates a "non-blocking dependency unsatisfied" error.
 * Requirements: 7.4
 */
export function nonBlockingDepUnsatisfiedError(taskId: string, unsatisfiedDeps: string[]): DependencyError {
  return createDependencyError(
    DependencyErrorCode.NON_BLOCKING_DEP_UNSATISFIED,
    `Task '${taskId}' cannot transition to DONE: non-blocking dependencies are not satisfied`,
    { task_id: taskId, unsatisfied_dependencies: unsatisfiedDeps },
    `Complete the following non-blocking dependencies first: ${unsatisfiedDeps.join(', ')}`
  );
}

/**
 * Creates a "task not found" error.
 */
export function taskNotFoundForDepError(taskId: string): DependencyError {
  return createDependencyError(
    DependencyErrorCode.TASK_NOT_FOUND,
    `Task '${taskId}' not found`,
    { task_id: taskId },
    'Verify the task ID or create the task first'
  );
}

/**
 * Creates a "dependency already exists" error.
 */
export function dependencyAlreadyExistsError(taskId: string, dependsOn: string): DependencyError {
  return createDependencyError(
    DependencyErrorCode.DEPENDENCY_ALREADY_EXISTS,
    `Dependency from '${taskId}' to '${dependsOn}' already exists`,
    { task_id: taskId, depends_on: dependsOn },
    'Use removeDependency first if you want to change the dependency type'
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates if a string is a valid dependency type.
 * Requirements: 7.2
 */
export function isValidDependencyType(type: string): type is DependencyType {
  return DEPENDENCY_TYPES.includes(type as DependencyType);
}

/**
 * Validates if a task ID follows valid format.
 * Task IDs must be non-empty strings.
 */
export function isValidTaskIdForDep(taskId: string): boolean {
  return typeof taskId === 'string' && taskId.trim().length > 0;
}

/**
 * Validates a dependency input.
 * Returns a Result with void on success or DependencyError on failure.
 */
export function validateDependencyInput(
  taskId: string,
  dependsOn: string,
  type: string
): Result<void, DependencyError> {
  // Validate task ID
  if (!isValidTaskIdForDep(taskId)) {
    return err(taskNotFoundForDepError(taskId || ''));
  }

  // Validate dependsOn ID
  if (!isValidTaskIdForDep(dependsOn)) {
    return err(dependencyNotFoundError(taskId, dependsOn || ''));
  }

  // Check for self-dependency
  if (taskId === dependsOn) {
    return err(selfDependencyError(taskId));
  }

  // Validate dependency type
  if (!isValidDependencyType(type)) {
    return err(invalidDependencyTypeError(taskId, type));
  }

  return ok(undefined);
}

// =============================================================================
// Dependency Helper Functions
// =============================================================================

/**
 * Creates a new Dependency object.
 */
export function createDependency(
  taskId: string,
  dependsOn: string,
  type: DependencyType,
  reason?: string,
  sourceRole?: Role,
  targetRole?: Role
): Dependency {
  return {
    taskId,
    dependsOn,
    type,
    reason,
    sourceRole,
    targetRole,
  };
}

/**
 * Converts DependencyInput to Dependency.
 */
export function dependencyInputToDependency(
  taskId: string,
  input: DependencyInput,
  sourceRole?: Role,
  targetRole?: Role
): Dependency {
  return createDependency(
    taskId,
    input.task_id,
    input.type,
    input.reason,
    sourceRole,
    targetRole
  );
}

/**
 * Checks if a dependency is cross-role (different roles).
 * Requirements: 8.2
 */
export function isCrossRoleDependency(dependency: Dependency): boolean {
  return (
    dependency.sourceRole !== undefined &&
    dependency.targetRole !== undefined &&
    dependency.sourceRole !== dependency.targetRole
  );
}

/**
 * Determines if a task status is considered "complete" for dependency purposes.
 */
export function isTaskComplete(status: TaskStatusForDeps): boolean {
  return status === 'DONE';
}

// =============================================================================
// Dependency_Resolver Interface
// =============================================================================

/**
 * Dependency_Resolver interface for analyzing and managing task dependencies,
 * including cross-role dependencies.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4
 */
export interface Dependency_Resolver {
  // =========================================================================
  // Dependency operations
  // =========================================================================

  /**
   * Adds a dependency between two tasks.
   * 
   * Requirements: 7.1, 7.2, 7.5
   * 
   * @param taskId - The ID of the dependent task
   * @param dependsOn - The ID of the task this task depends on
   * @param type - The type of dependency (blocking or non_blocking)
   * @returns Result with void on success or DependencyError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If either task doesn't exist
   * - SELF_DEPENDENCY: If taskId equals dependsOn
   * - INVALID_DEPENDENCY_TYPE: If type is not blocking or non_blocking
   * - CIRCULAR_DEPENDENCY: If adding this dependency would create a cycle
   * - DEPENDENCY_ALREADY_EXISTS: If the dependency already exists
   */
  addDependency(taskId: string, dependsOn: string, type: DependencyType): Result<void, DependencyError>;

  /**
   * Removes a dependency between two tasks.
   * 
   * @param taskId - The ID of the dependent task
   * @param dependsOn - The ID of the dependency to remove
   * @returns Result with void on success or DependencyError on failure
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - DEPENDENCY_NOT_FOUND: If the dependency doesn't exist
   */
  removeDependency(taskId: string, dependsOn: string): Result<void, DependencyError>;

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets all dependencies for a task.
   * 
   * @param taskId - The ID of the task
   * @returns Array of dependencies (empty if none)
   */
  getDependencies(taskId: string): Dependency[];

  /**
   * Gets all tasks that depend on a specific task.
   * 
   * @param taskId - The ID of the task
   * @returns Array of dependent tasks (empty if none)
   */
  getDependents(taskId: string): TaskForDeps[];

  /**
   * Gets all blocking dependencies for a task that are not yet satisfied.
   * 
   * @param taskId - The ID of the task
   * @returns Array of unsatisfied blocking dependencies
   */
  getBlockingDependencies(taskId: string): Dependency[];

  /**
   * Calculates the critical path through the dependency graph.
   * The critical path includes tasks that block the most downstream work.
   * 
   * Requirements: 8.3
   * 
   * @returns Array of tasks on the critical path
   */
  getCriticalPath(): TaskForDeps[];

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Detects if adding a dependency would create a cycle.
   * 
   * Requirements: 7.5
   * 
   * @param taskId - The ID of the dependent task
   * @param dependsOn - The ID of the potential dependency
   * @returns CycleDetectionResult indicating if a cycle would be created
   */
  detectCycles(taskId: string, dependsOn: string): CycleDetectionResult;

  /**
   * Validates if a task can transition to IN_PROGRESS status.
   * Checks that all blocking dependencies are satisfied (in DONE status).
   * 
   * Requirements: 7.3
   * 
   * @param taskId - The ID of the task
   * @returns Result with void on success or DependencyError if blocked
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - BLOCKING_DEP_UNSATISFIED: If blocking dependencies are not complete
   */
  canTransitionToInProgress(taskId: string): Result<void, DependencyError>;

  /**
   * Validates if a task can transition to DONE status.
   * Checks that all non-blocking dependencies are satisfied (in DONE status).
   * 
   * Requirements: 7.4
   * 
   * @param taskId - The ID of the task
   * @returns Result with void on success or DependencyError if blocked
   * 
   * Errors:
   * - TASK_NOT_FOUND: If the task doesn't exist
   * - NON_BLOCKING_DEP_UNSATISFIED: If non-blocking dependencies are not complete
   */
  canTransitionToDone(taskId: string): Result<void, DependencyError>;

  // =========================================================================
  // Visualization
  // =========================================================================

  /**
   * Generates a dependency graph in Mermaid diagram format.
   * 
   * Requirements: 8.1, 8.2, 8.3, 8.4
   * 
   * @returns MermaidDiagram with the visualization
   */
  generateDependencyGraph(): MermaidDiagram;
}

// =============================================================================
// Task Storage Interface for Dependency Resolver
// =============================================================================

/**
 * Interface for task storage operations needed by Dependency_Resolver.
 * Allows the implementation to work with different storage backends.
 */
export interface TaskStorageForDeps {
  /**
   * Gets a task by its ID.
   * @param taskId - The ID of the task to retrieve
   * @returns The task if found, null otherwise
   */
  getTask(taskId: string): TaskForDeps | null;

  /**
   * Updates a task in storage.
   * @param task - The task to update
   */
  updateTask(task: TaskForDeps): void;

  /**
   * Gets all tasks.
   * @returns Array of all tasks
   */
  getAllTasks(): TaskForDeps[];
}

/**
 * In-memory task storage implementation for testing and development.
 */
export class InMemoryTaskStorageForDeps implements TaskStorageForDeps {
  private tasks: Map<string, TaskForDeps> = new Map();

  /**
   * Adds a task to storage.
   * @param task - The task to add
   */
  addTask(task: TaskForDeps): void {
    this.tasks.set(task.id, { ...task, depends_on: task.depends_on ? [...task.depends_on] : [] });
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): TaskForDeps | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    return { 
      ...task, 
      depends_on: task.depends_on ? [...task.depends_on] : [] 
    };
  }

  /**
   * Updates a task in storage.
   */
  updateTask(task: TaskForDeps): void {
    this.tasks.set(task.id, { ...task, depends_on: task.depends_on ? [...task.depends_on] : [] });
  }

  /**
   * Gets all tasks.
   */
  getAllTasks(): TaskForDeps[] {
    return Array.from(this.tasks.values()).map(t => ({ 
      ...t, 
      depends_on: t.depends_on ? [...t.depends_on] : [] 
    }));
  }

  /**
   * Removes a task from storage.
   * @param taskId - The ID of the task to remove
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

// =============================================================================
// DependencyResolverImpl Implementation
// =============================================================================

/**
 * Configuration for DependencyResolverImpl
 */
export interface DependencyResolverConfig {
  /** Task storage backend */
  taskStorage: TaskStorageForDeps;
}

/**
 * Concrete implementation of Dependency_Resolver interface.
 * Manages task dependencies with cycle detection, blocking/non-blocking support,
 * and Mermaid visualization generation.
 * 
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4
 */
export class DependencyResolverImpl implements Dependency_Resolver {
  private config: DependencyResolverConfig;
  /** In-memory adjacency list for fast dependency lookups: taskId -> dependsOn[] */
  private dependencyGraph: Map<string, Dependency[]> = new Map();
  /** Reverse lookup: dependsOn -> taskIds that depend on it */
  private dependentGraph: Map<string, Set<string>> = new Map();

  constructor(config: DependencyResolverConfig) {
    this.config = config;
    this.rebuildGraphFromStorage();
  }

  /**
   * Rebuilds the in-memory dependency graph from task storage.
   * Called during initialization and when needed for consistency.
   */
  private rebuildGraphFromStorage(): void {
    this.dependencyGraph.clear();
    this.dependentGraph.clear();

    const tasks = this.config.taskStorage.getAllTasks();
    for (const task of tasks) {
      if (task.depends_on && task.depends_on.length > 0) {
        const dependencies: Dependency[] = [];
        for (const depInput of task.depends_on) {
          const targetTask = this.config.taskStorage.getTask(depInput.task_id);
          const dependency = createDependency(
            task.id,
            depInput.task_id,
            depInput.type,
            depInput.reason,
            task.role_required,
            targetTask?.role_required
          );
          dependencies.push(dependency);

          // Update reverse lookup
          if (!this.dependentGraph.has(depInput.task_id)) {
            this.dependentGraph.set(depInput.task_id, new Set());
          }
          this.dependentGraph.get(depInput.task_id)!.add(task.id);
        }
        this.dependencyGraph.set(task.id, dependencies);
      }
    }
  }

  // =========================================================================
  // Dependency operations
  // =========================================================================

  /**
   * Adds a dependency between two tasks.
   * 
   * Requirements: 7.1, 7.2, 7.5
   * 
   * @param taskId - The ID of the dependent task
   * @param dependsOn - The ID of the task this task depends on
   * @param type - The type of dependency (blocking or non_blocking)
   * @returns Result with void on success or DependencyError on failure
   */
  addDependency(taskId: string, dependsOn: string, type: DependencyType): Result<void, DependencyError> {
    // Step 1: Validate input
    const validationResult = validateDependencyInput(taskId, dependsOn, type);
    if (!validationResult.success) {
      return validationResult;
    }

    // Step 2: Verify source task exists
    const sourceTask = this.config.taskStorage.getTask(taskId);
    if (!sourceTask) {
      return err(taskNotFoundForDepError(taskId));
    }

    // Step 3: Verify target task exists
    const targetTask = this.config.taskStorage.getTask(dependsOn);
    if (!targetTask) {
      return err(dependencyNotFoundError(taskId, dependsOn));
    }

    // Step 4: Check if dependency already exists
    const existingDeps = this.dependencyGraph.get(taskId) || [];
    const alreadyExists = existingDeps.some(dep => dep.dependsOn === dependsOn);
    if (alreadyExists) {
      return err(dependencyAlreadyExistsError(taskId, dependsOn));
    }

    // Step 5: Detect cycles using DFS
    const cycleResult = this.detectCycles(taskId, dependsOn);
    if (cycleResult.hasCycle) {
      return err(circularDependencyError(taskId, dependsOn, cycleResult.cyclePath));
    }

    // Step 6: Add the dependency
    const newDependency = createDependency(
      taskId,
      dependsOn,
      type,
      undefined, // reason is optional
      sourceTask.role_required,
      targetTask.role_required
    );

    // Update in-memory graph
    if (!this.dependencyGraph.has(taskId)) {
      this.dependencyGraph.set(taskId, []);
    }
    this.dependencyGraph.get(taskId)!.push(newDependency);

    // Update reverse lookup
    if (!this.dependentGraph.has(dependsOn)) {
      this.dependentGraph.set(dependsOn, new Set());
    }
    this.dependentGraph.get(dependsOn)!.add(taskId);

    // Step 7: Update task in storage with new dependency
    const depInput: DependencyInput = {
      task_id: dependsOn,
      type: type,
    };

    const updatedDepsOn = sourceTask.depends_on ? [...sourceTask.depends_on] : [];
    updatedDepsOn.push(depInput);
    
    const updatedTask: TaskForDeps = {
      ...sourceTask,
      depends_on: updatedDepsOn,
    };
    this.config.taskStorage.updateTask(updatedTask);

    return ok(undefined);
  }

  /**
   * Removes a dependency between two tasks.
   * 
   * @param taskId - The ID of the dependent task
   * @param dependsOn - The ID of the dependency to remove
   * @returns Result with void on success or DependencyError on failure
   */
  removeDependency(taskId: string, dependsOn: string): Result<void, DependencyError> {
    // Validate task exists
    const sourceTask = this.config.taskStorage.getTask(taskId);
    if (!sourceTask) {
      return err(taskNotFoundForDepError(taskId));
    }

    // Check if dependency exists
    const existingDeps = this.dependencyGraph.get(taskId) || [];
    const depIndex = existingDeps.findIndex(dep => dep.dependsOn === dependsOn);
    if (depIndex === -1) {
      return err(dependencyNotFoundError(taskId, dependsOn));
    }

    // Remove from in-memory graph
    existingDeps.splice(depIndex, 1);
    if (existingDeps.length === 0) {
      this.dependencyGraph.delete(taskId);
    }

    // Update reverse lookup
    const dependents = this.dependentGraph.get(dependsOn);
    if (dependents) {
      dependents.delete(taskId);
      if (dependents.size === 0) {
        this.dependentGraph.delete(dependsOn);
      }
    }

    // Update task in storage
    const updatedDepsOn = sourceTask.depends_on?.filter(d => d.task_id !== dependsOn) || [];
    const updatedTask: TaskForDeps = {
      ...sourceTask,
      depends_on: updatedDepsOn,
    };
    this.config.taskStorage.updateTask(updatedTask);

    return ok(undefined);
  }

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Gets all dependencies for a task.
   * 
   * @param taskId - The ID of the task
   * @returns Array of dependencies (empty if none)
   */
  getDependencies(taskId: string): Dependency[] {
    return this.dependencyGraph.get(taskId) || [];
  }

  /**
   * Gets all tasks that depend on a specific task.
   * 
   * @param taskId - The ID of the task
   * @returns Array of dependent tasks (empty if none)
   */
  getDependents(taskId: string): TaskForDeps[] {
    const dependentIds = this.dependentGraph.get(taskId);
    if (!dependentIds || dependentIds.size === 0) {
      return [];
    }

    const tasks: TaskForDeps[] = [];
    for (const depId of dependentIds) {
      const task = this.config.taskStorage.getTask(depId);
      if (task) {
        tasks.push(task);
      }
    }
    return tasks;
  }

  /**
   * Gets all blocking dependencies for a task that are not yet satisfied.
   * 
   * @param taskId - The ID of the task
   * @returns Array of unsatisfied blocking dependencies
   */
  getBlockingDependencies(taskId: string): Dependency[] {
    const dependencies = this.dependencyGraph.get(taskId) || [];
    return dependencies.filter(dep => {
      if (dep.type !== 'blocking') return false;
      
      const depTask = this.config.taskStorage.getTask(dep.dependsOn);
      return depTask && !isTaskComplete(depTask.status);
    });
  }

  /**
   * Calculates the critical path through the dependency graph.
   * The critical path includes tasks that block the most downstream work.
   * 
   * Requirements: 8.3
   * 
   * @returns Array of tasks on the critical path
   */
  getCriticalPath(): TaskForDeps[] {
    const allTasks = this.config.taskStorage.getAllTasks();
    const taskScores = new Map<string, number>();

    // Calculate downstream impact for each task (number of tasks that depend on it, directly or indirectly)
    const calculateDownstreamImpact = (taskId: string, visited: Set<string> = new Set()): number => {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);

      const directDependents = this.dependentGraph.get(taskId);
      if (!directDependents || directDependents.size === 0) {
        return 0;
      }

      let impact = directDependents.size;
      for (const depId of directDependents) {
        impact += calculateDownstreamImpact(depId, visited);
      }
      return impact;
    };

    // Calculate scores for all incomplete tasks
    for (const task of allTasks) {
      if (!isTaskComplete(task.status)) {
        taskScores.set(task.id, calculateDownstreamImpact(task.id));
      }
    }

    // Sort by score (highest impact first) and return top tasks
    const sortedTasks = allTasks
      .filter(t => !isTaskComplete(t.status) && taskScores.has(t.id))
      .sort((a, b) => (taskScores.get(b.id) || 0) - (taskScores.get(a.id) || 0));

    // Return tasks with non-zero impact (they're on critical paths)
    return sortedTasks.filter(t => (taskScores.get(t.id) || 0) > 0);
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Detects if adding a dependency would create a cycle using DFS.
   * 
   * Requirements: 7.5
   * 
   * @param taskId - The ID of the dependent task (source)
   * @param dependsOn - The ID of the potential dependency (target)
   * @returns CycleDetectionResult indicating if a cycle would be created
   */
  detectCycles(taskId: string, dependsOn: string): CycleDetectionResult {
    // If adding taskId -> dependsOn, we need to check if dependsOn can reach taskId
    // This would mean: dependsOn -> ... -> taskId -> dependsOn (cycle!)
    
    const visited = new Set<string>();
    const path: string[] = [];

    /**
     * DFS to find if we can reach 'target' starting from 'current'
     */
    const dfs = (current: string, target: string): boolean => {
      if (current === target) {
        path.push(current);
        return true;
      }

      if (visited.has(current)) {
        return false;
      }

      visited.add(current);
      path.push(current);

      // Get all tasks that 'current' depends on
      const dependencies = this.dependencyGraph.get(current) || [];
      for (const dep of dependencies) {
        if (dfs(dep.dependsOn, target)) {
          return true;
        }
      }

      path.pop();
      return false;
    };

    // Check if dependsOn can reach taskId through existing dependencies
    // If it can, then adding taskId -> dependsOn would create a cycle
    if (dfs(dependsOn, taskId)) {
      // Build the cycle path: dependsOn -> ... -> taskId -> dependsOn
      const cyclePath = [...path, dependsOn];
      return {
        hasCycle: true,
        cyclePath,
        description: `Adding dependency would create cycle: ${cyclePath.join(' → ')}`,
      };
    }

    return {
      hasCycle: false,
      cyclePath: [],
    };
  }

  /**
   * Validates if a task can transition to IN_PROGRESS status.
   * Checks that all blocking dependencies are satisfied (in DONE status).
   * 
   * Requirements: 7.3
   * 
   * @param taskId - The ID of the task
   * @returns Result with void on success or DependencyError if blocked
   */
  canTransitionToInProgress(taskId: string): Result<void, DependencyError> {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForDepError(taskId));
    }

    const unsatisfiedBlockingDeps = this.getBlockingDependencies(taskId);
    if (unsatisfiedBlockingDeps.length > 0) {
      const unsatisfiedIds = unsatisfiedBlockingDeps.map(d => d.dependsOn);
      return err(blockingDepUnsatisfiedError(taskId, unsatisfiedIds));
    }

    return ok(undefined);
  }

  /**
   * Validates if a task can transition to DONE status.
   * Checks that all non-blocking dependencies are satisfied (in DONE status).
   * 
   * Requirements: 7.4
   * 
   * @param taskId - The ID of the task
   * @returns Result with void on success or DependencyError if blocked
   */
  canTransitionToDone(taskId: string): Result<void, DependencyError> {
    const task = this.config.taskStorage.getTask(taskId);
    if (!task) {
      return err(taskNotFoundForDepError(taskId));
    }

    const dependencies = this.dependencyGraph.get(taskId) || [];
    const unsatisfiedNonBlocking = dependencies.filter(dep => {
      if (dep.type !== 'non_blocking') return false;
      
      const depTask = this.config.taskStorage.getTask(dep.dependsOn);
      return depTask && !isTaskComplete(depTask.status);
    });

    if (unsatisfiedNonBlocking.length > 0) {
      const unsatisfiedIds = unsatisfiedNonBlocking.map(d => d.dependsOn);
      return err(nonBlockingDepUnsatisfiedError(taskId, unsatisfiedIds));
    }

    return ok(undefined);
  }

  // =========================================================================
  // Visualization
  // =========================================================================

  /**
   * Generates a dependency graph in Mermaid diagram format.
   * 
   * Requirements: 8.1, 8.2, 8.3, 8.4
   * 
   * @returns MermaidDiagram with the visualization
   */
  generateDependencyGraph(): MermaidDiagram {
    const allTasks = this.config.taskStorage.getAllTasks();
    const criticalPath = this.getCriticalPath();
    const criticalPathIds = new Set(criticalPath.map(t => t.id));
    const crossRoleDeps: Dependency[] = [];
    
    const lines: string[] = ['graph TD'];

    // Add task nodes with status styling
    for (const task of allTasks) {
      const nodeLabel = `${task.id}["${task.title}"]`;
      lines.push(`    ${nodeLabel}`);
      
      // Add styling for task status
      const statusClass = this.getStatusClass(task.status);
      if (statusClass) {
        lines.push(`    class ${task.id} ${statusClass}`);
      }
      
      // Highlight critical path tasks
      if (criticalPathIds.has(task.id)) {
        lines.push(`    style ${task.id} stroke:#f00,stroke-width:3px`);
      }
    }

    // Add dependency edges
    for (const task of allTasks) {
      const dependencies = this.dependencyGraph.get(task.id) || [];
      for (const dep of dependencies) {
        const edgeStyle = dep.type === 'blocking' ? '-->' : '-.->';
        const edgeLabel = isCrossRoleDependency(dep) ? '|cross-role|' : '';
        lines.push(`    ${dep.dependsOn} ${edgeStyle}${edgeLabel} ${task.id}`);
        
        if (isCrossRoleDependency(dep)) {
          crossRoleDeps.push(dep);
        }
      }
    }

    // Add style definitions
    lines.push('');
    lines.push('    classDef todo fill:#fff,stroke:#333');
    lines.push('    classDef inProgress fill:#ff9,stroke:#333');
    lines.push('    classDef done fill:#9f9,stroke:#333');
    lines.push('    classDef blocked fill:#f99,stroke:#333');

    return {
      content: lines.join('\n'),
      type: 'flowchart',
      criticalPath: criticalPath.map(t => t.id),
      crossRoleDependencies: crossRoleDeps,
    };
  }

  /**
   * Returns CSS class name for task status.
   */
  private getStatusClass(status: TaskStatusForDeps): string {
    switch (status) {
      case 'TODO':
      case 'READY':
        return 'todo';
      case 'IN_PROGRESS':
        return 'inProgress';
      case 'DONE':
        return 'done';
      case 'BLOCKED':
        return 'blocked';
      default:
        return '';
    }
  }
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export { Result, ok, err, Role };
