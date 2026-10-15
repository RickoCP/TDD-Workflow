/**
 * Team Manager - Type Definitions and Interface
 * 
 * This module defines the types, interfaces, and constants for the Team_Manager component
 * which manages team member registration, role assignment, and team configuration.
 * 
 * Requirements: 1.1, 1.2, 2.1
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Valid roles that can be assigned to team members.
 * Requirements: 1.2
 */
export const VALID_ROLES = [
  'frontend',   // UI/UX development
  'backend',    // Server-side development
  'qa',         // Quality assurance and testing
  'devops',     // Infrastructure and deployment
  'fullstack',  // Both frontend and backend
  'lead',       // Technical leadership
] as const;

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * Role type derived from valid roles constant.
 * Requirements: 1.2
 */
export type Role = typeof VALID_ROLES[number];

/**
 * Team member status indicating availability.
 */
export type MemberStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Team member definition.
 * Requirements: 1.1, 1.4
 */
export interface TeamMember {
  /** Unique identifier for the team member (required) */
  id: string;
  /** Display name of the team member (required) */
  name: string;
  /** List of roles assigned to the member (required, min 1) */
  roles: Role[];
  /** Timestamp when the member was registered */
  registered_at: string;
  /** Current status of the team member */
  status: MemberStatus;
}

/**
 * Filter options for listing team members.
 * Requirements: 2.2
 */
export interface RoleFilter {
  /** Filter by specific role */
  role?: Role;
  /** Filter by member status */
  status?: MemberStatus;
}

// =============================================================================
// Error Definitions
// =============================================================================

/**
 * Team error codes following the design specification.
 * Error codes in range 1000-1099.
 */
export enum TeamErrorCode {
  /** Developer ID not registered */
  TEAM_MEMBER_NOT_FOUND = 1001,
  /** ID already exists */
  DUPLICATE_MEMBER_ID = 1002,
  /** Role not in valid_roles list */
  INVALID_ROLE = 1003,
  /** Cannot remove member with active tasks */
  MEMBER_HAS_ACTIVE_TASKS = 1004,
  /** Member must have at least one role */
  NO_ROLES_SPECIFIED = 1005,
  /** Invalid member data provided */
  INVALID_MEMBER_DATA = 1006,
}

/**
 * Team error structure following the design specification.
 */
export interface TeamError {
  /** Error code from TeamErrorCode enum */
  code: TeamErrorCode;
  /** Error category */
  category: 'TEAM_ERROR';
  /** Human-readable error message */
  message: string;
  /** Additional context about the error */
  context?: {
    developer_id?: string;
    role?: string;
    valid_roles?: readonly string[];
    developer_roles?: string[];
    [key: string]: unknown;
  };
  /** Suggested action to resolve the error */
  suggested_action?: string;
  /** Timestamp when the error occurred */
  timestamp: string;
}

// =============================================================================
// Result Type
// =============================================================================

/**
 * Result type for operations that can succeed or fail.
 * Follows the Result pattern for type-safe error handling.
 */
export type Result<T, E> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Helper function to create a success result.
 */
export function ok<T>(value: T): Result<T, never> {
  return { success: true, value };
}

/**
 * Helper function to create a failure result.
 */
export function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

// =============================================================================
// Error Factory Functions
// =============================================================================

/**
 * Creates a TeamError with the given code and details.
 */
