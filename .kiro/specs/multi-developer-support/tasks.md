# Implementation Plan: Multi-Developer Support

## Overview

This implementation plan extends the SDLC Workflow Power to support multi-developer team scenarios. The plan follows TDD methodology and implements six core components: Team_Manager, Task_Assigner, Dependency_Resolver, Workload_Analyzer, Handoff_Coordinator, and Parallel_Group_Manager.

Implementation proceeds in phases: schema enhancements first (non-breaking), then core components, followed by steering file updates and integration.

## Tasks

- [x] 1. Enhance project-state.yaml template with team sections
  - [x] 1.1 Add team section with members array and statistics to project-state.yaml.tmpl
    - Add `team.members[]` schema with id, name, roles, registered_at, status fields
    - Add `team.statistics` with total_members and by_role counts
    - Add validation rules for team section
    - _Requirements: 14.1, 14.4_
  
  - [x] 1.2 Add parallel_groups section to project-state.yaml.tmpl
    - Add `parallel_groups[]` schema with id, name, milestone, tasks, status, progress fields
    - Add validation rules for parallel groups
    - _Requirements: 14.2_
  
  - [x] 1.3 Add handoff_points and handoffs sections to project-state.yaml.tmpl
    - Add `handoff_points[]` schema with id, name, source_role, target_role, checklist
    - Add `handoffs[]` schema with full handoff record fields
    - Add validation rules for handoffs
    - _Requirements: 14.3_
  
  - [x] 1.4 Add by_assignee tracking to tasks section
    - Extend `tasks` section with `by_assignee` object tracking task counts per developer
    - Add `current_task.assignee` field
    - _Requirements: 14.1_

- [x] 2. Enhance task.md.tmpl with multi-developer fields
  - [x] 2.1 Add assignment fields to task.md.tmpl
    - Add `assignee` field for developer ID
    - Add `role_required` field for role specification
    - Add `assigned_at` and `assigned_by` fields
    - _Requirements: 13.1, 13.2_
  
  - [x] 2.2 Add depends_on field to task.md.tmpl
    - Add `depends_on[]` array with task_id and type (blocking/non_blocking)
    - Add reason field for dependency documentation
    - _Requirements: 13.3_
  
  - [x] 2.3 Add parallel_group and assignment_history fields to task.md.tmpl
    - Add `parallel_group` field for group association
    - Add `assignment_history[]` array with previous_assignee, new_assignee, timestamp, reason
    - _Requirements: 13.4, 16.1, 16.2_

- [x] 3. Checkpoint - Ensure schema enhancements are complete
  - Ensure all template changes are valid YAML
  - Ask the user if questions arise

- [x] 4. Implement Team_Manager component
  - [x] 4.1 Create Team_Manager interface and type definitions
    - Create `scripts/team-manager.ts` with TeamMember, Role, TeamError types
    - Define Team_Manager interface with all methods from design
    - Define valid roles constant: frontend, backend, qa, devops, fullstack, lead
    - _Requirements: 1.1, 1.2, 2.1_
  
  - [x] 4.2 Write property test for team member registration uniqueness
    - **Property 1: Team Member Registration Uniqueness**
    - Generate random team member registrations, verify no duplicates accepted
    - **Validates: Requirements 1.5**
  
  - [x] 4.3 Implement registerMember and removeMember methods
    - Implement ID uniqueness validation
    - Implement role validation against valid_roles list
    - Implement multi-role assignment support
    - Write to project-state.yaml team.members section
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6_
  
  - [x] 4.4 Write property test for role validation consistency
    - **Property 2: Role Validation Consistency**
    - Generate random role strings, verify consistent validation across components
    - **Validates: Requirements 1.2, 1.3, 4.2**
  
  - [x] 4.5 Implement getMember, listMembers, getMembersByRole methods
    - Implement member lookup by ID
    - Implement filtering by role
    - Return empty list with message when no members exist
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [x] 4.6 Write unit tests for Team_Manager
    - Test registration with valid/invalid data
    - Test duplicate ID rejection
    - Test role validation
    - Test multi-role assignment
    - _Requirements: 1.1-1.6, 2.1-2.3_

