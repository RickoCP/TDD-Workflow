/**
 * Unit Tests for Team_Manager
 * 
 * These tests verify specific scenarios for the Team_Manager component
 * including registration, duplicate ID rejection, role validation,
 * query operations, and member removal.
 * 
 * **Validates: Requirements 1.1-1.6, 2.1-2.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TeamMember,
  Role,
  TeamError,
  TeamErrorCode,
  VALID_ROLES,
  Result,
  ok,
  err,
  createTeamMember,
  duplicateMemberIdError,
  invalidRoleError,
  noRolesSpecifiedError,
  memberNotFoundError,
  isValidRole,
  RoleFilter,
} from '../team-manager';

// =============================================================================
// In-Memory Team_Manager Implementation for Unit Testing
// =============================================================================

/**
 * In-memory implementation of Team_Manager for testing purposes.
 * This implementation follows the interface defined in team-manager.ts
 */
class InMemoryTeamManager {
  private members: Map<string, TeamMember> = new Map();

  /**
   * Registers a new team member.
   * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6
   */
  registerMember(member: Partial<TeamMember> & { id?: string; name?: string; roles?: unknown }): Result<void, TeamError> {
    // Validate required field: id
    if (!member.id || typeof member.id !== 'string' || member.id.trim() === '') {
      return err({
        code: TeamErrorCode.INVALID_MEMBER_DATA,
        category: 'TEAM_ERROR',
        message: 'Member ID is required and must be a non-empty string',
        context: { developer_id: member.id },
        suggested_action: 'Provide a valid, non-empty developer ID',
        timestamp: new Date().toISOString(),
      });
    }

    // Validate required field: name
    if (!member.name || typeof member.name !== 'string' || member.name.trim() === '') {
      return err({
        code: TeamErrorCode.INVALID_MEMBER_DATA,
        category: 'TEAM_ERROR',
        message: 'Member name is required and must be a non-empty string',
        context: { developer_id: member.id },
        suggested_action: 'Provide a valid, non-empty name for the team member',
        timestamp: new Date().toISOString(),
      });
    }

    // Validate member has at least one role (Requirement 1.4)
    if (!member.roles || !Array.isArray(member.roles) || member.roles.length === 0) {
      return err(noRolesSpecifiedError(member.id));
    }

    // Validate all roles are valid (Requirement 1.3)
    for (const role of member.roles) {
      if (!isValidRole(role)) {
        return err(invalidRoleError(role));
      }
    }

    // Check for duplicate ID (Requirement 1.5)
    if (this.members.has(member.id)) {
      return err(duplicateMemberIdError(member.id));
    }

    // Register the member (Requirements 1.1, 1.6)
    const newMember: TeamMember = {
      id: member.id,
      name: member.name,
      roles: [...member.roles] as Role[],
      registered_at: member.registered_at || new Date().toISOString(),
      status: member.status || 'ACTIVE',
    };
    
    this.members.set(member.id, newMember);
    return ok(undefined);
  }

  /**
   * Removes a team member by ID.
   */
  removeMember(developerId: string): Result<void, TeamError> {
    if (!this.members.has(developerId)) {
      return err(memberNotFoundError(developerId));
    }
    this.members.delete(developerId);
    return ok(undefined);
  }

  /**
   * Gets a team member by ID.
   */
  getMember(developerId: string): Result<TeamMember, TeamError> {
    const member = this.members.get(developerId);
    if (!member) {
      return err(memberNotFoundError(developerId));
    }
    return ok({ ...member });
  }

  /**
   * Lists all members, optionally filtered by role and/or status.
   */
  listMembers(filter?: RoleFilter): TeamMember[] {
    let allMembers = Array.from(this.members.values());
    
    if (filter) {
      if (filter.role) {
        allMembers = allMembers.filter(m => m.roles.includes(filter.role!));
      }
      if (filter.status) {
        allMembers = allMembers.filter(m => m.status === filter.status);
      }
    }
    
    return allMembers;
  }

