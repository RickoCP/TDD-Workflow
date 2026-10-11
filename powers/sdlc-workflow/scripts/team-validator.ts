/**
 * Team Validator - Validation Script for Team Configuration
 * 
 * This module provides comprehensive validation for team configuration in project-state.yaml.
 * It validates team members, assignments, dependencies, parallel groups, and handoff checklists.
 * 
 * Requirements: 1.3, 1.5, 4.1, 4.2, 5.2, 7.5, 11.2
 */

import {
  TeamMember,
  Role,
  VALID_ROLES,
  isValidRole,
  TeamSection,
  ProjectState,
  parseProjectStateYaml,
} from './team-manager';

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid team member statuses.
 */
export const VALID_MEMBER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

/**
 * Validation error codes for team validation.
 * Error codes in range 2000-2099 for validation-specific errors.
 */
export enum ValidationErrorCode {
  // Team Member Validation (2000-2019)
  DUPLICATE_MEMBER_ID = 2001,
  EMPTY_MEMBER_NAME = 2002,
  INVALID_ROLE = 2003,
  NO_ROLES_ASSIGNED = 2004,
  INVALID_MEMBER_STATUS = 2005,
  INVALID_REGISTERED_AT = 2006,
  MISSING_MEMBER_ID = 2007,
  
  // Assignment Validation (2020-2039)
  ASSIGNEE_NOT_FOUND = 2020,
  INVALID_ROLE_REQUIRED = 2021,
  ASSIGNEE_MISSING_REQUIRED_ROLE = 2022,
  
  // Dependency Validation (2040-2059)
  CIRCULAR_DEPENDENCY = 2040,
  DEPENDENCY_TASK_NOT_FOUND = 2041,
  SELF_DEPENDENCY = 2042,
  INVALID_DEPENDENCY_TYPE = 2043,
  
  // Parallel Group Validation (2060-2079)
  INTERNAL_BLOCKING_DEPENDENCY = 2060,
  PARALLEL_GROUP_EMPTY = 2061,
  DUPLICATE_GROUP_ID = 2062,
  TASK_NOT_FOUND_IN_GROUP = 2063,
  
  // Handoff Validation (2080-2099)
  EMPTY_HANDOFF_CHECKLIST = 2080,
  INVALID_SOURCE_ROLE = 2081,
  INVALID_TARGET_ROLE = 2082,
  DUPLICATE_HANDOFF_POINT_ID = 2083,
  DUPLICATE_CHECKLIST_ITEM_ID = 2084,
  
  // Statistics Validation (2100-2119)
  STATISTICS_MISMATCH = 2100,
  ROLE_COUNT_MISMATCH = 2101,
}

/**
 * Severity levels for validation issues.
 */
export type ValidationSeverity = 'error' | 'warning' | 'info';

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  /** Error code for programmatic handling */
  code: ValidationErrorCode;
  /** Severity of the issue */
  severity: ValidationSeverity;
  /** Human-readable message describing the issue */
  message: string;
  /** Path to the problematic data (e.g., "team.members[0].roles") */
  path: string;
  /** The problematic value (if applicable) */
  value?: unknown;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * Validation result containing overall status and issues.
 */
export interface ValidationResult {
  /** Whether the configuration is valid (no errors) */
  valid: boolean;
  /** Number of errors found */
  errorCount: number;
  /** Number of warnings found */
  warningCount: number;
  /** List of all validation issues */
  issues: ValidationIssue[];
  /** Timestamp of validation */
  validatedAt: string;
}

/**
 * Options for validation behavior.
 */
export interface ValidationOptions {
  /** Include warnings in the result (default: true) */
  includeWarnings?: boolean;
  /** Validate dependency cycles (default: true) */
  validateDependencies?: boolean;
  /** Validate parallel group internal dependencies (default: true) */
  validateParallelGroups?: boolean;
  /** Validate handoff checklists (default: true) */
  validateHandoffs?: boolean;
  /** Validate assignment references (default: true) */
  validateAssignments?: boolean;
  /** Validate statistics accuracy (default: true) */
  validateStatistics?: boolean;
}

/**
 * Dependency information for cycle detection.
 */
interface DependencyInfo {
  taskId: string;
  dependsOn: string;
  type: 'blocking' | 'non_blocking';
}

/**
 * Parallel group information from project state.
 */
interface ParallelGroupInfo {
  id: string;
  name: string;
  tasks: string[];
  status: string;
}

/**
 * Handoff point information from project state.
 */