- [x] 5. Implement Task_Assigner component
  - [x] 5.1 Create Task_Assigner interface and type definitions
    - Create `scripts/task-assigner.ts` with Assignment, AssignmentError types
    - Define Task_Assigner interface with all methods from design
    - Define AssignmentHistoryEntry type
    - _Requirements: 3.1, 3.2, 4.3_
  
  - [x] 5.2 Write property test for assignment role constraint
    - **Property 3: Assignment Role Constraint**
    - Verify assignee's roles include role_required or assignment is rejected
    - **Validates: Requirements 3.3, 3.4**
  
  - [x] 5.3 Implement assignTask and validateAssignment methods
    - Validate developer exists via Team_Manager
    - Validate developer has required role
    - Record assignment timestamp
    - Reject assignment to non-existent developer
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.3_
  
  - [x] 5.4 Implement unassignTask and pickupTask methods
    - Implement role-required task pickup with role verification
    - Mark unassigned tasks as available for pickup
    - _Requirements: 3.5, 3.6_
  
  - [x] 5.5 Write property test for assignment history completeness
    - **Property 11: Assignment History Completeness**
    - Verify assignment_history contains entry for each change with correct values
    - **Validates: Requirements 16.1, 16.2**
  
  - [x] 5.6 Implement getAssignmentHistory and assignment history recording
    - Record previous_assignee, new_assignee, timestamp on each change
    - Preserve complete assignment history
    - Return all assignment changes with timestamps
    - _Requirements: 16.1, 16.2, 16.3_
  
  - [x] 5.7 Write unit tests for Task_Assigner
    - Test valid assignment scenarios
    - Test role mismatch rejection
    - Test assignment history recording
    - Test unassigned task pickup
    - _Requirements: 3.1-3.6, 4.1-4.3, 16.1-16.3_

- [x] 6. Checkpoint - Ensure Team_Manager and Task_Assigner tests pass
  - Ensure all tests pass, ask the user if questions arise

- [x] 7. Implement Dependency_Resolver component
  - [x] 7.1 Create Dependency_Resolver interface and type definitions
    - Create `scripts/dependency-resolver.ts` with Dependency, DependencyType, DependencyError types
    - Define Dependency_Resolver interface with all methods from design
    - Define CycleDetectionResult and MermaidDiagram types
    - _Requirements: 7.1, 7.2_
  
  - [x] 7.2 Write property test for dependency cycle detection
    - **Property 4: Dependency Cycle Detection**
    - Generate random task graphs, verify cycle detection correctness
    - **Validates: Requirements 7.5**
  
  - [x] 7.3 Implement addDependency with cycle detection
    - Support blocking and non_blocking dependency types
    - Detect circular dependencies using DFS
    - Reject self-dependencies
    - _Requirements: 7.1, 7.2, 7.5_
  
  - [x] 7.4 Write property test for blocking dependency state constraint
    - **Property 5: Blocking Dependency State Constraint**
    - Generate random state transitions, verify dependency constraints enforced
    - **Validates: Requirements 7.3**
  
  - [x] 7.5 Implement canTransitionToInProgress method
    - Check all blocking dependencies are DONE
    - Prevent IN_PROGRESS transition if blocking deps unsatisfied
    - _Requirements: 7.3_
  
  - [x] 7.6 Write property test for non-blocking dependency completion constraint
    - **Property 6: Non-Blocking Dependency Completion Constraint**
    - Verify tasks cannot transition to DONE with unsatisfied non-blocking deps
    - **Validates: Requirements 7.4**
  
  - [x] 7.7 Implement canTransitionToDone method
    - Check all non-blocking dependencies are DONE
    - Prevent DONE transition if non-blocking deps unsatisfied
    - _Requirements: 7.4_
  
  - [x] 7.8 Implement generateDependencyGraph for visualization
    - Generate Mermaid diagram format
    - Highlight cross-role dependencies
    - Identify and mark critical path tasks
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  
  - [x] 7.9 Write unit tests for Dependency_Resolver
    - Test cycle detection algorithms
    - Test blocking/non-blocking behavior
    - Test critical path calculation
    - _Requirements: 7.1-7.5, 8.1-8.4_

- [x] 8. Implement Parallel_Group_Manager component
  - [x] 8.1 Create Parallel_Group_Manager interface and type definitions
    - Create `scripts/parallel-group-manager.ts` with ParallelGroup, ParallelGroupError types
    - Define Parallel_Group_Manager interface with all methods from design
    - Define GroupProgress type
    - _Requirements: 5.1, 6.1_
  
  - [x] 8.2 Write property test for parallel group internal dependency constraint
    - **Property 7: Parallel Group Internal Dependency Constraint**
    - Verify groups with internal blocking dependencies are rejected
    - **Validates: Requirements 5.2, 5.3**
  
  - [x] 8.3 Implement createParallelGroup with internal dependency validation
    - Validate no internal blocking dependencies
    - Register group in project-state.yaml
    - Associate with milestone if provided
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [x] 8.4 Write property test for parallel group progress accuracy
    - **Property 10: Parallel Group Progress Accuracy**
    - Verify progress equals (completed/total)*100 and COMPLETE status accuracy
    - **Validates: Requirements 6.1, 6.3**
  
  - [x] 8.5 Implement getGroupProgress and group completion tracking
    - Calculate completion percentage
    - Track task status within group
    - Mark group COMPLETE when all tasks DONE
    - _Requirements: 5.5, 6.1, 6.2, 6.3_
  
  - [x] 8.6 Write unit tests for Parallel_Group_Manager
    - Test internal dependency validation
    - Test progress calculation
    - Test completion detection
    - _Requirements: 5.1-5.5, 6.1-6.3_