  /**
   * Gets all members with a specific role.
   */
  getMembersByRole(role: Role): TeamMember[] {
    return Array.from(this.members.values()).filter(m => m.roles.includes(role));
  }

  /**
   * Validates if a developer ID exists.
   */
  validateDeveloperId(developerId: string): boolean {
    return this.members.has(developerId);
  }

  /**
   * Validates if a role is valid.
   */
  validateRole(role: string): boolean {
    return isValidRole(role);
  }

  /**
   * Clears all members (for test reset).
   */
  clear(): void {
    this.members.clear();
  }

  /**
   * Gets the count of registered members.
   */
  get size(): number {
    return this.members.size;
  }
}

// =============================================================================
// Helper Functions for Tests
// =============================================================================

/**
 * Creates a valid team member for testing.
 */
function createValidMember(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: overrides.id ?? 'dev-001',
    name: overrides.name ?? 'Test Developer',
    roles: overrides.roles ?? ['backend'],
    registered_at: overrides.registered_at ?? new Date().toISOString(),
    status: overrides.status ?? 'ACTIVE',
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('Team_Manager Unit Tests', () => {
  let teamManager: InMemoryTeamManager;

  beforeEach(() => {
    teamManager = new InMemoryTeamManager();
  });

  // ===========================================================================
  // 1. Registration Tests
  // Validates: Requirements 1.1, 1.3, 1.4
  // ===========================================================================
  describe('1. Registration Tests', () => {
    describe('Register a team member with valid data (id, name, roles)', () => {
      it('should successfully register a member with valid id, name, and single role', () => {
        const member = createValidMember({
          id: 'dev-alice',
          name: 'Alice Developer',
          roles: ['backend'],
        });

        const result = teamManager.registerMember(member);

        expect(result.success).toBe(true);
        expect(teamManager.size).toBe(1);
        
        const retrieved = teamManager.getMember('dev-alice');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.id).toBe('dev-alice');
          expect(retrieved.value.name).toBe('Alice Developer');
          expect(retrieved.value.roles).toEqual(['backend']);
          expect(retrieved.value.status).toBe('ACTIVE');
        }
      });

      it('should successfully register a member with all valid fields populated', () => {
        const registrationTime = '2024-01-15T10:00:00.000Z';
        const member: TeamMember = {
          id: 'dev-bob',
          name: 'Bob Frontend',
          roles: ['frontend', 'qa'],
          registered_at: registrationTime,
          status: 'ACTIVE',
        };

        const result = teamManager.registerMember(member);

        expect(result.success).toBe(true);
        
        const retrieved = teamManager.getMember('dev-bob');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.id).toBe('dev-bob');
          expect(retrieved.value.name).toBe('Bob Frontend');
          expect(retrieved.value.roles).toEqual(['frontend', 'qa']);
          expect(retrieved.value.registered_at).toBe(registrationTime);
          expect(retrieved.value.status).toBe('ACTIVE');
        }
      });

      it('should register a member with INACTIVE status', () => {
        const member = createValidMember({
          id: 'dev-inactive',
          name: 'Inactive Developer',
          status: 'INACTIVE',
        });

        const result = teamManager.registerMember(member);

        expect(result.success).toBe(true);
        
        const retrieved = teamManager.getMember('dev-inactive');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.status).toBe('INACTIVE');
        }
      });
    });

    describe('Reject registration with missing ID', () => {
      it('should reject registration when id is undefined', () => {
        const memberWithoutId = {
          name: 'No ID Developer',
          roles: ['backend'] as Role[],
        };

        const result = teamManager.registerMember(memberWithoutId as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
          expect(result.error.message).toContain('ID');
        }
      });

      it('should reject registration when id is null', () => {
        const memberWithNullId = {
          id: null,
          name: 'Null ID Developer',
          roles: ['backend'] as Role[],
        };

        const result = teamManager.registerMember(memberWithNullId as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
        }
      });

      it('should reject registration when id is empty string', () => {
        const memberWithEmptyId = createValidMember({ id: '' });

        const result = teamManager.registerMember(memberWithEmptyId);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
          expect(result.error.message).toContain('ID');
        }
      });

      it('should reject registration when id is whitespace only', () => {
        const memberWithWhitespaceId = createValidMember({ id: '   ' });

        const result = teamManager.registerMember(memberWithWhitespaceId);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
        }
      });
    });

    describe('Reject registration with missing name', () => {
      it('should reject registration when name is undefined', () => {
        const memberWithoutName = {
          id: 'dev-no-name',
          roles: ['backend'] as Role[],
        };

        const result = teamManager.registerMember(memberWithoutName as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
          expect(result.error.message).toContain('name');
        }
      });

      it('should reject registration when name is null', () => {
        const memberWithNullName = {
          id: 'dev-null-name',
          name: null,
          roles: ['backend'] as Role[],
        };

        const result = teamManager.registerMember(memberWithNullName as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
        }
      });

      it('should reject registration when name is empty string', () => {
        const memberWithEmptyName = createValidMember({ name: '' });

        const result = teamManager.registerMember(memberWithEmptyName);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
          expect(result.error.message).toContain('name');
        }
      });

      it('should reject registration when name is whitespace only', () => {
        const memberWithWhitespaceName = createValidMember({ name: '   ' });

        const result = teamManager.registerMember(memberWithWhitespaceName);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_MEMBER_DATA);
        }
      });
    });

    describe('Reject registration with empty roles array', () => {
      it('should reject registration when roles is an empty array', () => {
        const memberWithEmptyRoles = createValidMember({ roles: [] });

        const result = teamManager.registerMember(memberWithEmptyRoles);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.NO_ROLES_SPECIFIED);
          expect(result.error.context?.developer_id).toBe(memberWithEmptyRoles.id);
        }
      });

      it('should reject registration when roles is undefined', () => {
        const memberWithUndefinedRoles = {
          id: 'dev-no-roles',
          name: 'No Roles Developer',
        };

        const result = teamManager.registerMember(memberWithUndefinedRoles as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.NO_ROLES_SPECIFIED);
        }
      });

      it('should reject registration when roles is null', () => {
        const memberWithNullRoles = {
          id: 'dev-null-roles',
          name: 'Null Roles Developer',
          roles: null,
        };

        const result = teamManager.registerMember(memberWithNullRoles as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.NO_ROLES_SPECIFIED);
        }
      });
    });

    describe('Reject registration with invalid role', () => {
      it('should reject registration with a misspelled role', () => {
        const memberWithInvalidRole = {
          id: 'dev-invalid-role',
          name: 'Invalid Role Developer',
          roles: ['fronend'], // misspelling of 'frontend'
        };

        const result = teamManager.registerMember(memberWithInvalidRole as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
          expect(result.error.context?.role).toBe('fronend');
          expect(result.error.context?.valid_roles).toEqual(VALID_ROLES);
        }
      });

      it('should reject registration with a completely invalid role', () => {
        const memberWithRandomRole = {
          id: 'dev-random-role',
          name: 'Random Role Developer',
          roles: ['developer'], // not a valid role
        };

        const result = teamManager.registerMember(memberWithRandomRole as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
          expect(result.error.context?.role).toBe('developer');
        }
      });

      it('should reject registration when any role in the array is invalid', () => {
        const memberWithMixedRoles = {
          id: 'dev-mixed-roles',
          name: 'Mixed Roles Developer',
          roles: ['backend', 'invalidrole', 'frontend'],
        };

        const result = teamManager.registerMember(memberWithMixedRoles as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
          expect(result.error.context?.role).toBe('invalidrole');
        }
      });

      it('should reject registration with uppercase role', () => {
        const memberWithUppercaseRole = {
          id: 'dev-uppercase',
          name: 'Uppercase Role Developer',
          roles: ['BACKEND'],
        };

        const result = teamManager.registerMember(memberWithUppercaseRole as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
        }
      });

      it('should reject registration with role containing extra spaces', () => {
        const memberWithSpacedRole = {
          id: 'dev-spaced',
          name: 'Spaced Role Developer',
          roles: [' backend '],
        };

        const result = teamManager.registerMember(memberWithSpacedRole as any);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
        }
      });
    });
  });

  // ===========================================================================
  // 2. Duplicate ID Tests
  // Validates: Requirements 1.5
  // ===========================================================================
  describe('2. Duplicate ID Tests', () => {
    describe('Reject registration of member with duplicate ID', () => {
      it('should reject a second member registration with the same ID', () => {
        const firstMember = createValidMember({
          id: 'dev-001',
          name: 'First Developer',
          roles: ['backend'],
        });

        const secondMember = createValidMember({
          id: 'dev-001', // Same ID
          name: 'Second Developer',
          roles: ['frontend'],
        });

        const firstResult = teamManager.registerMember(firstMember);
        expect(firstResult.success).toBe(true);

        const secondResult = teamManager.registerMember(secondMember);
        expect(secondResult.success).toBe(false);
      });

      it('should still have only one member after duplicate rejection', () => {
        const firstMember = createValidMember({ id: 'dev-dup' });
        const duplicateMember = createValidMember({ id: 'dev-dup', name: 'Different Name' });

        teamManager.registerMember(firstMember);
        teamManager.registerMember(duplicateMember);

        expect(teamManager.size).toBe(1);
      });
    });

    describe('Verify error code is DUPLICATE_MEMBER_ID (1002)', () => {
      it('should return error code 1002 for duplicate registration', () => {
        const firstMember = createValidMember({ id: 'dev-1002' });
        const duplicateMember = createValidMember({ id: 'dev-1002' });

        teamManager.registerMember(firstMember);
        const result = teamManager.registerMember(duplicateMember);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.DUPLICATE_MEMBER_ID);
          expect(result.error.code).toBe(1002);
        }
      });

      it('should include correct error category and context', () => {
        const firstMember = createValidMember({ id: 'dev-context-test' });
        const duplicateMember = createValidMember({ id: 'dev-context-test' });

        teamManager.registerMember(firstMember);
        const result = teamManager.registerMember(duplicateMember);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.category).toBe('TEAM_ERROR');
          expect(result.error.context?.developer_id).toBe('dev-context-test');
          expect(result.error.message).toContain('dev-context-test');
          expect(result.error.message).toContain('already exists');
        }
      });
    });

    describe('Verify original member data is preserved', () => {
      it('should preserve original member data when duplicate is rejected', () => {
        const originalMember = createValidMember({
          id: 'dev-preserve',
          name: 'Original Name',
          roles: ['backend', 'devops'],
          status: 'ACTIVE',
        });

        const duplicateMember = createValidMember({
          id: 'dev-preserve',
          name: 'New Name Should Not Override',
          roles: ['frontend'],
          status: 'INACTIVE',
        });

        teamManager.registerMember(originalMember);
        teamManager.registerMember(duplicateMember);

        const retrieved = teamManager.getMember('dev-preserve');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.name).toBe('Original Name');
          expect(retrieved.value.roles).toEqual(['backend', 'devops']);
          expect(retrieved.value.status).toBe('ACTIVE');
        }
      });

      it('should preserve registration timestamp of original member', () => {
        const originalTimestamp = '2024-01-01T00:00:00.000Z';
        const originalMember = createValidMember({
          id: 'dev-timestamp',
          registered_at: originalTimestamp,
        });

        const duplicateMember = createValidMember({
          id: 'dev-timestamp',
          registered_at: '2024-12-31T23:59:59.000Z',
        });

        teamManager.registerMember(originalMember);
        teamManager.registerMember(duplicateMember);

        const retrieved = teamManager.getMember('dev-timestamp');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.registered_at).toBe(originalTimestamp);
        }
      });
    });
  });

  // ===========================================================================
  // 3. Role Validation Tests
  // Validates: Requirements 1.2, 1.3, 1.4
  // ===========================================================================
  describe('3. Role Validation Tests', () => {
    describe('Accept all valid roles', () => {
      it('should accept "frontend" role', () => {
        const member = createValidMember({ id: 'dev-fe', roles: ['frontend'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('should accept "backend" role', () => {
        const member = createValidMember({ id: 'dev-be', roles: ['backend'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('should accept "qa" role', () => {
        const member = createValidMember({ id: 'dev-qa', roles: ['qa'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('should accept "devops" role', () => {
        const member = createValidMember({ id: 'dev-do', roles: ['devops'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('should accept "fullstack" role', () => {
        const member = createValidMember({ id: 'dev-fs', roles: ['fullstack'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('should accept "lead" role', () => {
        const member = createValidMember({ id: 'dev-lead', roles: ['lead'] });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      });

      it('validateRole() should return true for all VALID_ROLES', () => {
        for (const role of VALID_ROLES) {
          expect(teamManager.validateRole(role)).toBe(true);
        }
      });
    });

    describe('Reject invalid roles', () => {
      it('should reject random string as role', () => {
        expect(teamManager.validateRole('random')).toBe(false);
        expect(teamManager.validateRole('engineer')).toBe(false);
        expect(teamManager.validateRole('developer')).toBe(false);
        expect(teamManager.validateRole('admin')).toBe(false);
        expect(teamManager.validateRole('manager')).toBe(false);
      });

      it('should reject misspellings of valid roles', () => {
        expect(teamManager.validateRole('fronend')).toBe(false);  // missing 't'
        expect(teamManager.validateRole('bacend')).toBe(false);   // missing 'k'
        expect(teamManager.validateRole('qaa')).toBe(false);      // extra 'a'
        expect(teamManager.validateRole('devop')).toBe(false);    // missing 's'
        expect(teamManager.validateRole('fullstck')).toBe(false); // missing 'a'
        expect(teamManager.validateRole('leed')).toBe(false);     // wrong spelling
      });

      it('should reject roles with wrong casing', () => {
        expect(teamManager.validateRole('Frontend')).toBe(false);
        expect(teamManager.validateRole('BACKEND')).toBe(false);
        expect(teamManager.validateRole('QA')).toBe(false);
        expect(teamManager.validateRole('DevOps')).toBe(false);
        expect(teamManager.validateRole('FullStack')).toBe(false);
        expect(teamManager.validateRole('Lead')).toBe(false);
      });

      it('should reject empty string as role', () => {
        expect(teamManager.validateRole('')).toBe(false);
      });

      it('should reject whitespace-only string as role', () => {
        expect(teamManager.validateRole(' ')).toBe(false);
        expect(teamManager.validateRole('  ')).toBe(false);
        expect(teamManager.validateRole('\t')).toBe(false);
      });
    });

    describe('Multi-role assignment', () => {
      it('should accept member with two roles', () => {
        const member = createValidMember({
          id: 'dev-two-roles',
          roles: ['frontend', 'backend'],
        });

        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);

        const retrieved = teamManager.getMember('dev-two-roles');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.roles).toHaveLength(2);
          expect(retrieved.value.roles).toContain('frontend');
          expect(retrieved.value.roles).toContain('backend');
        }
      });

      it('should accept member with three roles', () => {
        const member = createValidMember({
          id: 'dev-three-roles',
          roles: ['backend', 'devops', 'lead'],
        });

        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);

        const retrieved = teamManager.getMember('dev-three-roles');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.roles).toHaveLength(3);
        }
      });

      it('should accept member with all valid roles', () => {
        const member = createValidMember({
          id: 'dev-all-roles',
          roles: [...VALID_ROLES] as Role[],
        });

        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);

        const retrieved = teamManager.getMember('dev-all-roles');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.roles).toHaveLength(VALID_ROLES.length);
          for (const role of VALID_ROLES) {
            expect(retrieved.value.roles).toContain(role);
          }
        }
      });

      it('should reject member if any of multiple roles is invalid', () => {
        const member = {
          id: 'dev-mixed-invalid',
          name: 'Mixed Invalid Developer',
          roles: ['frontend', 'invalidrole', 'backend'],
        };

        const result = teamManager.registerMember(member as any);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
          expect(result.error.context?.role).toBe('invalidrole');
        }
      });
    });
  });

  // ===========================================================================
  // 4. Query Tests
  // Validates: Requirements 2.1, 2.2, 2.3
  // ===========================================================================
  describe('4. Query Tests', () => {
    beforeEach(() => {
      // Set up test data
      teamManager.registerMember(createValidMember({
        id: 'alice',
        name: 'Alice Developer',
        roles: ['backend', 'devops'],
        status: 'ACTIVE',
      }));
      teamManager.registerMember(createValidMember({
        id: 'bob',
        name: 'Bob Frontend',
        roles: ['frontend'],
        status: 'ACTIVE',
      }));
      teamManager.registerMember(createValidMember({
        id: 'charlie',
        name: 'Charlie QA',
        roles: ['qa', 'backend'],
        status: 'INACTIVE',
      }));
    });

    describe('getMember returns correct member data', () => {
      it('should return correct data for existing member', () => {
        const result = teamManager.getMember('alice');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.id).toBe('alice');
          expect(result.value.name).toBe('Alice Developer');
          expect(result.value.roles).toEqual(['backend', 'devops']);
          expect(result.value.status).toBe('ACTIVE');
        }
      });

      it('should return member data without modifying the original', () => {
        const result1 = teamManager.getMember('bob');
        expect(result1.success).toBe(true);

        if (result1.success) {
          // Modify the returned object
          result1.value.name = 'Modified Name';
          result1.value.roles.push('qa' as Role);
        }

        // Original should be unchanged
        const result2 = teamManager.getMember('bob');
        expect(result2.success).toBe(true);
        if (result2.success) {
          expect(result2.value.name).toBe('Bob Frontend');
          expect(result2.value.roles).toEqual(['frontend']);
        }
      });
    });

    describe('getMember returns error for non-existent ID', () => {
      it('should return error for non-existent member ID', () => {
        const result = teamManager.getMember('non-existent-id');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
          expect(result.error.code).toBe(1001);
          expect(result.error.context?.developer_id).toBe('non-existent-id');
        }
      });

      it('should return error for empty string ID', () => {
        const result = teamManager.getMember('');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
        }
      });
    });

    describe('listMembers returns all members', () => {
      it('should return all registered members without filter', () => {
        const members = teamManager.listMembers();

        expect(members).toHaveLength(3);
        const ids = members.map(m => m.id);
        expect(ids).toContain('alice');
        expect(ids).toContain('bob');
        expect(ids).toContain('charlie');
      });

      it('should return empty array when no members registered', () => {
        teamManager.clear();
        const members = teamManager.listMembers();

        expect(members).toEqual([]);
        expect(members).toHaveLength(0);
      });
    });

    describe('listMembers filters by role correctly', () => {
      it('should filter members by backend role', () => {
        const members = teamManager.listMembers({ role: 'backend' });

        expect(members).toHaveLength(2);
        const ids = members.map(m => m.id);
        expect(ids).toContain('alice');
        expect(ids).toContain('charlie');
        expect(ids).not.toContain('bob');
      });

      it('should filter members by frontend role', () => {
        const members = teamManager.listMembers({ role: 'frontend' });

        expect(members).toHaveLength(1);
        expect(members[0].id).toBe('bob');
      });

      it('should filter members by qa role', () => {
        const members = teamManager.listMembers({ role: 'qa' });

        expect(members).toHaveLength(1);
        expect(members[0].id).toBe('charlie');
      });

      it('should return empty array for role with no members', () => {
        const members = teamManager.listMembers({ role: 'fullstack' });

        expect(members).toEqual([]);
        expect(members).toHaveLength(0);
      });

      it('should filter by status', () => {
        const activeMembers = teamManager.listMembers({ status: 'ACTIVE' });
        expect(activeMembers).toHaveLength(2);

        const inactiveMembers = teamManager.listMembers({ status: 'INACTIVE' });
        expect(inactiveMembers).toHaveLength(1);
        expect(inactiveMembers[0].id).toBe('charlie');
      });

      it('should filter by both role and status', () => {
        const members = teamManager.listMembers({ role: 'backend', status: 'ACTIVE' });

        expect(members).toHaveLength(1);
        expect(members[0].id).toBe('alice');
      });
    });

    describe('getMembersByRole returns only members with that role', () => {
      it('should return members with devops role', () => {
        const members = teamManager.getMembersByRole('devops');

        expect(members).toHaveLength(1);
        expect(members[0].id).toBe('alice');
        expect(members[0].roles).toContain('devops');
      });

      it('should return members with backend role', () => {
        const members = teamManager.getMembersByRole('backend');

        expect(members).toHaveLength(2);
        members.forEach(member => {
          expect(member.roles).toContain('backend');
        });
      });

      it('should return empty array for role with no members', () => {
        const members = teamManager.getMembersByRole('lead');

        expect(members).toEqual([]);
      });

      it('should include members regardless of status', () => {
        // charlie is INACTIVE but has backend role
        const members = teamManager.getMembersByRole('backend');

        const ids = members.map(m => m.id);
        expect(ids).toContain('charlie'); // INACTIVE member included
      });
    });
  });

  // ===========================================================================
  // 5. Remove Tests
  // ===========================================================================
  describe('5. Remove Tests', () => {
    beforeEach(() => {
      teamManager.registerMember(createValidMember({
        id: 'dev-to-remove',
        name: 'Removable Developer',
        roles: ['backend'],
      }));
      teamManager.registerMember(createValidMember({
        id: 'dev-to-keep',
        name: 'Keeper Developer',
        roles: ['frontend'],
      }));
    });

    describe('Remove existing member successfully', () => {
      it('should successfully remove an existing member', () => {
        expect(teamManager.size).toBe(2);

        const result = teamManager.removeMember('dev-to-remove');

        expect(result.success).toBe(true);
        expect(teamManager.size).toBe(1);
      });

      it('should not find member after removal', () => {
        teamManager.removeMember('dev-to-remove');

        const getResult = teamManager.getMember('dev-to-remove');
        expect(getResult.success).toBe(false);
        if (!getResult.success) {
          expect(getResult.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
        }
      });

      it('should not affect other members when one is removed', () => {
        teamManager.removeMember('dev-to-remove');

        const keptMember = teamManager.getMember('dev-to-keep');
        expect(keptMember.success).toBe(true);
        if (keptMember.success) {
          expect(keptMember.value.name).toBe('Keeper Developer');
        }
      });

      it('should allow re-registration of ID after removal', () => {
        teamManager.removeMember('dev-to-remove');

        const newMember = createValidMember({
          id: 'dev-to-remove',
          name: 'New Developer',
          roles: ['qa'],
        });

        const result = teamManager.registerMember(newMember);
        expect(result.success).toBe(true);

        const retrieved = teamManager.getMember('dev-to-remove');
        expect(retrieved.success).toBe(true);
        if (retrieved.success) {
          expect(retrieved.value.name).toBe('New Developer');
          expect(retrieved.value.roles).toEqual(['qa']);
        }
      });
    });

    describe('Reject removal of non-existent member', () => {
      it('should return error when removing non-existent member', () => {
        const result = teamManager.removeMember('non-existent-id');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
          expect(result.error.code).toBe(1001);
          expect(result.error.context?.developer_id).toBe('non-existent-id');
        }
      });

      it('should return error when removing with empty ID', () => {
        const result = teamManager.removeMember('');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
        }
      });

      it('should not affect existing members when removal fails', () => {
        const countBefore = teamManager.size;

        teamManager.removeMember('non-existent-id');

        expect(teamManager.size).toBe(countBefore);
      });

      it('should return error when trying to remove same member twice', () => {
        const firstRemoval = teamManager.removeMember('dev-to-remove');
        expect(firstRemoval.success).toBe(true);

        const secondRemoval = teamManager.removeMember('dev-to-remove');
        expect(secondRemoval.success).toBe(false);
        if (!secondRemoval.success) {
          expect(secondRemoval.error.code).toBe(TeamErrorCode.TEAM_MEMBER_NOT_FOUND);
        }
      });
    });
  });

  // ===========================================================================
  // 6. validateDeveloperId Tests
  // ===========================================================================
  describe('6. validateDeveloperId Tests', () => {
    beforeEach(() => {
      teamManager.registerMember(createValidMember({
        id: 'existing-dev',
        name: 'Existing Developer',
      }));
    });

    it('should return true for existing developer ID', () => {
      expect(teamManager.validateDeveloperId('existing-dev')).toBe(true);
    });

    it('should return false for non-existent developer ID', () => {
      expect(teamManager.validateDeveloperId('non-existent')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(teamManager.validateDeveloperId('')).toBe(false);
    });

    it('should be case-sensitive', () => {
      expect(teamManager.validateDeveloperId('EXISTING-DEV')).toBe(false);
      expect(teamManager.validateDeveloperId('Existing-Dev')).toBe(false);
    });
  });

  // ===========================================================================
  // 7. Edge Cases and Boundary Tests
  // ===========================================================================
  describe('7. Edge Cases and Boundary Tests', () => {
    it('should handle IDs with special characters', () => {
      const member = createValidMember({
        id: 'dev-alice-123',
        name: 'Alice',
      });

      const result = teamManager.registerMember(member);
      expect(result.success).toBe(true);

      const retrieved = teamManager.getMember('dev-alice-123');
      expect(retrieved.success).toBe(true);
    });

    it('should handle names with special characters', () => {
      const member = createValidMember({
        id: 'dev-special-name',
        name: "O'Brien-Smith, Jr.",
      });

      const result = teamManager.registerMember(member);
      expect(result.success).toBe(true);

      const retrieved = teamManager.getMember('dev-special-name');
      expect(retrieved.success).toBe(true);
      if (retrieved.success) {
        expect(retrieved.value.name).toBe("O'Brien-Smith, Jr.");
      }
    });

    it('should handle Unicode characters in name', () => {
      const member = createValidMember({
        id: 'dev-unicode',
        name: '田中太郎 (Taro Tanaka)',
      });

      const result = teamManager.registerMember(member);
      expect(result.success).toBe(true);

      const retrieved = teamManager.getMember('dev-unicode');
      expect(retrieved.success).toBe(true);
      if (retrieved.success) {
        expect(retrieved.value.name).toBe('田中太郎 (Taro Tanaka)');
      }
    });

    it('should handle very long names', () => {
      const longName = 'A'.repeat(200);
      const member = createValidMember({
        id: 'dev-long-name',
        name: longName,
      });

      const result = teamManager.registerMember(member);
      expect(result.success).toBe(true);

      const retrieved = teamManager.getMember('dev-long-name');
      expect(retrieved.success).toBe(true);
      if (retrieved.success) {
        expect(retrieved.value.name).toBe(longName);
      }
    });

    it('should handle registering many members', () => {
      teamManager.clear();
      
      const memberCount = 100;
      for (let i = 0; i < memberCount; i++) {
        const member = createValidMember({
          id: `dev-${i.toString().padStart(3, '0')}`,
          name: `Developer ${i}`,
          roles: [VALID_ROLES[i % VALID_ROLES.length]],
        });
        const result = teamManager.registerMember(member);
        expect(result.success).toBe(true);
      }

      expect(teamManager.size).toBe(memberCount);
      
      // Verify a few random members
      const member50 = teamManager.getMember('dev-050');
      expect(member50.success).toBe(true);
      
      const member99 = teamManager.getMember('dev-099');
      expect(member99.success).toBe(true);
    });

    it('should maintain correct order of roles', () => {
      const member = createValidMember({
        id: 'dev-ordered-roles',
        roles: ['lead', 'backend', 'frontend'],
      });

      const result = teamManager.registerMember(member);
      expect(result.success).toBe(true);

      const retrieved = teamManager.getMember('dev-ordered-roles');
      expect(retrieved.success).toBe(true);
      if (retrieved.success) {
        // Roles should maintain the order they were registered in
        expect(retrieved.value.roles[0]).toBe('lead');
        expect(retrieved.value.roles[1]).toBe('backend');
        expect(retrieved.value.roles[2]).toBe('frontend');
      }
    });
  });
});