interface HandoffPointInfo {
  id: string;
  name: string;
  source_role: string;
  target_role: string;
  checklist: Array<{
    id: string;
    description: string;
    required: boolean;
  }>;
}

/**
 * Task information for validation.
 */
interface TaskInfo {
  id: string;
  assignee?: string;
  role_required?: string;
  depends_on?: DependencyInfo[];
  parallel_group?: string;
}

/**
 * Extended project state with all validation-relevant sections.
 */
interface ExtendedProjectState extends ProjectState {
  parallel_groups?: ParallelGroupInfo[];
  handoff_points?: HandoffPointInfo[];
  tasks_data?: Record<string, TaskInfo>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Creates a validation issue.
 */
function createIssue(
  code: ValidationErrorCode,
  severity: ValidationSeverity,
  message: string,
  path: string,
  value?: unknown,
  suggestion?: string
): ValidationIssue {
  return {
    code,
    severity,
    message,
    path,
    value,
    suggestion,
  };
}

/**
 * Checks if a string is a valid ISO 8601 timestamp.
 */
function isValidIsoTimestamp(timestamp: string): boolean {
  if (!timestamp || typeof timestamp !== 'string') return false;
  const date = new Date(timestamp);
  return !isNaN(date.getTime());
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates team member IDs are unique.
 * Requirements: 1.5
 */
export function validateMemberIdUniqueness(members: TeamMember[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, number>();
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const id = member.id;
    
    if (!id || typeof id !== 'string') {
      issues.push(createIssue(
        ValidationErrorCode.MISSING_MEMBER_ID,
        'error',
        `Team member at index ${i} is missing an ID`,
        `team.members[${i}].id`,
        id,
        'Provide a unique, non-empty ID for the team member'
      ));
      continue;
    }
    
    if (seenIds.has(id)) {
      const firstIndex = seenIds.get(id)!;
      issues.push(createIssue(
        ValidationErrorCode.DUPLICATE_MEMBER_ID,
        'error',
        `Duplicate team member ID "${id}" found at indices ${firstIndex} and ${i}`,
        `team.members[${i}].id`,
        id,
        'Each team member must have a unique ID'
      ));
    } else {
      seenIds.set(id, i);
    }
  }
  
  return issues;
}

/**
 * Validates team member names are non-empty.
 */
export function validateMemberNames(members: TeamMember[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const name = member.name;
    
    if (!name || typeof name !== 'string' || name.trim() === '') {
      issues.push(createIssue(
        ValidationErrorCode.EMPTY_MEMBER_NAME,
        'error',
        `Team member "${member.id || `at index ${i}`}" has an empty or invalid name`,
        `team.members[${i}].name`,
        name,
        'Provide a non-empty name for the team member'
      ));
    }
  }
  
  return issues;
}

/**
 * Validates all roles are valid.
 * Requirements: 1.3, 4.2
 */
export function validateMemberRoles(members: TeamMember[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const memberId = member.id || `at index ${i}`;
    
    // Check if roles array exists and is non-empty
    if (!member.roles || !Array.isArray(member.roles)) {
      issues.push(createIssue(
        ValidationErrorCode.NO_ROLES_ASSIGNED,
        'error',
        `Team member "${memberId}" has no roles array`,
        `team.members[${i}].roles`,
        member.roles,
        'Assign at least one valid role to the team member'
      ));
      continue;
    }
    
    if (member.roles.length === 0) {
      issues.push(createIssue(
        ValidationErrorCode.NO_ROLES_ASSIGNED,
        'error',
        `Team member "${memberId}" has no roles assigned`,
        `team.members[${i}].roles`,
        member.roles,
        `Assign at least one of: ${VALID_ROLES.join(', ')}`
      ));
      continue;
    }
    
    // Validate each role
    for (let j = 0; j < member.roles.length; j++) {
      const role = member.roles[j];
      if (!isValidRole(role)) {
        issues.push(createIssue(
          ValidationErrorCode.INVALID_ROLE,
          'error',
          `Team member "${memberId}" has invalid role "${role}"`,
          `team.members[${i}].roles[${j}]`,
          role,
          `Use one of: ${VALID_ROLES.join(', ')}`
        ));
      }
    }
  }
  
  return issues;
}

/**
 * Validates team member status values.
 */
export function validateMemberStatus(members: TeamMember[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const memberId = member.id || `at index ${i}`;
    
    if (member.status && !VALID_MEMBER_STATUSES.includes(member.status as any)) {
      issues.push(createIssue(
        ValidationErrorCode.INVALID_MEMBER_STATUS,
        'error',
        `Team member "${memberId}" has invalid status "${member.status}"`,
        `team.members[${i}].status`,
        member.status,
        `Use one of: ${VALID_MEMBER_STATUSES.join(', ')}`
      ));
    }
  }
  
  return issues;
}

/**
 * Validates registered_at timestamps.
 */
export function validateMemberTimestamps(members: TeamMember[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    const memberId = member.id || `at index ${i}`;
    
    if (member.registered_at && !isValidIsoTimestamp(member.registered_at)) {
      issues.push(createIssue(
        ValidationErrorCode.INVALID_REGISTERED_AT,
        'warning',
        `Team member "${memberId}" has invalid registered_at timestamp`,
        `team.members[${i}].registered_at`,
        member.registered_at,
        'Use a valid ISO 8601 timestamp format'
      ));
    }
  }
  
  return issues;
}

/**
 * Validates assignment references exist.
 * Requirements: 4.1
 */
export function validateAssignmentReferences(
  tasks: Record<string, TaskInfo>,
  memberIds: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (const [taskId, task] of Object.entries(tasks)) {
    // Validate assignee exists
    if (task.assignee && !memberIds.has(task.assignee)) {
      issues.push(createIssue(
        ValidationErrorCode.ASSIGNEE_NOT_FOUND,
        'error',
        `Task "${taskId}" is assigned to non-existent developer "${task.assignee}"`,
        `tasks.${taskId}.assignee`,
        task.assignee,
        'Assign to an existing team member or register the developer first'
      ));
    }
    
    // Validate role_required is valid
    if (task.role_required && !isValidRole(task.role_required)) {
      issues.push(createIssue(
        ValidationErrorCode.INVALID_ROLE_REQUIRED,
        'error',
        `Task "${taskId}" has invalid role_required "${task.role_required}"`,
        `tasks.${taskId}.role_required`,
        task.role_required,
        `Use one of: ${VALID_ROLES.join(', ')}`
      ));
    }
  }
  
  return issues;
}

/**
 * Validates assignee has the required role.
 * Requirements: 4.2
 */
export function validateAssigneeRoles(
  tasks: Record<string, TaskInfo>,
  memberRoles: Map<string, Role[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.assignee && task.role_required) {
      const roles = memberRoles.get(task.assignee);
      
      if (roles && !roles.includes(task.role_required as Role)) {
        issues.push(createIssue(
          ValidationErrorCode.ASSIGNEE_MISSING_REQUIRED_ROLE,
          'error',
          `Task "${taskId}" requires role "${task.role_required}" but assignee "${task.assignee}" has roles: ${roles.join(', ')}`,
          `tasks.${taskId}.assignee`,
          task.assignee,
          `Assign to a developer with the "${task.role_required}" role`
        ));
      }
    }
  }
  
  return issues;
}

/**
 * Detects circular dependencies in the dependency graph.
 * Requirements: 7.5
 */
export function validateDependencyCycles(
  dependencies: Map<string, string[]>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  
  function detectCycle(taskId: string, path: string[]): string[] | null {
    if (recursionStack.has(taskId)) {
      // Found a cycle - return the path that forms the cycle
      const cycleStart = path.indexOf(taskId);
      return [...path.slice(cycleStart), taskId];
    }
    
    if (visited.has(taskId)) {
      return null;
    }
    
    visited.add(taskId);
    recursionStack.add(taskId);
    
    const deps = dependencies.get(taskId) || [];
    for (const dep of deps) {
      const cycle = detectCycle(dep, [...path, taskId]);
      if (cycle) {
        return cycle;
      }
    }
    
    recursionStack.delete(taskId);
    return null;
  }
  
  // Check for cycles starting from each task
  const allTasks = new Set([
    ...dependencies.keys(),
    ...Array.from(dependencies.values()).flat(),
  ]);
  
  for (const taskId of allTasks) {
    if (!visited.has(taskId)) {
      const cycle = detectCycle(taskId, []);
      if (cycle) {
        issues.push(createIssue(
          ValidationErrorCode.CIRCULAR_DEPENDENCY,
          'error',
          `Circular dependency detected: ${cycle.join(' -> ')}`,
          'tasks.dependencies',
          cycle,
          'Remove one of the dependencies to break the cycle'
        ));
        break; // Report only the first cycle found
      }
    }
  }
  
  return issues;
}

/**
 * Validates self-dependencies (a task depending on itself).
 */
export function validateSelfDependencies(
  tasks: Record<string, TaskInfo>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.depends_on) {
      for (const dep of task.depends_on) {
        if (dep.dependsOn === taskId || dep.taskId === taskId) {
          issues.push(createIssue(
            ValidationErrorCode.SELF_DEPENDENCY,
            'error',
            `Task "${taskId}" has a self-dependency`,
            `tasks.${taskId}.depends_on`,
            dep,
            'Remove the self-dependency'
          ));
        }
      }
    }
  }
  
  return issues;
}