- [x] 9. Checkpoint - Ensure Dependency_Resolver and Parallel_Group_Manager tests pass
  - Ensure all tests pass, ask the user if questions arise

- [x] 10. Implement Workload_Analyzer component
  - [x] 10.1 Create Workload_Analyzer interface and type definitions
    - Create `scripts/workload-analyzer.ts` with WorkloadSummary, Bottleneck types
    - Define Workload_Analyzer interface with all methods from design
    - Define StatusCounts and RebalanceRecommendation types
    - _Requirements: 9.1, 10.1_
  
  - [x] 10.2 Write property test for workload calculation consistency
    - **Property 9: Workload Calculation Consistency**
    - Verify task counts match between getTasksByDeveloper and getTaskCountByStatus
    - **Validates: Requirements 9.1**
  
  - [x] 10.3 Implement calculateWorkload and getTeamWorkloadDistribution
    - Count tasks per developer by status
    - Calculate estimated effort per developer if estimates available
    - _Requirements: 9.1, 9.2_
  
  - [x] 10.4 Write property test for bottleneck detection threshold
    - **Property 12: Bottleneck Detection Threshold**
    - Verify developers with >3 IN_PROGRESS/BLOCKED tasks identified as bottlenecks
    - **Validates: Requirements 10.1**
  
  - [x] 10.5 Implement identifyBottlenecks method
    - Identify developers with >3 IN_PROGRESS/BLOCKED tasks
    - Identify roles with more pending tasks than available developers
    - Include bottlenecks in status reports with recommendations
    - _Requirements: 9.3, 10.1, 10.2, 10.3_
  
  - [x] 10.6 Write unit tests for Workload_Analyzer
    - Test task counting accuracy
    - Test bottleneck threshold detection
    - Test average calculation
    - _Requirements: 9.1-9.3, 10.1-10.3_

- [x] 11. Implement Handoff_Coordinator component
  - [x] 11.1 Create Handoff_Coordinator interface and type definitions
    - Create `scripts/handoff-coordinator.ts` with HandoffPoint, HandoffRecord types
    - Define Handoff_Coordinator interface with all methods from design
    - Define ChecklistItem and HandoffStatus types
    - _Requirements: 11.1, 12.1_
  
  - [x] 11.2 Write property test for handoff checklist completion gate
    - **Property 8: Handoff Checklist Completion Gate**
    - Verify handoffs cannot complete until all required checklist items done
    - **Validates: Requirements 11.4**
  
  - [x] 11.3 Implement defineHandoffPoint method
    - Require at least one checklist item
    - Register handoff point in project configuration
    - _Requirements: 11.1, 11.2_
  
  - [x] 11.4 Implement initiateHandoff and handoff record creation
    - Create handoff record linking source and target tasks
    - Validate source task is complete
    - Notify target role of pending handoff
    - _Requirements: 11.3, 12.1, 12.2_
  
  - [x] 11.5 Implement acceptHandoff and rejectHandoff methods
    - Record acceptance timestamp and developer ID
    - Return rejected tasks to source with reason
    - Validate target developer has correct role
    - _Requirements: 12.3, 12.4_
  
  - [x] 11.6 Write unit tests for Handoff_Coordinator
    - Test checklist state management
    - Test acceptance/rejection flows
    - Test notification triggers
    - _Requirements: 11.1-11.4, 12.1-12.4_

- [x] 12. Checkpoint - Ensure Workload_Analyzer and Handoff_Coordinator tests pass
  - Ensure all tests pass, ask the user if questions arise

- [x] 13. Create team-validator.js script
  - [x] 13.1 Implement team validation logic in scripts/team-validator.js
    - Validate team member IDs are unique
    - Validate all roles are valid
    - Validate assignment references exist
    - Validate dependency graph has no cycles
    - Validate parallel groups have no internal blocking dependencies
    - Validate handoff checklists have at least one item
    - _Requirements: 1.3, 1.5, 4.1, 4.2, 5.2, 7.5, 11.2_
  
  - [x] 13.2 Write unit tests for team-validator.js
    - Test all validation rules
    - Test error message formatting
    - _Requirements: 1.3, 1.5, 4.1, 4.2, 5.2, 7.5, 11.2_

