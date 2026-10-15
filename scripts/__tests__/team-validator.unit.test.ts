/**
 * Unit Tests for team-validator.ts
 * 
 * These tests verify all validation functions in the team-validator module
 * including member validation, assignment validation, dependency validation,
 * parallel group validation, handoff validation, and statistics validation.
 * 
 * **Validates: Requirements 1.3, 1.5, 4.1, 4.2, 5.2, 7.5, 11.2**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Validation functions
  validateMemberIdUniqueness,
  validateMemberNames,
  validateMemberRoles,
  validateMemberStatus,
  validateMemberTimestamps,
  validateAssignmentReferences,
  validateAssigneeRoles,
  validateDependencyCycles,
  validateSelfDependencies,
  validateParallelGroupDependencies,
  validateHandoffChecklists,
  validateTeamStatistics,
  validateTeamConfiguration,
  formatValidationResult,
  // Types and constants
  ValidationErrorCode,
  ValidationIssue,
  ValidationResult,
  ValidationOptions,
  VALID_MEMBER_STATUSES,
} from '../team-validator';

import {
  TeamMember,
  Role,
  VALID_ROLES,
  TeamSection,
} from '../team-manager';

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

/**
 * Creates a valid team section for testing.
 */
function createValidTeamSection(members: TeamMember[] = []): TeamSection {
  const byRole: Record<string, number> = {
    frontend: 0,
    backend: 0,
    qa: 0,
    devops: 0,
    fullstack: 0,
    lead: 0,
  };
  
  for (const member of members) {
    if (member.status === 'ACTIVE' && member.roles) {
      for (const role of member.roles) {
        if (byRole[role] !== undefined) {
          byRole[role]++;
        }
      }
    }
  }
  
  return {
    members,
    statistics: {
      total_members: members.length,
      by_role: byRole as any,
    },
  };
}

/**
 * Creates a task info object for testing.
 */
function createTaskInfo(overrides: Partial<{
  id: string;
  assignee?: string;
  role_required?: string;
  depends_on?: Array<{ taskId: string; dependsOn: string; type: 'blocking' | 'non_blocking' }>;
  parallel_group?: string;
}> = {}): { id: string; assignee?: string; role_required?: string; depends_on?: any[]; parallel_group?: string } {
  return {
    id: overrides.id ?? 'TASK-001',
    assignee: overrides.assignee,
    role_required: overrides.role_required,
    depends_on: overrides.depends_on,
    parallel_group: overrides.parallel_group,
  };
}

/**
 * Creates a parallel group info object for testing.
 */
function createParallelGroup(overrides: Partial<{
  id: string;
  name: string;
  tasks: string[];
  status: string;
}> = {}): { id: string; name: string; tasks: string[]; status: string } {
  return {
    id: overrides.id ?? 'PG-001',
    name: overrides.name ?? 'Test Group',
    tasks: overrides.tasks ?? ['TASK-001', 'TASK-002'],
    status: overrides.status ?? 'IN_PROGRESS',
  };
}

/**
 * Creates a handoff point info object for testing.
 */