/**
 * Validates parallel groups have no internal blocking dependencies.
 * Requirements: 5.2
 */
export function validateParallelGroupDependencies(
  groups: ParallelGroupInfo[],
  dependencies: Map<string, Array<{ dependsOn: string; type: string }>>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenGroupIds = new Set<string>();
  
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    
    // Check for duplicate group IDs
    if (seenGroupIds.has(group.id)) {
      issues.push(createIssue(
        ValidationErrorCode.DUPLICATE_GROUP_ID,
        'error',
        `Duplicate parallel group ID "${group.id}"`,
        `parallel_groups[${i}].id`,
        group.id,
        'Each parallel group must have a unique ID'
      ));
    } else {
      seenGroupIds.add(group.id);
    }
    
    // Check for empty task list
    if (!group.tasks || group.tasks.length === 0) {
      issues.push(createIssue(
        ValidationErrorCode.PARALLEL_GROUP_EMPTY,
        'error',
        `Parallel group "${group.id}" has no tasks`,
        `parallel_groups[${i}].tasks`,
        group.tasks,
        'Add at least one task to the parallel group'
      ));
      continue;
    }
    
    // Check for internal blocking dependencies
    const groupTaskSet = new Set(group.tasks);
    
    for (const taskId of group.tasks) {
      const taskDeps = dependencies.get(taskId) || [];
      
      for (const dep of taskDeps) {
        if (dep.type === 'blocking' && groupTaskSet.has(dep.dependsOn)) {
          issues.push(createIssue(
            ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY,
            'error',
            `Parallel group "${group.id}" has internal blocking dependency: "${taskId}" blocks on "${dep.dependsOn}"`,
            `parallel_groups[${i}].tasks`,
            { taskId, dependsOn: dep.dependsOn },
            'Remove the blocking dependency or remove one task from the parallel group'
          ));
        }
      }
    }
  }
  
  return issues;
}

