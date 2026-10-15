/**
 * Property-Based Tests for Team_Manager
 * 
 * **Feature: multi-developer-support, Property 1: Team Member Registration Uniqueness**
 * 
 * These tests verify the universal correctness properties of the Team_Manager component
 * using property-based testing with fast-check.
 * 
 * **Validates: Requirements 1.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
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
} from '../team-manager';

// =============================================================================
// In-Memory Team_Manager Implementation for Testing
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
  registerMember(member: TeamMember): Result<void, TeamError> {
    // Validate member has at least one role (Requirement 1.4)
    if (!member.roles || member.roles.length === 0) {
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
    this.members.set(member.id, { ...member });
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
   * Lists all members, optionally filtered by role.
   */
  listMembers(filter?: { role?: Role }): TeamMember[] {
    const allMembers = Array.from(this.members.values());
    if (filter?.role) {
      return allMembers.filter(m => m.roles.includes(filter.role!));
    }
    return allMembers;
  }

  /**
   * Gets all members with a specific role.
   */
  getMembersByRole(role: Role): TeamMember[] {
    return this.listMembers({ role });
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
// Arbitraries (Generators) for Property-Based Testing
// =============================================================================

/**
 * Generates a valid developer ID.
 * IDs are non-empty alphanumeric strings with optional hyphens.
 */
const developerIdArb = fc.stringMatching(/^[a-z][a-z0-9-]{2,19}$/).filter(id => id.length >= 3);

/**
 * Generates a valid developer name.
 */
const developerNameArb = fc.string({ minLength: 1, maxLength: 50 }).filter(name => name.trim().length > 0);

/**
 * Generates a valid role from the VALID_ROLES list.
 */
const validRoleArb: fc.Arbitrary<Role> = fc.constantFrom(...VALID_ROLES);

/**
 * Generates a non-empty array of valid roles (1-3 roles).
 */
const validRolesArrayArb: fc.Arbitrary<Role[]> = fc
  .uniqueArray(validRoleArb, { minLength: 1, maxLength: 3 })
  .filter(roles => roles.length > 0);

/**
 * Generates a valid TeamMember object.
 */
const teamMemberArb: fc.Arbitrary<TeamMember> = fc.record({
  id: developerIdArb,
  name: developerNameArb,
  roles: validRolesArrayArb,
  registered_at: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
    .map(d => d.toISOString()),
  status: fc.constantFrom('ACTIVE' as const, 'INACTIVE' as const),
});

/**
 * Generates a list of TeamMembers with unique IDs.
 */
const uniqueTeamMembersArb = (minLength: number, maxLength: number): fc.Arbitrary<TeamMember[]> => {
  return fc.array(teamMemberArb, { minLength, maxLength }).map(members => {
    // Ensure unique IDs by appending index
    const seen = new Set<string>();
    return members.map((member, index) => {
      let id = member.id;
      let suffix = 0;
      while (seen.has(id)) {
        id = `${member.id}-${suffix++}`;
      }
      seen.add(id);
      return { ...member, id };
    });
  });
};

/**
 * Generates a list of TeamMembers where some may have duplicate IDs.
 */
const teamMembersWithPotentialDuplicatesArb = (
  minLength: number,
  maxLength: number
): fc.Arbitrary<TeamMember[]> => {
  return fc.array(teamMemberArb, { minLength, maxLength });
};

// =============================================================================
// Property-Based Tests
// =============================================================================

describe('Team_Manager Property-Based Tests', () => {
  /**
   * **Feature: multi-developer-support, Property 1: Team Member Registration Uniqueness**
   * 
   * *For any* set of team member registrations, the Team_Manager SHALL ensure that
   * no two members have the same id, and attempting to register a duplicate id
   * SHALL result in rejection.
   * 
   * **Validates: Requirements 1.5**
   */
  describe('Property 1: Team Member Registration Uniqueness', () => {
    let teamManager: InMemoryTeamManager;

    beforeEach(() => {
      teamManager = new InMemoryTeamManager();
    });

    it('should accept all team members when all IDs are unique', () => {
      fc.assert(
        fc.property(
          uniqueTeamMembersArb(1, 20),
          (members) => {
            teamManager.clear();
            
            // Register all members - all should succeed since IDs are unique
            for (const member of members) {
              const result = teamManager.registerMember(member);
              expect(result.success).toBe(true);
            }

            // Verify all members were registered
            expect(teamManager.size).toBe(members.length);

            // Verify each member can be retrieved
            for (const member of members) {
              const retrieved = teamManager.getMember(member.id);
              expect(retrieved.success).toBe(true);
              if (retrieved.success) {
                expect(retrieved.value.id).toBe(member.id);
                expect(retrieved.value.name).toBe(member.name);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject duplicate IDs and return appropriate error', () => {
      fc.assert(
        fc.property(
          teamMemberArb,
          teamMemberArb,
          (member1, member2) => {
            teamManager.clear();
            
            // Create a duplicate by using member1's ID for member2
            const duplicateMember: TeamMember = {
              ...member2,
              id: member1.id, // Force duplicate ID
            };

            // First registration should succeed
            const firstResult = teamManager.registerMember(member1);
            expect(firstResult.success).toBe(true);

            // Second registration with same ID should fail
            const secondResult = teamManager.registerMember(duplicateMember);
            expect(secondResult.success).toBe(false);

            if (!secondResult.success) {
              expect(secondResult.error.code).toBe(TeamErrorCode.DUPLICATE_MEMBER_ID);
              expect(secondResult.error.category).toBe('TEAM_ERROR');
              expect(secondResult.error.context?.developer_id).toBe(member1.id);
            }

            // Only one member should be registered
            expect(teamManager.size).toBe(1);

            // The original member should still be retrievable with original data
            const retrieved = teamManager.getMember(member1.id);
            expect(retrieved.success).toBe(true);
            if (retrieved.success) {
              expect(retrieved.value.name).toBe(member1.name);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should correctly identify and reject all duplicates in a batch of registrations', () => {
      fc.assert(
        fc.property(
          teamMembersWithPotentialDuplicatesArb(5, 30),
          (members) => {
            teamManager.clear();
            
            const seenIds = new Set<string>();
            let expectedSuccessCount = 0;
            let expectedFailCount = 0;
            let actualSuccessCount = 0;
            let actualFailCount = 0;

            for (const member of members) {
              const isDuplicate = seenIds.has(member.id);
              
              if (isDuplicate) {
                expectedFailCount++;
              } else {
                expectedSuccessCount++;
                seenIds.add(member.id);
              }

              const result = teamManager.registerMember(member);
              
              if (result.success) {
                actualSuccessCount++;
                // Should not be a duplicate
                expect(isDuplicate).toBe(false);
              } else {
                actualFailCount++;
                // Should be a duplicate
                expect(isDuplicate).toBe(true);
                expect(result.error.code).toBe(TeamErrorCode.DUPLICATE_MEMBER_ID);
              }
            }

            // Verify counts match expectations
            expect(actualSuccessCount).toBe(expectedSuccessCount);
            expect(actualFailCount).toBe(expectedFailCount);
            expect(teamManager.size).toBe(expectedSuccessCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain uniqueness invariant after any sequence of operations', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              // Register operation
              teamMemberArb.map(m => ({ type: 'register' as const, member: m })),
              // Remove operation
              developerIdArb.map(id => ({ type: 'remove' as const, id })),
              // Re-register after remove (should succeed if removed)
              teamMemberArb.map(m => ({ type: 'reregister' as const, member: m }))
            ),
            { minLength: 10, maxLength: 50 }
          ),
          (operations) => {
            teamManager.clear();
            const registeredIds = new Set<string>();

            for (const op of operations) {
              if (op.type === 'register') {
                const result = teamManager.registerMember(op.member);
                
                if (registeredIds.has(op.member.id)) {
                  // Should fail - duplicate
                  expect(result.success).toBe(false);
                  if (!result.success) {
                    expect(result.error.code).toBe(TeamErrorCode.DUPLICATE_MEMBER_ID);
                  }
                } else {
                  // Should succeed - new ID
                  expect(result.success).toBe(true);
                  registeredIds.add(op.member.id);
                }
              } else if (op.type === 'remove') {
                const result = teamManager.removeMember(op.id);
                
                if (registeredIds.has(op.id)) {
                  expect(result.success).toBe(true);
                  registeredIds.delete(op.id);
                } else {
                  expect(result.success).toBe(false);
                }
              } else if (op.type === 'reregister') {
                // Attempt to register - behavior depends on current state
                const result = teamManager.registerMember(op.member);
                
                if (registeredIds.has(op.member.id)) {
                  expect(result.success).toBe(false);
                } else {
                  expect(result.success).toBe(true);
                  registeredIds.add(op.member.id);
                }
              }
            }

            // Final invariant check: no duplicate IDs in the team
            const allMembers = teamManager.listMembers();
            const memberIds = allMembers.map(m => m.id);
            const uniqueMemberIds = new Set(memberIds);
            
            // The number of unique IDs should equal the total number of members
            expect(uniqueMemberIds.size).toBe(memberIds.length);
            expect(teamManager.size).toBe(registeredIds.size);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve original member data when duplicate registration is rejected', () => {
      fc.assert(
        fc.property(
          teamMemberArb,
          developerNameArb,
          validRolesArrayArb,
          (originalMember, newName, newRoles) => {
            teamManager.clear();

            // Register original member
            const firstResult = teamManager.registerMember(originalMember);
            expect(firstResult.success).toBe(true);

            // Attempt to register duplicate with different data
            const duplicateMember: TeamMember = {
              ...originalMember,
              name: newName,
              roles: newRoles,
            };

            const secondResult = teamManager.registerMember(duplicateMember);
            expect(secondResult.success).toBe(false);

            // Verify original data is preserved
            const retrieved = teamManager.getMember(originalMember.id);
            expect(retrieved.success).toBe(true);
            
            if (retrieved.success) {
              expect(retrieved.value.name).toBe(originalMember.name);
              expect(retrieved.value.roles).toEqual(originalMember.roles);
              expect(retrieved.value.registered_at).toBe(originalMember.registered_at);
              expect(retrieved.value.status).toBe(originalMember.status);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should allow re-registration of an ID after the original member is removed', () => {
      fc.assert(
        fc.property(
          teamMemberArb,
          teamMemberArb,
          (member1, member2) => {
            teamManager.clear();

            // Create member2 with same ID as member1 but different data
            const member2WithSameId: TeamMember = {
              ...member2,
              id: member1.id,
            };

            // Register first member
            const registerResult1 = teamManager.registerMember(member1);
            expect(registerResult1.success).toBe(true);

            // Attempt duplicate - should fail
            const duplicateResult = teamManager.registerMember(member2WithSameId);
            expect(duplicateResult.success).toBe(false);

            // Remove original member
            const removeResult = teamManager.removeMember(member1.id);
            expect(removeResult.success).toBe(true);

            // Now re-registration should succeed
            const reregisterResult = teamManager.registerMember(member2WithSameId);
            expect(reregisterResult.success).toBe(true);

            // Verify new data is stored
            const retrieved = teamManager.getMember(member1.id);
            expect(retrieved.success).toBe(true);
            
            if (retrieved.success) {
              expect(retrieved.value.name).toBe(member2.name);
              expect(retrieved.value.roles).toEqual(member2.roles);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});


// =============================================================================
// Additional Arbitraries for Property 2
// =============================================================================

/**
 * Generates an invalid role string that is NOT in VALID_ROLES.
 * Includes various invalid patterns: misspellings, prefixes, suffixes, random strings.
 */
const invalidRoleArb: fc.Arbitrary<string> = fc.oneof(
  // Random alphanumeric strings that are unlikely to match valid roles
  fc.stringMatching(/^[a-z]{3,15}$/).filter(s => !VALID_ROLES.includes(s as Role)),
  // Misspellings and variations of valid roles
  fc.constantFrom(
    'Frontend', // Wrong case
    'BACKEND', // All caps
    'Front-end', // Hyphenated
    'back_end', // Underscored
    'dev-ops', // Hyphenated
    'full_stack', // Underscored
    'qaa', // Typo
    'fronend', // Typo
    'bacend', // Typo
    'qa-engineer', // Extended name
    'senior-lead', // Extended name
    'frontend-dev', // Extended name
    'admin', // Not a valid role
    'manager', // Not a valid role
    'developer', // Not a valid role
    'engineer', // Not a valid role
    '', // Empty string
    '   ', // Whitespace only
    'frontend ', // Trailing space
    ' backend', // Leading space
  ).filter(s => !VALID_ROLES.includes(s.trim() as Role)),
  // Random strings with special characters
  fc.stringMatching(/^[a-z0-9_-]{1,20}$/).filter(s => !VALID_ROLES.includes(s as Role)),
);

/**
 * Generates any role string - either valid or invalid.
 */
const anyRoleStringArb: fc.Arbitrary<string> = fc.oneof(
  validRoleArb.map(r => r as string),
  invalidRoleArb
);

// =============================================================================
// Property 2: Role Validation Consistency
// =============================================================================

describe('Property 2: Role Validation Consistency', () => {
  /**
   * **Feature: multi-developer-support, Property 2: Role Validation Consistency**
   * 
   * *For any* role string provided to any component, the validation result SHALL be
   * consistent: if Team_Manager.validateRole(role) returns true, then all other
   * components SHALL accept that role, and vice versa.
   * 
   * **Validates: Requirements 1.2, 1.3, 4.2**
   */
  let teamManager: InMemoryTeamManager;

  beforeEach(() => {
    teamManager = new InMemoryTeamManager();
  });

  it('validateRole() should accept exactly the roles in VALID_ROLES', () => {
    fc.assert(
      fc.property(
        anyRoleStringArb,
        (roleString) => {
          const isValid = teamManager.validateRole(roleString);
          const expectedValid = VALID_ROLES.includes(roleString as Role);
          
          // validateRole should return true if and only if the role is in VALID_ROLES
          expect(isValid).toBe(expectedValid);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validateRole() should return true for all and only VALID_ROLES', () => {
    // Explicit test for all valid roles
    for (const role of VALID_ROLES) {
      expect(teamManager.validateRole(role)).toBe(true);
    }

    fc.assert(
      fc.property(
        invalidRoleArb,
        (invalidRole) => {
          // All invalid roles should return false
          expect(teamManager.validateRole(invalidRole)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('registerMember() should reject members with invalid roles consistently with validateRole()', () => {
    fc.assert(
      fc.property(
        developerIdArb,
        developerNameArb,
        fc.array(anyRoleStringArb, { minLength: 1, maxLength: 3 }),
        (id, name, roles) => {
          teamManager.clear();

          // Check which roles are valid according to validateRole
          const validRolesInArray = roles.filter(r => teamManager.validateRole(r));
          const invalidRolesInArray = roles.filter(r => !teamManager.validateRole(r));

          const member: TeamMember = {
            id,
            name,
            roles: roles as Role[],
            registered_at: new Date().toISOString(),
            status: 'ACTIVE',
          };

          const result = teamManager.registerMember(member);

          if (invalidRolesInArray.length > 0) {
            // If ANY role is invalid according to validateRole, registration should fail
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
              // The error should reference one of the invalid roles
              expect(invalidRolesInArray).toContain(result.error.context?.role);
            }
          } else if (validRolesInArray.length === 0) {
            // No valid roles means no roles were provided or all were empty
            expect(result.success).toBe(false);
          } else {
            // All roles are valid - registration should succeed (assuming unique ID)
            expect(result.success).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isValidRole() function should be consistent with validateRole() method', () => {
    fc.assert(
      fc.property(
        anyRoleStringArb,
        (roleString) => {
          const methodResult = teamManager.validateRole(roleString);
          const functionResult = isValidRole(roleString);
          
          // Both should return the same result for any role string
          expect(methodResult).toBe(functionResult);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validation should be consistent across multiple calls for the same role string', () => {
    fc.assert(
      fc.property(
        anyRoleStringArb,
        fc.integer({ min: 2, max: 10 }),
        (roleString, callCount) => {
          const results: boolean[] = [];
          
          // Call validateRole multiple times
          for (let i = 0; i < callCount; i++) {
            results.push(teamManager.validateRole(roleString));
          }
          
          // All results should be identical
          const firstResult = results[0];
          expect(results.every(r => r === firstResult)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('VALID_ROLES constant should be exhaustive - all accepted roles should be in the list', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,20}$/),
        (potentialRole) => {
          const isAccepted = teamManager.validateRole(potentialRole);
          
          if (isAccepted) {
            // If validateRole accepts it, it MUST be in VALID_ROLES
            expect(VALID_ROLES).toContain(potentialRole);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('role validation should be case-sensitive', () => {
    fc.assert(
      fc.property(
        validRoleArb,
        (validRole) => {
          // Valid role in original case should be accepted
          expect(teamManager.validateRole(validRole)).toBe(true);
          
          // Same role with different case should be rejected
          const upperCase = validRole.toUpperCase();
          const mixedCase = validRole.charAt(0).toUpperCase() + validRole.slice(1);
          
          if (upperCase !== validRole) {
            expect(teamManager.validateRole(upperCase)).toBe(false);
          }
          if (mixedCase !== validRole) {
            expect(teamManager.validateRole(mixedCase)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('role validation should reject roles with whitespace', () => {
    fc.assert(
      fc.property(
        validRoleArb,
        (validRole) => {
          // Role with leading space
          expect(teamManager.validateRole(' ' + validRole)).toBe(false);
          
          // Role with trailing space
          expect(teamManager.validateRole(validRole + ' ')).toBe(false);
          
          // Role with surrounding spaces
          expect(teamManager.validateRole(' ' + validRole + ' ')).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('registerMember() role validation should match validateRole() for all generated scenarios', () => {
    fc.assert(
      fc.property(
        developerIdArb,
        developerNameArb,
        anyRoleStringArb,
        (id, name, singleRole) => {
          teamManager.clear();

          const isValidAccordingToValidateRole = teamManager.validateRole(singleRole);

          const member: TeamMember = {
            id,
            name,
            roles: [singleRole] as Role[],
            registered_at: new Date().toISOString(),
            status: 'ACTIVE',
          };

          const result = teamManager.registerMember(member);

          if (isValidAccordingToValidateRole) {
            // If validateRole says it's valid, registerMember should accept it
            expect(result.success).toBe(true);
          } else {
            // If validateRole says it's invalid, registerMember should reject it with INVALID_ROLE
            expect(result.success).toBe(false);
            if (!result.success) {
              expect(result.error.code).toBe(TeamErrorCode.INVALID_ROLE);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