function createHandoffPoint(overrides: Partial<{
  id: string;
  name: string;
  source_role: string;
  target_role: string;
  checklist: Array<{ id: string; description: string; required: boolean }>;
}> = {}): { id: string; name: string; source_role: string; target_role: string; checklist: any[] } {
  return {
    id: overrides.id ?? 'HP-001',
    name: overrides.name ?? 'Test Handoff',
    source_role: overrides.source_role ?? 'backend',
    target_role: overrides.target_role ?? 'frontend',
    checklist: overrides.checklist ?? [
      { id: 'CHK-001', description: 'Test checklist item', required: true },
    ],
  };
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('team-validator Unit Tests', () => {
  // ===========================================================================
  // 1. validateMemberIdUniqueness Tests
  // Validates: Requirement 1.5
  // ===========================================================================
  describe('1. validateMemberIdUniqueness', () => {
    describe('Accept members with unique IDs', () => {
      it('should return no issues for members with unique IDs', () => {
        const members = [
          createValidMember({ id: 'dev-001' }),
          createValidMember({ id: 'dev-002' }),
          createValidMember({ id: 'dev-003' }),
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for empty members array', () => {
        const issues = validateMemberIdUniqueness([]);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for single member', () => {
        const members = [createValidMember({ id: 'only-one' })];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject members with duplicate IDs', () => {
      it('should return DUPLICATE_MEMBER_ID error for duplicate IDs', () => {
        const members = [
          createValidMember({ id: 'dev-001', name: 'First Dev' }),
          createValidMember({ id: 'dev-001', name: 'Second Dev' }),
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.DUPLICATE_MEMBER_ID);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toContain('dev-001');
        expect(issues[0].path).toContain('team.members[1]');
      });
      
      it('should detect multiple duplicate IDs', () => {
        const members = [
          createValidMember({ id: 'dup-1' }),
          createValidMember({ id: 'dup-1' }),
          createValidMember({ id: 'dup-2' }),
          createValidMember({ id: 'dup-2' }),
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues.length).toBeGreaterThanOrEqual(2);
        expect(issues.every(i => i.code === ValidationErrorCode.DUPLICATE_MEMBER_ID)).toBe(true);
      });
    });
    
    describe('Handle missing or invalid IDs', () => {
      it('should return MISSING_MEMBER_ID error for undefined ID', () => {
        const members = [
          { name: 'No ID', roles: ['backend'], status: 'ACTIVE', registered_at: '' } as any,
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.MISSING_MEMBER_ID);
        expect(issues[0].severity).toBe('error');
      });
      
      it('should return MISSING_MEMBER_ID error for null ID', () => {
        const members = [
          { id: null, name: 'Null ID', roles: ['backend'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.MISSING_MEMBER_ID);
      });
      
      it('should return MISSING_MEMBER_ID error for empty string ID', () => {
        const members = [
          createValidMember({ id: '' }),
        ];
        
        const issues = validateMemberIdUniqueness(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.MISSING_MEMBER_ID);
      });
    });
  });

  // ===========================================================================
  // 2. validateMemberNames Tests
  // ===========================================================================
  describe('2. validateMemberNames', () => {
    describe('Accept members with valid names', () => {
      it('should return no issues for members with valid names', () => {
        const members = [
          createValidMember({ id: 'dev-1', name: 'Alice Developer' }),
          createValidMember({ id: 'dev-2', name: 'Bob Smith' }),
        ];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept single character names', () => {
        const members = [createValidMember({ name: 'A' })];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject members with empty or invalid names', () => {
      it('should return EMPTY_MEMBER_NAME error for empty name', () => {
        const members = [createValidMember({ name: '' })];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.EMPTY_MEMBER_NAME);
        expect(issues[0].severity).toBe('error');
      });
      
      it('should return EMPTY_MEMBER_NAME error for whitespace-only name', () => {
        const members = [createValidMember({ name: '   ' })];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.EMPTY_MEMBER_NAME);
      });
      
      it('should return EMPTY_MEMBER_NAME error for null name', () => {
        const members = [{ id: 'dev-1', name: null, roles: ['backend'], status: 'ACTIVE' } as any];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.EMPTY_MEMBER_NAME);
      });
      
      it('should return EMPTY_MEMBER_NAME error for undefined name', () => {
        const members = [{ id: 'dev-1', roles: ['backend'], status: 'ACTIVE' } as any];
        
        const issues = validateMemberNames(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.EMPTY_MEMBER_NAME);
      });
      
      it('should include member ID in error message when available', () => {
        const members = [createValidMember({ id: 'dev-test', name: '' })];
        
        const issues = validateMemberNames(members);
        
        expect(issues[0].message).toContain('dev-test');
      });
    });
  });

  // ===========================================================================
  // 3. validateMemberRoles Tests
  // Validates: Requirements 1.3, 4.2
  // ===========================================================================
  describe('3. validateMemberRoles', () => {
    describe('Accept members with valid roles', () => {
      it('should accept all valid roles', () => {
        const members = VALID_ROLES.map((role, i) => 
          createValidMember({ id: `dev-${i}`, roles: [role] })
        );
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept members with multiple valid roles', () => {
        const members = [
          createValidMember({ id: 'dev-1', roles: ['frontend', 'backend'] }),
          createValidMember({ id: 'dev-2', roles: ['qa', 'devops', 'lead'] }),
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept members with all valid roles', () => {
        const members = [
          createValidMember({ id: 'dev-all', roles: [...VALID_ROLES] as Role[] }),
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject members with invalid roles', () => {
      it('should return INVALID_ROLE error for invalid role', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['invalidrole'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_ROLE);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].value).toBe('invalidrole');
      });
      
      it('should reject misspelled roles', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['fronend'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_ROLE);
      });
      
      it('should reject roles with wrong casing', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['BACKEND'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_ROLE);
      });
      
      it('should detect multiple invalid roles in same member', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['invalid1', 'invalid2'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(2);
        expect(issues.every(i => i.code === ValidationErrorCode.INVALID_ROLE)).toBe(true);
      });
      
      it('should reject invalid role even when mixed with valid roles', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['backend', 'invalidrole', 'frontend'], status: 'ACTIVE' } as any,
        ];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_ROLE);
        expect(issues[0].value).toBe('invalidrole');
      });
    });
    
    describe('Reject members with no roles', () => {
      it('should return NO_ROLES_ASSIGNED error for empty roles array', () => {
        const members = [createValidMember({ roles: [] })];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.NO_ROLES_ASSIGNED);
        expect(issues[0].severity).toBe('error');
      });
      
      it('should return NO_ROLES_ASSIGNED error for undefined roles', () => {
        const members = [{ id: 'dev-1', name: 'Test', status: 'ACTIVE' } as any];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.NO_ROLES_ASSIGNED);
      });
      
      it('should return NO_ROLES_ASSIGNED error for null roles', () => {
        const members = [{ id: 'dev-1', name: 'Test', roles: null, status: 'ACTIVE' } as any];
        
        const issues = validateMemberRoles(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.NO_ROLES_ASSIGNED);
      });
      
      it('should include suggestion with valid roles in error', () => {
        const members = [createValidMember({ roles: [] })];
        
        const issues = validateMemberRoles(members);
        
        expect(issues[0].suggestion).toBeDefined();
        expect(issues[0].suggestion).toContain('frontend');
        expect(issues[0].suggestion).toContain('backend');
      });
    });
  });

  // ===========================================================================
  // 4. validateMemberStatus Tests
  // ===========================================================================
  describe('4. validateMemberStatus', () => {
    describe('Accept valid status values', () => {
      it('should accept ACTIVE status', () => {
        const members = [createValidMember({ status: 'ACTIVE' })];
        
        const issues = validateMemberStatus(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept INACTIVE status', () => {
        const members = [createValidMember({ status: 'INACTIVE' })];
        
        const issues = validateMemberStatus(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept undefined status (optional field)', () => {
        const members = [{ id: 'dev-1', name: 'Test', roles: ['backend'] } as any];
        
        const issues = validateMemberStatus(members);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject invalid status values', () => {
      it('should return INVALID_MEMBER_STATUS error for invalid status', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['backend'], status: 'INVALID' } as any,
        ];
        
        const issues = validateMemberStatus(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_MEMBER_STATUS);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].value).toBe('INVALID');
      });
      
      it('should reject lowercase status', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['backend'], status: 'active' } as any,
        ];
        
        const issues = validateMemberStatus(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_MEMBER_STATUS);
      });
      
      it('should include valid statuses in suggestion', () => {
        const members = [
          { id: 'dev-1', name: 'Test', roles: ['backend'], status: 'PENDING' } as any,
        ];
        
        const issues = validateMemberStatus(members);
        
        expect(issues[0].suggestion).toContain('ACTIVE');
        expect(issues[0].suggestion).toContain('INACTIVE');
      });
    });
  });

  // ===========================================================================
  // 5. validateMemberTimestamps Tests
  // ===========================================================================
  describe('5. validateMemberTimestamps', () => {
    describe('Accept valid ISO timestamps', () => {
      it('should accept valid ISO 8601 timestamp', () => {
        const members = [createValidMember({ registered_at: '2024-01-15T10:00:00.000Z' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept timestamp without milliseconds', () => {
        const members = [createValidMember({ registered_at: '2024-01-15T10:00:00Z' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept timestamp with timezone offset', () => {
        const members = [createValidMember({ registered_at: '2024-01-15T10:00:00+05:30' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept date-only string (parseable as ISO)', () => {
        const members = [createValidMember({ registered_at: '2024-01-15' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Report invalid timestamps as warnings', () => {
      it('should return warning for invalid timestamp string', () => {
        const members = [createValidMember({ registered_at: 'not-a-date' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_REGISTERED_AT);
        expect(issues[0].severity).toBe('warning');
        expect(issues[0].value).toBe('not-a-date');
      });
      
      it('should return warning for empty string timestamp', () => {
        const members = [createValidMember({ registered_at: '' })];
        
        const issues = validateMemberTimestamps(members);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_REGISTERED_AT);
      });
    });
  });

  // ===========================================================================
  // 6. validateAssignmentReferences Tests
  // Validates: Requirement 4.1
  // ===========================================================================
  describe('6. validateAssignmentReferences', () => {
    describe('Accept valid assignment references', () => {
      it('should return no issues when assignee exists', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'dev-001' }),
        };
        const memberIds = new Set(['dev-001', 'dev-002']);
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept task without assignee', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001' }),
        };
        const memberIds = new Set(['dev-001']);
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept valid role_required', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', role_required: 'backend' }),
        };
        const memberIds = new Set<string>();
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject invalid assignment references', () => {
      it('should return ASSIGNEE_NOT_FOUND error for non-existent assignee', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'non-existent' }),
        };
        const memberIds = new Set(['dev-001']);
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.ASSIGNEE_NOT_FOUND);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].value).toBe('non-existent');
        expect(issues[0].message).toContain('TASK-001');
      });
      
      it('should return INVALID_ROLE_REQUIRED error for invalid role', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', role_required: 'invalidrole' }),
        };
        const memberIds = new Set<string>();
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.INVALID_ROLE_REQUIRED);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].value).toBe('invalidrole');
      });
      
      it('should detect multiple invalid references', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'ghost-1' }),
          'TASK-002': createTaskInfo({ id: 'TASK-002', assignee: 'ghost-2' }),
        };
        const memberIds = new Set(['dev-001']);
        
        const issues = validateAssignmentReferences(tasks, memberIds);
        
        expect(issues).toHaveLength(2);
      });
    });
  });

  // ===========================================================================
  // 7. validateAssigneeRoles Tests
  // Validates: Requirement 4.2
  // ===========================================================================
  describe('7. validateAssigneeRoles', () => {
    describe('Accept when assignee has required role', () => {
      it('should return no issues when assignee has the required role', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'dev-001', role_required: 'backend' }),
        };
        const memberRoles = new Map<string, Role[]>([
          ['dev-001', ['backend', 'devops']],
        ]);
        
        const issues = validateAssigneeRoles(tasks, memberRoles);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept when no role_required is specified', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'dev-001' }),
        };
        const memberRoles = new Map<string, Role[]>([
          ['dev-001', ['backend']],
        ]);
        
        const issues = validateAssigneeRoles(tasks, memberRoles);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept when no assignee is specified', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', role_required: 'backend' }),
        };
        const memberRoles = new Map<string, Role[]>();
        
        const issues = validateAssigneeRoles(tasks, memberRoles);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject when assignee lacks required role', () => {
      it('should return ASSIGNEE_MISSING_REQUIRED_ROLE error', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'dev-001', role_required: 'frontend' }),
        };
        const memberRoles = new Map<string, Role[]>([
          ['dev-001', ['backend', 'devops']],
        ]);
        
        const issues = validateAssigneeRoles(tasks, memberRoles);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.ASSIGNEE_MISSING_REQUIRED_ROLE);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toContain('TASK-001');
        expect(issues[0].message).toContain('frontend');
        expect(issues[0].message).toContain('dev-001');
      });
      
      it('should include assignee roles in error message', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001', assignee: 'dev-qa', role_required: 'backend' }),
        };
        const memberRoles = new Map<string, Role[]>([
          ['dev-qa', ['qa', 'lead']],
        ]);
        
        const issues = validateAssigneeRoles(tasks, memberRoles);
        
        expect(issues[0].message).toContain('qa');
        expect(issues[0].message).toContain('lead');
      });
    });
  });

  // ===========================================================================
  // 8. validateDependencyCycles Tests
  // Validates: Requirement 7.5
  // ===========================================================================
  describe('8. validateDependencyCycles', () => {
    describe('Accept acyclic dependency graphs', () => {
      it('should return no issues for linear dependencies', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-002', ['TASK-001']],
          ['TASK-003', ['TASK-002']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for diamond dependencies', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-002', ['TASK-001']],
          ['TASK-003', ['TASK-001']],
          ['TASK-004', ['TASK-002', 'TASK-003']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for empty dependency graph', () => {
        const dependencies = new Map<string, string[]>();
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues when tasks have no dependencies', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-001', []],
          ['TASK-002', []],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Detect circular dependencies', () => {
      it('should return CIRCULAR_DEPENDENCY error for simple cycle', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-001', ['TASK-002']],
          ['TASK-002', ['TASK-001']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.CIRCULAR_DEPENDENCY);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toContain('Circular dependency');
      });
      
      it('should detect longer cycles (A -> B -> C -> A)', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-001', ['TASK-003']],
          ['TASK-002', ['TASK-001']],
          ['TASK-003', ['TASK-002']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.CIRCULAR_DEPENDENCY);
      });
      
      it('should include cycle path in error value', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-A', ['TASK-B']],
          ['TASK-B', ['TASK-A']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(Array.isArray(issues[0].value)).toBe(true);
      });
      
      it('should include suggestion to break the cycle', () => {
        const dependencies = new Map<string, string[]>([
          ['TASK-001', ['TASK-002']],
          ['TASK-002', ['TASK-001']],
        ]);
        
        const issues = validateDependencyCycles(dependencies);
        
        expect(issues[0].suggestion).toBeDefined();
        expect(issues[0].suggestion).toContain('Remove');
      });
    });
  });

  // ===========================================================================
  // 9. validateSelfDependencies Tests
  // ===========================================================================
  describe('9. validateSelfDependencies', () => {
    describe('Accept tasks without self-dependencies', () => {
      it('should return no issues for valid dependencies', () => {
        const tasks = {
          'TASK-001': createTaskInfo({
            id: 'TASK-001',
            depends_on: [{ taskId: 'TASK-001', dependsOn: 'TASK-002', type: 'blocking' }],
          }),
        };
        
        const issues = validateSelfDependencies(tasks);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for tasks without dependencies', () => {
        const tasks = {
          'TASK-001': createTaskInfo({ id: 'TASK-001' }),
        };
        
        const issues = validateSelfDependencies(tasks);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Reject self-dependencies', () => {
      it('should return SELF_DEPENDENCY error when task depends on itself via dependsOn', () => {
        const tasks = {
          'TASK-001': createTaskInfo({
            id: 'TASK-001',
            depends_on: [{ taskId: 'TASK-001', dependsOn: 'TASK-001', type: 'blocking' }],
          }),
        };
        
        const issues = validateSelfDependencies(tasks);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.SELF_DEPENDENCY);
        expect(issues[0].severity).toBe('error');
        expect(issues[0].message).toContain('TASK-001');
      });
      
      it('should return SELF_DEPENDENCY error when task depends on itself via taskId', () => {
        const tasks = {
          'TASK-002': createTaskInfo({
            id: 'TASK-002',
            depends_on: [{ taskId: 'TASK-002', dependsOn: 'OTHER', type: 'blocking' }],
          }),
        };
        
        const issues = validateSelfDependencies(tasks);
        
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe(ValidationErrorCode.SELF_DEPENDENCY);
      });
    });
  });

  // ===========================================================================
  // 10. validateParallelGroupDependencies Tests
  // Validates: Requirement 5.2
  // ===========================================================================
  describe('10. validateParallelGroupDependencies', () => {
    describe('Accept parallel groups without internal blocking dependencies', () => {
      it('should return no issues for group with no dependencies', () => {
        const groups = [createParallelGroup({ tasks: ['TASK-001', 'TASK-002', 'TASK-003'] })];
        const dependencies = new Map<string, Array<{ dependsOn: string; type: string }>>();
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept internal non-blocking dependencies', () => {
        const groups = [createParallelGroup({ tasks: ['TASK-001', 'TASK-002'] })];
        const dependencies = new Map([
          ['TASK-001', [{ dependsOn: 'TASK-002', type: 'non_blocking' }]],
        ]);
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        // Should not contain INTERNAL_BLOCKING_DEPENDENCY error
        const blockingIssues = issues.filter(i => i.code === ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY);
        expect(blockingIssues).toHaveLength(0);
      });
      
      it('should accept dependencies on tasks outside the group', () => {
        const groups = [createParallelGroup({ tasks: ['TASK-001', 'TASK-002'] })];
        const dependencies = new Map([
          ['TASK-001', [{ dependsOn: 'TASK-003', type: 'blocking' }]], // TASK-003 is not in the group
        ]);
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const blockingIssues = issues.filter(i => i.code === ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY);
        expect(blockingIssues).toHaveLength(0);
      });
    });
    
    describe('Reject parallel groups with internal blocking dependencies', () => {
      it('should return INTERNAL_BLOCKING_DEPENDENCY error', () => {
        const groups = [createParallelGroup({ id: 'PG-001', tasks: ['TASK-001', 'TASK-002'] })];
        const dependencies = new Map([
          ['TASK-001', [{ dependsOn: 'TASK-002', type: 'blocking' }]],
        ]);
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const blockingIssues = issues.filter(i => i.code === ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY);
        expect(blockingIssues).toHaveLength(1);
        expect(blockingIssues[0].severity).toBe('error');
        expect(blockingIssues[0].message).toContain('PG-001');
        expect(blockingIssues[0].message).toContain('TASK-001');
        expect(blockingIssues[0].message).toContain('TASK-002');
      });
      
      it('should detect multiple internal blocking dependencies', () => {
        const groups = [createParallelGroup({ tasks: ['T1', 'T2', 'T3'] })];
        const dependencies = new Map([
          ['T1', [{ dependsOn: 'T2', type: 'blocking' }]],
          ['T2', [{ dependsOn: 'T3', type: 'blocking' }]],
        ]);
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const blockingIssues = issues.filter(i => i.code === ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY);
        expect(blockingIssues).toHaveLength(2);
      });
    });
    
    describe('Detect duplicate group IDs', () => {
      it('should return DUPLICATE_GROUP_ID error', () => {
        const groups = [
          createParallelGroup({ id: 'PG-001', name: 'Group 1' }),
          createParallelGroup({ id: 'PG-001', name: 'Group 2' }),
        ];
        const dependencies = new Map<string, Array<{ dependsOn: string; type: string }>>();
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const dupIssues = issues.filter(i => i.code === ValidationErrorCode.DUPLICATE_GROUP_ID);
        expect(dupIssues).toHaveLength(1);
        expect(dupIssues[0].severity).toBe('error');
        expect(dupIssues[0].value).toBe('PG-001');
      });
    });
    
    describe('Detect empty parallel groups', () => {
      it('should return PARALLEL_GROUP_EMPTY error for empty tasks array', () => {
        const groups = [createParallelGroup({ id: 'PG-EMPTY', tasks: [] })];
        const dependencies = new Map<string, Array<{ dependsOn: string; type: string }>>();
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const emptyIssues = issues.filter(i => i.code === ValidationErrorCode.PARALLEL_GROUP_EMPTY);
        expect(emptyIssues).toHaveLength(1);
        expect(emptyIssues[0].severity).toBe('error');
        expect(emptyIssues[0].message).toContain('PG-EMPTY');
      });
      
      it('should return PARALLEL_GROUP_EMPTY error for undefined tasks', () => {
        const groups = [{ id: 'PG-NO-TASKS', name: 'No Tasks', status: 'IN_PROGRESS' } as any];
        const dependencies = new Map<string, Array<{ dependsOn: string; type: string }>>();
        
        const issues = validateParallelGroupDependencies(groups, dependencies);
        
        const emptyIssues = issues.filter(i => i.code === ValidationErrorCode.PARALLEL_GROUP_EMPTY);
        expect(emptyIssues).toHaveLength(1);
      });
    });
  });

  // ===========================================================================
  // 11. validateHandoffChecklists Tests
  // Validates: Requirement 11.2
  // ===========================================================================
  describe('11. validateHandoffChecklists', () => {
    describe('Accept valid handoff points', () => {
      it('should return no issues for valid handoff point with checklist', () => {
        const handoffPoints = [createHandoffPoint()];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept handoff point with multiple checklist items', () => {
        const handoffPoints = [createHandoffPoint({
          checklist: [
            { id: 'CHK-001', description: 'Item 1', required: true },
            { id: 'CHK-002', description: 'Item 2', required: false },
            { id: 'CHK-003', description: 'Item 3', required: true },
          ],
        })];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should accept all valid source and target roles', () => {
        for (const sourceRole of VALID_ROLES) {
          for (const targetRole of VALID_ROLES) {
            const handoffPoints = [createHandoffPoint({ 
              id: `HP-${sourceRole}-${targetRole}`,
              source_role: sourceRole, 
              target_role: targetRole,
            })];
            
            const issues = validateHandoffChecklists(handoffPoints);
            
            const roleIssues = issues.filter(i => 
              i.code === ValidationErrorCode.INVALID_SOURCE_ROLE || 
              i.code === ValidationErrorCode.INVALID_TARGET_ROLE
            );
            expect(roleIssues).toHaveLength(0);
          }
        }
      });
    });
    
    describe('Reject handoff points with empty checklist', () => {
      it('should return EMPTY_HANDOFF_CHECKLIST error', () => {
        const handoffPoints = [createHandoffPoint({ id: 'HP-EMPTY', checklist: [] })];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const emptyIssues = issues.filter(i => i.code === ValidationErrorCode.EMPTY_HANDOFF_CHECKLIST);
        expect(emptyIssues).toHaveLength(1);
        expect(emptyIssues[0].severity).toBe('error');
        expect(emptyIssues[0].message).toContain('HP-EMPTY');
      });
      
      it('should return EMPTY_HANDOFF_CHECKLIST error for undefined checklist', () => {
        const handoffPoints = [{
          id: 'HP-NO-CHECKLIST',
          name: 'No Checklist',
          source_role: 'backend',
          target_role: 'frontend',
        } as any];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const emptyIssues = issues.filter(i => i.code === ValidationErrorCode.EMPTY_HANDOFF_CHECKLIST);
        expect(emptyIssues).toHaveLength(1);
      });
    });
    
    describe('Reject invalid source or target roles', () => {
      it('should return INVALID_SOURCE_ROLE error for invalid source_role', () => {
        const handoffPoints = [createHandoffPoint({ source_role: 'invalidrole' })];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const roleIssues = issues.filter(i => i.code === ValidationErrorCode.INVALID_SOURCE_ROLE);
        expect(roleIssues).toHaveLength(1);
        expect(roleIssues[0].severity).toBe('error');
        expect(roleIssues[0].value).toBe('invalidrole');
      });
      
      it('should return INVALID_TARGET_ROLE error for invalid target_role', () => {
        const handoffPoints = [createHandoffPoint({ target_role: 'badrole' })];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const roleIssues = issues.filter(i => i.code === ValidationErrorCode.INVALID_TARGET_ROLE);
        expect(roleIssues).toHaveLength(1);
        expect(roleIssues[0].severity).toBe('error');
        expect(roleIssues[0].value).toBe('badrole');
      });
    });
    
    describe('Detect duplicate handoff point IDs', () => {
      it('should return DUPLICATE_HANDOFF_POINT_ID error', () => {
        const handoffPoints = [
          createHandoffPoint({ id: 'HP-DUP' }),
          createHandoffPoint({ id: 'HP-DUP' }),
        ];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const dupIssues = issues.filter(i => i.code === ValidationErrorCode.DUPLICATE_HANDOFF_POINT_ID);
        expect(dupIssues).toHaveLength(1);
        expect(dupIssues[0].value).toBe('HP-DUP');
      });
    });
    
    describe('Detect duplicate checklist item IDs', () => {
      it('should return DUPLICATE_CHECKLIST_ITEM_ID error', () => {
        const handoffPoints = [createHandoffPoint({
          checklist: [
            { id: 'CHK-001', description: 'Item 1', required: true },
            { id: 'CHK-001', description: 'Item 2', required: false },
          ],
        })];
        
        const issues = validateHandoffChecklists(handoffPoints);
        
        const dupIssues = issues.filter(i => i.code === ValidationErrorCode.DUPLICATE_CHECKLIST_ITEM_ID);
        expect(dupIssues).toHaveLength(1);
        expect(dupIssues[0].value).toBe('CHK-001');
      });
    });
  });

  // ===========================================================================
  // 12. validateTeamStatistics Tests
  // ===========================================================================
  describe('12. validateTeamStatistics', () => {
    describe('Accept accurate statistics', () => {
      it('should return no issues for correct statistics', () => {
        const members = [
          createValidMember({ id: 'dev-1', roles: ['backend'], status: 'ACTIVE' }),
          createValidMember({ id: 'dev-2', roles: ['frontend'], status: 'ACTIVE' }),
        ];
        const team = createValidTeamSection(members);
        
        const issues = validateTeamStatistics(team);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should return no issues for empty team', () => {
        const team = createValidTeamSection([]);
        
        const issues = validateTeamStatistics(team);
        
        expect(issues).toHaveLength(0);
      });
      
      it('should not count INACTIVE members in role statistics', () => {
        const members = [
          createValidMember({ id: 'dev-1', roles: ['backend'], status: 'ACTIVE' }),
          createValidMember({ id: 'dev-2', roles: ['backend'], status: 'INACTIVE' }),
        ];
        // Create team with correct statistics (only ACTIVE members counted for roles)
        const team: TeamSection = {
          members,
          statistics: {
            total_members: 2, // Total includes all members
            by_role: {
              frontend: 0,
              backend: 1, // Only ACTIVE backend
              qa: 0,
              devops: 0,
              fullstack: 0,
              lead: 0,
            },
          },
        };
        
        const issues = validateTeamStatistics(team);
        
        expect(issues).toHaveLength(0);
      });
    });
    
    describe('Report statistics mismatches as warnings', () => {
      it('should return STATISTICS_MISMATCH warning for wrong total_members', () => {
        const members = [
          createValidMember({ id: 'dev-1' }),
          createValidMember({ id: 'dev-2' }),
        ];
        const team: TeamSection = {
          members,
          statistics: {
            total_members: 5, // Wrong!
            by_role: { frontend: 0, backend: 2, qa: 0, devops: 0, fullstack: 0, lead: 0 },
          },
        };
        
        const issues = validateTeamStatistics(team);
        
        const mismatchIssues = issues.filter(i => i.code === ValidationErrorCode.STATISTICS_MISMATCH);
        expect(mismatchIssues).toHaveLength(1);
        expect(mismatchIssues[0].severity).toBe('warning');
        expect(mismatchIssues[0].message).toContain('5');
        expect(mismatchIssues[0].message).toContain('2');
      });
      
      it('should return ROLE_COUNT_MISMATCH warning for wrong role count', () => {
        const members = [
          createValidMember({ id: 'dev-1', roles: ['backend'], status: 'ACTIVE' }),
          createValidMember({ id: 'dev-2', roles: ['backend'], status: 'ACTIVE' }),
        ];
        const team: TeamSection = {
          members,
          statistics: {
            total_members: 2,
            by_role: {
              frontend: 0,
              backend: 5, // Wrong!
              qa: 0,
              devops: 0,
              fullstack: 0,
              lead: 0,
            },
          },
        };
        
        const issues = validateTeamStatistics(team);
        
        const roleIssues = issues.filter(i => i.code === ValidationErrorCode.ROLE_COUNT_MISMATCH);
        expect(roleIssues.length).toBeGreaterThanOrEqual(1);
        const backendIssue = roleIssues.find(i => i.path.includes('backend'));
        expect(backendIssue).toBeDefined();
        expect(backendIssue!.severity).toBe('warning');
      });
      
      it('should handle members with multiple roles in statistics', () => {
        const members = [
          createValidMember({ id: 'dev-1', roles: ['backend', 'devops'], status: 'ACTIVE' }),
        ];
        const team: TeamSection = {
          members,
          statistics: {
            total_members: 1,
            by_role: {
              frontend: 0,
              backend: 1,
              qa: 0,
              devops: 1,
              fullstack: 0,
              lead: 0,
            },
          },
        };
        
        const issues = validateTeamStatistics(team);
        
        expect(issues).toHaveLength(0);
      });
    });
  });

  // ===========================================================================
  // 13. validateTeamConfiguration (Main Function) Tests
  // ===========================================================================
  describe('13. validateTeamConfiguration', () => {
    describe('Validate complete valid configuration', () => {
      it('should return valid result for valid configuration', () => {
        const state = {
          team: createValidTeamSection([
            createValidMember({ id: 'dev-1', roles: ['backend'], status: 'ACTIVE' }),
          ]),
        };
        
        const result = validateTeamConfiguration(state as any);
        
        expect(result.valid).toBe(true);
        expect(result.errorCount).toBe(0);
        expect(result.issues).toHaveLength(0);
        expect(result.validatedAt).toBeDefined();
      });
      
      it('should return valid result for configuration with no team', () => {
        const state = {};
        
        const result = validateTeamConfiguration(state as any);
        
        expect(result.valid).toBe(true);
        expect(result.errorCount).toBe(0);
      });
    });
    
    describe('Combine multiple validation errors', () => {
      it('should collect errors from multiple validation functions', () => {
        const state = {
          team: {
            members: [
              { id: 'dev-1', name: '', roles: [], status: 'INVALID' }, // Multiple errors
            ],
            statistics: {
              total_members: 5, // Wrong
              by_role: { frontend: 0, backend: 0, qa: 0, devops: 0, fullstack: 0, lead: 0 },
            },
          },
        };
        
        const result = validateTeamConfiguration(state as any);
        
        expect(result.valid).toBe(false);
        expect(result.errorCount).toBeGreaterThan(0);
        expect(result.issues.length).toBeGreaterThan(1);
      });
      
      it('should report both errors and warnings', () => {
        const state = {
          team: {
            members: [
              createValidMember({ id: 'dev-1', registered_at: 'invalid-date' }), // Warning
              createValidMember({ id: 'dev-1' }), // Error: duplicate ID
            ],
            statistics: {
              total_members: 2,
              by_role: { frontend: 0, backend: 2, qa: 0, devops: 0, fullstack: 0, lead: 0 },
            },
          },
        };
        
        const result = validateTeamConfiguration(state as any);
        
        expect(result.errorCount).toBeGreaterThan(0);
        expect(result.warningCount).toBeGreaterThan(0);
        expect(result.valid).toBe(false); // Has errors
      });
    });
    
    describe('Respect validation options', () => {
      it('should exclude warnings when includeWarnings is false', () => {
        const state = {
          team: {
            members: [
              createValidMember({ registered_at: 'bad-timestamp' }), // This creates a warning
            ],
            statistics: {
              total_members: 1,
              by_role: { frontend: 0, backend: 1, qa: 0, devops: 0, fullstack: 0, lead: 0 },
            },
          },
        };
        
        const result = validateTeamConfiguration(state as any, { includeWarnings: false });
        
        // Warnings should be excluded
        const warnings = result.issues.filter(i => i.severity === 'warning');
        expect(warnings).toHaveLength(0);
      });
      
      it('should skip dependency validation when validateDependencies is false', () => {
        const state = {
          team: createValidTeamSection([createValidMember()]),
          tasks_data: {
            'TASK-001': { id: 'TASK-001', depends_on: [{ taskId: 'TASK-001', dependsOn: 'TASK-001', type: 'blocking' }] },
          },
        };
        
        const result = validateTeamConfiguration(state as any, { validateDependencies: false });
        
        const depIssues = result.issues.filter(i => 
          i.code === ValidationErrorCode.SELF_DEPENDENCY || 
          i.code === ValidationErrorCode.CIRCULAR_DEPENDENCY
        );
        expect(depIssues).toHaveLength(0);
      });
      
      it('should skip parallel group validation when validateParallelGroups is false', () => {
        const state = {
          team: createValidTeamSection([createValidMember()]),
          tasks_data: {
            'TASK-001': { id: 'TASK-001', depends_on: [{ dependsOn: 'TASK-002', type: 'blocking' }] },
            'TASK-002': { id: 'TASK-002' },
          },
          parallel_groups: [{ id: 'PG-001', name: 'Group', tasks: ['TASK-001', 'TASK-002'], status: 'IN_PROGRESS' }],
        };
        
        const result = validateTeamConfiguration(state as any, { validateParallelGroups: false });
        
        const pgIssues = result.issues.filter(i => i.code === ValidationErrorCode.INTERNAL_BLOCKING_DEPENDENCY);
        expect(pgIssues).toHaveLength(0);
      });
      
      it('should skip handoff validation when validateHandoffs is false', () => {
        const state = {
          team: createValidTeamSection([createValidMember()]),
          handoff_points: [{ id: 'HP-001', name: 'Bad', source_role: 'bad', target_role: 'bad', checklist: [] }],
        };
        
        const result = validateTeamConfiguration(state as any, { validateHandoffs: false });
        
        const handoffIssues = result.issues.filter(i => 
          i.code === ValidationErrorCode.EMPTY_HANDOFF_CHECKLIST ||
          i.code === ValidationErrorCode.INVALID_SOURCE_ROLE ||
          i.code === ValidationErrorCode.INVALID_TARGET_ROLE
        );
        expect(handoffIssues).toHaveLength(0);
      });
      
      it('should skip statistics validation when validateStatistics is false', () => {
        const state = {
          team: {
            members: [createValidMember()],
            statistics: {
              total_members: 999, // Wrong
              by_role: { frontend: 0, backend: 999, qa: 0, devops: 0, fullstack: 0, lead: 0 },
            },
          },
        };
        
        const result = validateTeamConfiguration(state as any, { validateStatistics: false });
        
        const statIssues = result.issues.filter(i => 
          i.code === ValidationErrorCode.STATISTICS_MISMATCH ||
          i.code === ValidationErrorCode.ROLE_COUNT_MISMATCH
        );
        expect(statIssues).toHaveLength(0);
      });
    });
  });

  // ===========================================================================
  // 14. formatValidationResult Tests
  // ===========================================================================
  describe('14. formatValidationResult', () => {
    it('should format valid result correctly', () => {
      const result: ValidationResult = {
        valid: true,
        errorCount: 0,
        warningCount: 0,
        issues: [],
        validatedAt: '2024-01-15T10:00:00.000Z',
      };
      
      const output = formatValidationResult(result);
      
      expect(output).toContain('VALID');
      expect(output).toContain('Errors: 0');
      expect(output).toContain('Warnings: 0');
      expect(output).toContain('No issues found');
    });
    
    it('should format invalid result with issues correctly', () => {
      const result: ValidationResult = {
        valid: false,
        errorCount: 1,
        warningCount: 1,
        issues: [
          {
            code: ValidationErrorCode.DUPLICATE_MEMBER_ID,
            severity: 'error',
            message: 'Duplicate ID found',
            path: 'team.members[1].id',
            value: 'dup-id',
            suggestion: 'Use unique IDs',
          },
          {
            code: ValidationErrorCode.STATISTICS_MISMATCH,
            severity: 'warning',
            message: 'Statistics mismatch',
            path: 'team.statistics.total_members',
          },
        ],
        validatedAt: '2024-01-15T10:00:00.000Z',
      };
      
      const output = formatValidationResult(result);
      
      expect(output).toContain('INVALID');
      expect(output).toContain('Errors: 1');
      expect(output).toContain('Warnings: 1');
      expect(output).toContain('Duplicate ID found');
      expect(output).toContain('Statistics mismatch');
      expect(output).toContain('Use unique IDs');
      expect(output).toContain('team.members[1].id');
    });
    
    it('should include error codes in formatted output', () => {
      const result: ValidationResult = {
        valid: false,
        errorCount: 1,
        warningCount: 0,
        issues: [{
          code: ValidationErrorCode.INVALID_ROLE,
          severity: 'error',
          message: 'Invalid role',
          path: 'team.members[0].roles[0]',
        }],
        validatedAt: '2024-01-15T10:00:00.000Z',
      };
      
      const output = formatValidationResult(result);
      
      expect(output).toContain(`[${ValidationErrorCode.INVALID_ROLE}]`);
    });
  });
});