/**
 * Validates handoff checklists have at least one item.
 * Requirements: 11.2
 */
export function validateHandoffChecklists(
  handoffPoints: HandoffPointInfo[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  
  for (let i = 0; i < handoffPoints.length; i++) {
    const hp = handoffPoints[i];
    
    // Check for duplicate handoff point IDs
    if (seenIds.has(hp.id)) {
      issues.push(createIssue(
        ValidationErrorCode.DUPLICATE_HANDOFF_POINT_ID,
        'error',
        `Duplicate handoff point ID "${hp.id}"`,
        `handoff_points[${i}].id`,
        hp.id,
        'Each handoff point must have a unique ID'
      ));
    } else {
      seenIds.add(hp.id);
    }
    
    // Validate source_role
    if (!isValidRole(hp.source_role)) {
      issues.push(createIssue(
        ValidationErrorCode.INVALID_SOURCE_ROLE,
        'error',
        `Handoff point "${hp.id}" has invalid source_role "${hp.source_role}"`,
        `handoff_points[${i}].source_role`,
        hp.source_role,
        `Use one of: ${VALID_ROLES.join(', ')}`
      ));
    }
    
    // Validate target_role
    if (!isValidRole(hp.target_role)) {
      issues.push(createIssue(
        ValidationErrorCode.INVALID_TARGET_ROLE,
        'error',
        `Handoff point "${hp.id}" has invalid target_role "${hp.target_role}"`,
        `handoff_points[${i}].target_role`,
        hp.target_role,
        `Use one of: ${VALID_ROLES.join(', ')}`
      ));
    }
    
    // Check for empty checklist
    if (!hp.checklist || hp.checklist.length === 0) {
      issues.push(createIssue(
        ValidationErrorCode.EMPTY_HANDOFF_CHECKLIST,
        'error',
        `Handoff point "${hp.id}" has no checklist items`,
        `handoff_points[${i}].checklist`,
        hp.checklist,
        'Add at least one checklist item to the handoff point'
      ));
      continue;
    }
    
    // Check for duplicate checklist item IDs
    const seenChecklistIds = new Set<string>();
    for (let j = 0; j < hp.checklist.length; j++) {
      const item = hp.checklist[j];
      if (seenChecklistIds.has(item.id)) {
        issues.push(createIssue(
          ValidationErrorCode.DUPLICATE_CHECKLIST_ITEM_ID,
          'error',
          `Handoff point "${hp.id}" has duplicate checklist item ID "${item.id}"`,
          `handoff_points[${i}].checklist[${j}].id`,
          item.id,
          'Each checklist item must have a unique ID within the handoff point'
        ));
      } else {
        seenChecklistIds.add(item.id);
      }
    }
  }
  
  return issues;
}

/**
 * Validates team statistics match actual member data.
 */
export function validateTeamStatistics(team: TeamSection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  
  // Check total_members
  if (team.statistics.total_members !== team.members.length) {
    issues.push(createIssue(
      ValidationErrorCode.STATISTICS_MISMATCH,
      'warning',
      `Team statistics total_members (${team.statistics.total_members}) doesn't match actual member count (${team.members.length})`,
      'team.statistics.total_members',
      team.statistics.total_members,
      'Update team statistics to match actual member count'
    ));
  }
  
  // Calculate actual role counts
  const actualRoleCounts: Record<string, number> = {
    frontend: 0,
    backend: 0,
    qa: 0,
    devops: 0,
    fullstack: 0,
    lead: 0,
  };
  
  for (const member of team.members) {
    if (member.status === 'ACTIVE' && member.roles) {
      for (const role of member.roles) {
        if (isValidRole(role)) {
          actualRoleCounts[role]++;
        }
      }
    }
  }
  
  // Compare with statistics
  for (const role of VALID_ROLES) {
    const expected = actualRoleCounts[role];
    const actual = team.statistics.by_role[role] ?? 0;
    
    if (expected !== actual) {
      issues.push(createIssue(
        ValidationErrorCode.ROLE_COUNT_MISMATCH,
        'warning',
        `Team statistics by_role.${role} (${actual}) doesn't match actual count (${expected})`,
        `team.statistics.by_role.${role}`,
        actual,
        `Update team statistics to reflect actual ${role} count of ${expected}`
      ));
    }
  }
  
  return issues;
}

// =============================================================================
// Main Validation Function
// =============================================================================

/**
 * Validates the complete team configuration from project state.
 * 
 * @param state - The project state to validate
 * @param options - Validation options
 * @returns Validation result with all issues found
 */
export function validateTeamConfiguration(
  state: ExtendedProjectState,
  options: ValidationOptions = {}
): ValidationResult {
  const {
    includeWarnings = true,
    validateDependencies = true,
    validateParallelGroups = true,
    validateHandoffs = true,
    validateAssignments = true,
    validateStatistics = true,
  } = options;
  
  const allIssues: ValidationIssue[] = [];
  const members = state.team?.members || [];
  
  // Build helper data structures
  const memberIds = new Set(members.map(m => m.id).filter(Boolean));
  const memberRoles = new Map<string, Role[]>();
  for (const member of members) {
    if (member.id && member.roles) {
      memberRoles.set(member.id, member.roles.filter(r => isValidRole(r)));
    }
  }
  
  // === Team Member Validation ===
  
  // Validate unique member IDs (Requirement 1.5)
  allIssues.push(...validateMemberIdUniqueness(members));
  
  // Validate non-empty member names
  allIssues.push(...validateMemberNames(members));
  
  // Validate roles (Requirements 1.3, 4.2)
  allIssues.push(...validateMemberRoles(members));
  
  // Validate member status
  allIssues.push(...validateMemberStatus(members));
  
  // Validate timestamps
  allIssues.push(...validateMemberTimestamps(members));
  
  // === Assignment Validation ===
  
  if (validateAssignments && state.tasks_data) {
    // Validate assignment references exist (Requirement 4.1)
    allIssues.push(...validateAssignmentReferences(state.tasks_data, memberIds));
    
    // Validate assignee has required role (Requirement 4.2)
    allIssues.push(...validateAssigneeRoles(state.tasks_data, memberRoles));
  }
  
  // === Dependency Validation ===
  
  if (validateDependencies && state.tasks_data) {
    // Build dependency graph
    const dependencyGraph = new Map<string, string[]>();
    const detailedDeps = new Map<string, Array<{ dependsOn: string; type: string }>>();
    
    for (const [taskId, task] of Object.entries(state.tasks_data)) {
      if (task.depends_on) {
        const deps: string[] = [];
        const detailed: Array<{ dependsOn: string; type: string }> = [];
        
        for (const dep of task.depends_on) {
          const dependsOnId = dep.dependsOn || dep.taskId;
          if (dependsOnId) {
            deps.push(dependsOnId);
            detailed.push({ dependsOn: dependsOnId, type: dep.type || 'blocking' });
          }
        }
        
        if (deps.length > 0) {
          dependencyGraph.set(taskId, deps);
          detailedDeps.set(taskId, detailed);
        }
      }
    }
    
    // Validate self-dependencies
    allIssues.push(...validateSelfDependencies(state.tasks_data));
    
    // Validate no circular dependencies (Requirement 7.5)
    allIssues.push(...validateDependencyCycles(dependencyGraph));
    
    // === Parallel Group Validation ===
    
    if (validateParallelGroups && state.parallel_groups) {
      // Validate parallel groups have no internal blocking dependencies (Requirement 5.2)
      allIssues.push(...validateParallelGroupDependencies(state.parallel_groups, detailedDeps));
    }
  }
  
  // === Handoff Validation ===
  
  if (validateHandoffs && state.handoff_points) {
    // Validate handoff checklists have at least one item (Requirement 11.2)
    allIssues.push(...validateHandoffChecklists(state.handoff_points));
  }
  
  // === Statistics Validation ===
  
  if (validateStatistics && state.team) {
    allIssues.push(...validateTeamStatistics(state.team));
  }
  
  // Filter issues based on options
  const filteredIssues = includeWarnings
    ? allIssues
    : allIssues.filter(issue => issue.severity === 'error');
  
  // Calculate counts
  const errorCount = filteredIssues.filter(i => i.severity === 'error').length;
  const warningCount = filteredIssues.filter(i => i.severity === 'warning').length;
  
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues: filteredIssues,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates team configuration from a YAML file path.
 * 
 * @param filePath - Path to the project-state.yaml file
 * @param options - Validation options
 * @returns Validation result
 */
export function validateTeamConfigurationFromFile(
  filePath: string,
  options: ValidationOptions = {}
): ValidationResult {
  try {
    const fs = require('fs');
    const content = fs.readFileSync(filePath, 'utf8');
    const state = parseProjectStateYaml(content) as ExtendedProjectState;
    return validateTeamConfiguration(state, options);
  } catch (error) {
    // Return a result with a single error for file read failures
    return {
      valid: false,
      errorCount: 1,
      warningCount: 0,
      issues: [{
        code: ValidationErrorCode.MISSING_MEMBER_ID, // Reusing a code for simplicity
        severity: 'error',
        message: `Failed to read or parse project-state.yaml: ${error}`,
        path: filePath,
      }],
      validatedAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// CLI Support
// =============================================================================

/**
 * Formats validation results for console output.
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = [];
  
  lines.push('='.repeat(60));
  lines.push('Team Configuration Validation Report');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Status: ${result.valid ? '✓ VALID' : '✗ INVALID'}`);
  lines.push(`Errors: ${result.errorCount}`);
  lines.push(`Warnings: ${result.warningCount}`);
  lines.push(`Validated at: ${result.validatedAt}`);
  lines.push('');
  
  if (result.issues.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('Issues:');
    lines.push('-'.repeat(60));
    
    for (const issue of result.issues) {
      const icon = issue.severity === 'error' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ';
      lines.push(`${icon} [${issue.code}] ${issue.message}`);
      lines.push(`  Path: ${issue.path}`);
      if (issue.suggestion) {
        lines.push(`  Suggestion: ${issue.suggestion}`);
      }
      lines.push('');
    }
  } else {
    lines.push('No issues found.');
  }
  
  lines.push('='.repeat(60));
  
  return lines.join('\n');
}

/**
 * Standalone validation runner for CLI usage.
 * Can be invoked with: npx ts-node team-validator.ts <path-to-project-state.yaml>
 */
export function runValidation(args: string[]): void {
  const filePath = args[0];
  
  if (!filePath) {
    console.error('Usage: team-validator <path-to-project-state.yaml>');
    process.exit(1);
  }
  
  const result = validateTeamConfigurationFromFile(filePath);
  console.log(formatValidationResult(result));
  
  process.exit(result.valid ? 0 : 1);
}

// Run as CLI if invoked directly
if (require.main === module) {
  runValidation(process.argv.slice(2));
}