export function createTeamError(
  code: TeamErrorCode,
  message: string,
  context?: TeamError['context'],
  suggested_action?: string
): TeamError {
  return {
    code,
    category: 'TEAM_ERROR',
    message,
    context,
    suggested_action,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a "member not found" error.
 */
export function memberNotFoundError(developerId: string): TeamError {
  return createTeamError(
    TeamErrorCode.TEAM_MEMBER_NOT_FOUND,
    `Team member with id '${developerId}' not found`,
    { developer_id: developerId },
    'Verify the developer ID or register the team member first'
  );
}

/**
 * Creates a "duplicate member ID" error.
 */
export function duplicateMemberIdError(developerId: string): TeamError {
  return createTeamError(
    TeamErrorCode.DUPLICATE_MEMBER_ID,
    `Team member with id '${developerId}' already exists`,
    { developer_id: developerId },
    'Use a unique developer ID or update the existing member'
  );
}

/**
 * Creates an "invalid role" error.
 */
export function invalidRoleError(role: string): TeamError {
  return createTeamError(
    TeamErrorCode.INVALID_ROLE,
    `Role '${role}' is not a valid role`,
    { role, valid_roles: VALID_ROLES },
    `Use one of the valid roles: ${VALID_ROLES.join(', ')}`
  );
}

/**
 * Creates a "member has active tasks" error.
 */
export function memberHasActiveTasksError(developerId: string, taskCount: number): TeamError {
  return createTeamError(
    TeamErrorCode.MEMBER_HAS_ACTIVE_TASKS,
    `Cannot remove team member '${developerId}' with ${taskCount} active task(s)`,
    { developer_id: developerId },
    'Reassign or complete all tasks before removing the team member'
  );
}

/**
 * Creates a "no roles specified" error.
 */
export function noRolesSpecifiedError(developerId: string): TeamError {
  return createTeamError(
    TeamErrorCode.NO_ROLES_SPECIFIED,
    `Team member '${developerId}' must have at least one role`,
    { developer_id: developerId, valid_roles: VALID_ROLES },
    `Assign at least one role: ${VALID_ROLES.join(', ')}`
  );
}

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validates if a string is a valid role.
 * Requirements: 1.2, 1.3
 */
export function isValidRole(role: string): role is Role {
  return VALID_ROLES.includes(role as Role);
}

/**
 * Validates if a developer ID follows valid format.
 * IDs must be non-empty strings.
 */
export function isValidDeveloperId(developerId: string): boolean {
  return typeof developerId === 'string' && developerId.trim().length > 0;
}

// =============================================================================
// Team_Manager Interface
// =============================================================================

/**
 * Team_Manager interface for managing team member registration,
 * role assignment, and team configuration.
 * 
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3
 */
export interface Team_Manager {
  // =========================================================================
  // Team member operations
  // =========================================================================

  /**
   * Registers a new team member in the project configuration.
   * 
   * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6
   * 
   * @param member - The team member to register
   * @returns Result with void on success or TeamError on failure
   * 
   * Errors:
   * - DUPLICATE_MEMBER_ID: If a member with the same ID already exists
   * - INVALID_ROLE: If any role in member.roles is not in VALID_ROLES
   * - NO_ROLES_SPECIFIED: If member.roles is empty
   * - INVALID_MEMBER_DATA: If required fields are missing
   */
  registerMember(member: TeamMember): Result<void, TeamError>;

  /**
   * Removes a team member from the project configuration.
   * 
   * @param developerId - The unique ID of the member to remove
   * @returns Result with void on success or TeamError on failure
   * 
   * Errors:
   * - TEAM_MEMBER_NOT_FOUND: If no member with the ID exists
   * - MEMBER_HAS_ACTIVE_TASKS: If the member has tasks assigned
   */
  removeMember(developerId: string): Result<void, TeamError>;

  /**
   * Updates the roles assigned to a team member.
   * 
   * Requirements: 1.4
   * 
   * @param developerId - The unique ID of the member to update
   * @param roles - The new list of roles to assign
   * @returns Result with void on success or TeamError on failure
   * 
   * Errors:
   * - TEAM_MEMBER_NOT_FOUND: If no member with the ID exists
   * - INVALID_ROLE: If any role is not in VALID_ROLES
   * - NO_ROLES_SPECIFIED: If roles array is empty
   */
  updateMemberRoles(developerId: string, roles: Role[]): Result<void, TeamError>;

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Retrieves a team member by their ID.
   * 
   * Requirements: 2.1
   * 
   * @param developerId - The unique ID of the member to retrieve
   * @returns Result with TeamMember on success or TeamError on failure
   * 
   * Errors:
   * - TEAM_MEMBER_NOT_FOUND: If no member with the ID exists
   */
  getMember(developerId: string): Result<TeamMember, TeamError>;

  /**
   * Lists all registered team members, optionally filtered.
   * 
   * Requirements: 2.1, 2.2, 2.3
   * 
   * @param filter - Optional filter criteria for role and/or status
   * @returns Array of team members matching the filter (empty if none)
   */
  listMembers(filter?: RoleFilter): TeamMember[];

  /**
   * Gets all team members that have a specific role.
   * 
   * Requirements: 2.2
   * 
   * @param role - The role to filter by
   * @returns Array of team members with the specified role
   */
  getMembersByRole(role: Role): TeamMember[];

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validates if a developer ID exists in the team.
   * 
   * @param developerId - The developer ID to validate
   * @returns true if the developer exists, false otherwise
   */
  validateDeveloperId(developerId: string): boolean;

  /**
   * Validates if a role string is a valid role.
   * 
   * Requirements: 1.2, 1.3
   * 
   * @param role - The role string to validate
   * @returns true if the role is valid, false otherwise
   */
  validateRole(role: string): boolean;
}

// =============================================================================
// Team Statistics Type
// =============================================================================

/**
 * Statistics about the team composition.
 * Stored in project-state.yaml under team.statistics
 */
export interface TeamStatistics {
  /** Total number of team members */
  total_members: number;
  /** Count of members by role */
  by_role: Record<Role, number>;
}

/**
 * Creates initial empty team statistics.
 */
export function createEmptyTeamStatistics(): TeamStatistics {
  return {
    total_members: 0,
    by_role: {
      frontend: 0,
      backend: 0,
      qa: 0,
      devops: 0,
      fullstack: 0,
      lead: 0,
    },
  };
}

/**
 * Calculates team statistics from a list of members.
 */
export function calculateTeamStatistics(members: TeamMember[]): TeamStatistics {
  const stats = createEmptyTeamStatistics();
  stats.total_members = members.length;
  
  for (const member of members) {
    if (member.status === 'ACTIVE') {
      for (const role of member.roles) {
        stats.by_role[role]++;
      }
    }
  }
  
  return stats;
}

// =============================================================================
// Factory Functions for Creating Team Members
// =============================================================================

/**
 * Creates a new TeamMember with required fields and defaults.
 * 
 * @param id - Unique identifier
 * @param name - Display name
 * @param roles - List of roles (at least one required)
 * @param status - Optional status (defaults to ACTIVE)
 * @returns A new TeamMember object
 */
export function createTeamMember(
  id: string,
  name: string,
  roles: Role[],
  status: MemberStatus = 'ACTIVE'
): TeamMember {
  return {
    id,
    name,
    roles,
    registered_at: new Date().toISOString(),
    status,
  };
}

// =============================================================================
// Project State Types for YAML Operations
// =============================================================================

/**
 * Team section in project-state.yaml
 */
export interface TeamSection {
  members: TeamMember[];
  statistics: TeamStatistics;
}

/**
 * Partial project state structure for team operations
 */
export interface ProjectState {
  team: TeamSection;
  tasks?: {
    by_assignee?: Record<string, number>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// =============================================================================
// YAML Utilities
// =============================================================================

/**
 * Simple YAML parser that handles the project-state.yaml structure.
 * Supports nested objects, arrays, and basic value types.
 */
export function parseProjectStateYaml(content: string): ProjectState {
  const lines = content.split('\n');
  const result: Record<string, unknown> = {};
  const stack: Array<{ obj: Record<string, unknown> | unknown[]; key?: string; indent: number; isArray: boolean }> = [
    { obj: result, indent: -2, isArray: false }
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;
    
    const indent = line.search(/\S/);
    const trimmed = line.trim();
    
    // Pop stack to find correct parent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    
    const current = stack[stack.length - 1];
    
    // Handle array items
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.substring(2).trim();
      
      // Ensure current context is an array
      if (!current.isArray && current.key) {
        const parent = stack[stack.length - 2]?.obj as Record<string, unknown>;
        if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
          const arr: unknown[] = [];
          parent[current.key] = arr;
          stack.pop();
          stack.push({ obj: arr, indent: current.indent, isArray: true });
        }
      }
      
      const arrObj = stack[stack.length - 1].obj as unknown[];
      if (Array.isArray(arrObj)) {
        // Check if it's a key-value pair in the array item
        const colonIdx = itemContent.indexOf(':');
        if (colonIdx > 0) {
          const key = itemContent.substring(0, colonIdx).trim();
          const valueStr = itemContent.substring(colonIdx + 1).trim();
          const newObj: Record<string, unknown> = {};
          if (valueStr) {
            newObj[key] = parseYamlValue(valueStr);
          } else {
            newObj[key] = {};
          }
          arrObj.push(newObj);
          stack.push({ obj: newObj, indent: indent + 2, isArray: false });
        } else {
          // Simple value in array
          arrObj.push(parseYamlValue(itemContent));
        }
      }
      continue;
    }
    
    // Handle key-value pairs
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.substring(0, colonIndex).trim();
      const valueStr = trimmed.substring(colonIndex + 1).trim();
      
      const currentObj = current.obj;
      if (typeof currentObj === 'object' && !Array.isArray(currentObj)) {
        if (valueStr === '' || valueStr === '[]') {
          // Nested object or empty array
          if (valueStr === '[]') {
            currentObj[key] = [];
          } else {
            currentObj[key] = {};
          }
          stack.push({ obj: currentObj[key] as Record<string, unknown>, key, indent: indent, isArray: valueStr === '[]' });
        } else {
          currentObj[key] = parseYamlValue(valueStr);
        }
      }
    }
  }
  
  // Ensure team section exists with proper structure
  if (!result.team) {
    result.team = {
      members: [],
      statistics: createEmptyTeamStatistics()
    };
  }
  
  const team = result.team as Record<string, unknown>;
  if (!team.members) {
    team.members = [];
  }
  if (!team.statistics) {
    team.statistics = createEmptyTeamStatistics();
  }
  
  return result as ProjectState;
}

/**
 * Parses a YAML value string into the appropriate JavaScript type.
 */
function parseYamlValue(str: string): unknown {
  // Handle quoted strings
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  // Handle booleans
  if (str === 'true' || str === 'yes' || str === 'on') return true;
  if (str === 'false' || str === 'no' || str === 'off') return false;
  // Handle null
  if (str === 'null' || str === '~' || str === '') return null;
  // Handle empty array
  if (str === '[]') return [];
  // Handle numbers
  if (/^-?\d+$/.test(str)) return parseInt(str, 10);
  if (/^-?\d+\.\d+$/.test(str)) return parseFloat(str);
  
  return str;
}

/**
 * Serializes project state back to YAML format.
 * Only updates the team section, preserving other sections.
 */
export function serializeProjectStateYaml(
  originalContent: string,
  state: ProjectState
): string {
  const lines = originalContent.split('\n');
  const result: string[] = [];
  let inTeamSection = false;
  let teamSectionIndent = 0;
  let skipUntilIndent = -1;
  let teamSectionAdded = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.search(/\S/);
    
    // Check for start of team section
    if (trimmed.startsWith('team:')) {
      inTeamSection = true;
      teamSectionIndent = indent;
      result.push(line);
      
      // Generate team section content
      const teamContent = generateTeamSectionYaml(state.team, teamSectionIndent + 2);
      result.push(...teamContent);
      teamSectionAdded = true;
      
      // Skip original team section content
      skipUntilIndent = teamSectionIndent;
      continue;
    }
    
    // Skip lines that belong to the old team section
    if (skipUntilIndent >= 0) {
      if (trimmed === '' || trimmed.startsWith('#')) {
        // Keep comments and empty lines unless they're inside the team section
        if (!inTeamSection || indent <= teamSectionIndent) {
          result.push(line);
          if (indent <= teamSectionIndent && trimmed !== '') {
            skipUntilIndent = -1;
            inTeamSection = false;
          }
        }
        continue;
      }
      
      if (indent <= skipUntilIndent) {
        // We've exited the team section
        skipUntilIndent = -1;
        inTeamSection = false;
        result.push(line);
      }
      continue;
    }
    
    result.push(line);
  }
  
  // If team section was never found, add it before blockers or at the end
  if (!teamSectionAdded) {
    const insertIndex = findInsertionPoint(result);
    const teamLines = ['team:', ...generateTeamSectionYaml(state.team, 2)];
    result.splice(insertIndex, 0, ...teamLines);
  }
  
  return result.join('\n');
}