- [x] 14. Create steering/11-team.md for team management commands
  - [x] 14.1 Create 11-team.md with team management steering content
    - Document `team add` command for registering team members
    - Document `team list` command for viewing team composition
    - Document `team remove` command for removing members
    - Document `team assign` command for task assignment
    - Document `team workload` command for workload view
    - Document `team handoff` commands for handoff management
    - _Requirements: 1.1, 2.1, 3.1, 9.1, 11.1, 12.1_

- [x] 15. Update steering/05-planning.md with multi-developer task generation
  - [x] 15.1 Update 05-planning.md to support multi-developer task creation
    - Add guidance for assigning tasks to roles
    - Add guidance for defining parallel task groups
    - Add guidance for specifying cross-role dependencies
    - Document task template enhancements usage
    - _Requirements: 3.1, 3.2, 5.1, 7.1, 13.1-13.4_

- [x] 16. Update steering/06-implementation.md with parallel TDD coordination
  - [x] 16.1 Update 06-implementation.md to support parallel TDD
    - Add guidance for parallel TDD cycles
    - Add dependency-aware phase transitions
    - Add handoff integration during implementation
    - Document parallel group progress tracking
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 17. Update steering files for team-aware functionality
  - [x] 17.1 Update validate.md with team validation rules
    - Add team member validation
    - Add assignment validation
    - Add dependency cycle validation
    - Add parallel group validation
    - _Requirements: 1.3, 1.5, 4.1, 4.2, 5.2, 7.5_
  
  - [x] 17.2 Update status.md with team-aware status reporting
    - Include team workload in status output
    - Include parallel group progress
    - Include active handoffs
    - Identify bottlenecks in status
    - _Requirements: 2.1, 6.1, 9.1, 10.1_
  
  - [x] 17.3 Update resume.md with team context recovery
    - Recover team member context
    - Recover assignment state
    - Recover parallel group progress
    - Recover pending handoffs
    - _Requirements: 14.1-14.4_

- [x] 18. Integration testing
  - [x] 18.1 Write integration test for end-to-end assignment flow
    - Register team → Create task → Assign → Verify state
    - _Requirements: 1.1, 3.1, 4.3_
  
  - [x] 18.2 Write integration test for dependency-aware TDD flow
    - Create dependent tasks → Verify blocking → Complete dependency → Verify unblocking
    - _Requirements: 7.3, 7.4, 15.2_
  
  - [x] 18.3 Write integration test for complete handoff flow
    - Define handoff point → Complete source task → Initiate → Checklist → Accept → Start target
    - _Requirements: 11.1-11.4, 12.1-12.4_
  
  - [x] 18.4 Write integration test for parallel execution flow
    - Create parallel group → Multiple developers work → Verify progress
    - _Requirements: 5.1-5.5, 6.1-6.3, 15.3_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (12 properties from design)
- Unit tests validate specific examples and edge cases
- Implementation uses TypeScript as specified in the design document interfaces
- Schema enhancements (tasks 1-2) are non-breaking and maintain backward compatibility
- Component implementation follows the dependency order: Team_Manager → Task_Assigner → Dependency_Resolver → Parallel_Group_Manager → Workload_Analyzer → Handoff_Coordinator

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3"] },
    { "id": 2, "tasks": ["4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "4.5"] },
    { "id": 5, "tasks": ["4.6", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["5.4", "5.5"] },
    { "id": 8, "tasks": ["5.6", "5.7", "7.1"] },
    { "id": 9, "tasks": ["7.2", "7.3"] },
    { "id": 10, "tasks": ["7.4", "7.5"] },
    { "id": 11, "tasks": ["7.6", "7.7"] },
    { "id": 12, "tasks": ["7.8", "7.9", "8.1"] },
    { "id": 13, "tasks": ["8.2", "8.3"] },
    { "id": 14, "tasks": ["8.4", "8.5"] },
    { "id": 15, "tasks": ["8.6", "10.1"] },
    { "id": 16, "tasks": ["10.2", "10.3"] },
    { "id": 17, "tasks": ["10.4", "10.5"] },
    { "id": 18, "tasks": ["10.6", "11.1"] },
    { "id": 19, "tasks": ["11.2", "11.3"] },
    { "id": 20, "tasks": ["11.4", "11.5"] },
    { "id": 21, "tasks": ["11.6", "13.1"] },
    { "id": 22, "tasks": ["13.2", "14.1"] },
    { "id": 23, "tasks": ["15.1", "16.1"] },
    { "id": 24, "tasks": ["17.1", "17.2", "17.3"] },
    { "id": 25, "tasks": ["18.1", "18.2", "18.3", "18.4"] }
  ]
}
```