/**
 * Generates YAML content for the team section.
 */
function generateTeamSectionYaml(team: TeamSection, baseIndent: number): string[] {
  const indent = ' '.repeat(baseIndent);
  const indent2 = ' '.repeat(baseIndent + 2);
  const indent3 = ' '.repeat(baseIndent + 4);
  const lines: string[] = [];
  
  // Generate members array
  if (team.members.length === 0) {
    lines.push(`${indent}members: []`);
  } else {
    lines.push(`${indent}members:`);
    for (const member of team.members) {
      lines.push(`${indent2}- id: "${member.id}"`);
      lines.push(`${indent3}name: "${member.name}"`);
      if (member.roles.length === 1) {
        lines.push(`${indent3}roles: [${member.roles[0]}]`);
      } else {
        lines.push(`${indent3}roles:`);
        for (const role of member.roles) {
          lines.push(`${indent3}  - ${role}`);
        }
      }
      lines.push(`${indent3}registered_at: "${member.registered_at}"`);
      lines.push(`${indent3}status: ${member.status}`);
    }
  }
  
  // Generate statistics
  lines.push(`${indent}statistics:`);
  lines.push(`${indent2}total_members: ${team.statistics.total_members}`);
  lines.push(`${indent2}by_role:`);
  for (const [role, count] of Object.entries(team.statistics.by_role)) {
    lines.push(`${indent3}${role}: ${count}`);
  }
  
  return lines;
}

/**
 * Finds the best insertion point for the team section.
 */
function findInsertionPoint(lines: string[]): number {
  // Try to insert before blockers, current_task, or at the end of tasks section
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('current_task:') || trimmed.startsWith('blockers:')) {
      return i;
    }
  }
  return lines.length;
}

// =============================================================================
// TeamManagerImpl Implementation
// =============================================================================

/**
 * Configuration for TeamManagerImpl
 */
export interface TeamManagerConfig {
  /** Path to project-state.yaml file */
  projectStatePath: string;
  /** Function to check if a member has active tasks (for removeMember) */
  hasActiveTasks?: (developerId: string) => Promise<number>;
}

/**
 * Concrete implementation of Team_Manager interface.
 * Manages team members with persistence to project-state.yaml.
 * 
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3
 */
export class TeamManagerImpl implements Team_Manager {
  private config: TeamManagerConfig;
  private state: ProjectState | null = null;

  constructor(config: TeamManagerConfig) {
    this.config = config;
  }

  /**
   * Loads the project state from YAML file.
   */
  private loadState(): ProjectState {
    try {
      // Dynamic require for fs to support both Node.js and browser environments
      const fs = require('fs');
      const content = fs.readFileSync(this.config.projectStatePath, 'utf8');
      this.state = parseProjectStateYaml(content);
      return this.state;
    } catch (error) {
      // If file doesn't exist or can't be read, return default state
      this.state = {
        team: {
          members: [],
          statistics: createEmptyTeamStatistics()
        }
      };
      return this.state;
    }
  }

  /**
   * Saves the project state to YAML file.
   */
  private saveState(): void {
    if (!this.state) return;
    
    try {
      const fs = require('fs');
      let originalContent = '';
      try {
        originalContent = fs.readFileSync(this.config.projectStatePath, 'utf8');
      } catch {
        // File doesn't exist, create minimal structure
        originalContent = `# project-state.yaml\nschema_version: "1"\nworkflow_version: "1.0.0"\n`;
      }
      
      const newContent = serializeProjectStateYaml(originalContent, this.state);
      fs.writeFileSync(this.config.projectStatePath, newContent, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save project state: ${error}`);
    }
  }

  /**
   * Updates team statistics based on current members.
   */
  private updateStatistics(): void {
    if (!this.state) return;
    this.state.team.statistics = calculateTeamStatistics(this.state.team.members);
  }

  // =========================================================================
  // Team member operations
  // =========================================================================

  /**
   * Registers a new team member in the project configuration.
   * 
   * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6
   */
  registerMember(member: TeamMember): Result<void, TeamError> {
    // Load current state
    const state = this.loadState();

    // Validate required fields
    if (!member.id || typeof member.id !== 'string' || member.id.trim() === '') {
      return err(createTeamError(
        TeamErrorCode.INVALID_MEMBER_DATA,
        'Member ID is required and must be a non-empty string',
        { developer_id: member.id },
        'Provide a valid, non-empty developer ID'
      ));
    }

    if (!member.name || typeof member.name !== 'string' || member.name.trim() === '') {
      return err(createTeamError(
        TeamErrorCode.INVALID_MEMBER_DATA,
        'Member name is required and must be a non-empty string',
        { developer_id: member.id },
        'Provide a valid, non-empty name for the team member'
      ));
    }

    // Requirement 1.5: Check for duplicate ID
    const existingMember = state.team.members.find(m => m.id === member.id);
    if (existingMember) {
      return err(duplicateMemberIdError(member.id));
    }

    // Requirement 1.4: Validate at least one role is provided
    if (!member.roles || !Array.isArray(member.roles) || member.roles.length === 0) {
      return err(noRolesSpecifiedError(member.id));
    }

    // Requirement 1.3: Validate all roles are valid
    for (const role of member.roles) {
      if (!isValidRole(role)) {
        return err(invalidRoleError(role));
      }
    }

    // Requirement 1.1, 1.6: Register the member
    const newMember: TeamMember = {
      id: member.id.trim(),
      name: member.name.trim(),
      roles: [...member.roles], // Copy array to avoid mutations
      registered_at: member.registered_at || new Date().toISOString(),
      status: member.status || 'ACTIVE'
    };

    state.team.members.push(newMember);
    
    // Update statistics
    this.updateStatistics();
    
    // Persist to YAML
    this.saveState();

    return ok(undefined);
  }

  /**
   * Removes a team member from the project configuration.
   * 
   * Requirements: 1.6
   */
  removeMember(developerId: string): Result<void, TeamError> {
    // Load current state
    const state = this.loadState();

    // Validate developer ID format
    if (!isValidDeveloperId(developerId)) {
      return err(createTeamError(
        TeamErrorCode.INVALID_MEMBER_DATA,
        'Developer ID must be a non-empty string',
        { developer_id: developerId },
        'Provide a valid developer ID'
      ));
    }

    // Find the member
    const memberIndex = state.team.members.findIndex(m => m.id === developerId);
    if (memberIndex === -1) {
      return err(memberNotFoundError(developerId));
    }

    // Check for active tasks if the callback is provided
    if (this.config.hasActiveTasks) {
      // For async check, we need to handle this differently
      // Since the interface is synchronous, we'll check synchronously via tasks.by_assignee
      const assignedTaskCount = state.tasks?.by_assignee?.[developerId] || 0;
      if (assignedTaskCount > 0) {
        return err(memberHasActiveTasksError(developerId, assignedTaskCount));
      }
    } else {
      // Check tasks.by_assignee in state
      const assignedTaskCount = state.tasks?.by_assignee?.[developerId] || 0;
      if (assignedTaskCount > 0) {
        return err(memberHasActiveTasksError(developerId, assignedTaskCount));
      }
    }

    // Remove the member
    state.team.members.splice(memberIndex, 1);

    // Update statistics
    this.updateStatistics();

    // Persist to YAML
    this.saveState();

    return ok(undefined);
  }

  /**
   * Updates the roles assigned to a team member.
   * 
   * Requirements: 1.4
   */
  updateMemberRoles(developerId: string, roles: Role[]): Result<void, TeamError> {
    // Load current state
    const state = this.loadState();

    // Find the member
    const member = state.team.members.find(m => m.id === developerId);
    if (!member) {
      return err(memberNotFoundError(developerId));
    }

    // Validate at least one role is provided
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return err(noRolesSpecifiedError(developerId));
    }

    // Validate all roles are valid
    for (const role of roles) {
      if (!isValidRole(role)) {
        return err(invalidRoleError(role));
      }
    }

    // Update roles
    member.roles = [...roles];

    // Update statistics
    this.updateStatistics();

    // Persist to YAML
    this.saveState();

    return ok(undefined);
  }

  // =========================================================================
  // Query operations
  // =========================================================================

  /**
   * Retrieves a team member by their ID.
   * 
   * Requirements: 2.1
   */
  getMember(developerId: string): Result<TeamMember, TeamError> {
    const state = this.loadState();
    
    const member = state.team.members.find(m => m.id === developerId);
    if (!member) {
      return err(memberNotFoundError(developerId));
    }

    return ok({ ...member }); // Return a copy
  }

  /**
   * Lists all registered team members, optionally filtered.
   * 
   * Requirements: 2.1, 2.2, 2.3
   */
  listMembers(filter?: RoleFilter): TeamMember[] {
    const state = this.loadState();
    
    let members = [...state.team.members];

    if (filter) {
      // Filter by role
      if (filter.role) {
        members = members.filter(m => m.roles.includes(filter.role!));
      }
      // Filter by status
      if (filter.status) {
        members = members.filter(m => m.status === filter.status);
      }
    }

    return members;
  }

  /**
   * Gets all team members that have a specific role.
   * 
   * Requirements: 2.2
   */
  getMembersByRole(role: Role): TeamMember[] {
    const state = this.loadState();
    return state.team.members.filter(m => m.roles.includes(role));
  }

  // =========================================================================
  // Validation
  // =========================================================================

  /**
   * Validates if a developer ID exists in the team.
   */
  validateDeveloperId(developerId: string): boolean {
    const state = this.loadState();
    return state.team.members.some(m => m.id === developerId);
  }

  /**
   * Validates if a role string is a valid role.
   * 
   * Requirements: 1.2, 1.3
   */
  validateRole(role: string): boolean {
    return isValidRole(role);
  }
}

/**
 * Factory function to create a TeamManagerImpl instance.
 * 
 * @param projectStatePath - Path to project-state.yaml file
 * @returns A new TeamManagerImpl instance
 */
export function createTeamManager(projectStatePath: string): TeamManagerImpl {
  return new TeamManagerImpl({ projectStatePath });
}
