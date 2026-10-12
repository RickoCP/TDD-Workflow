# Requirements Document: SDLC Workflow Reliability

## Pendahuluan

Dokumen ini mendefinisikan requirements untuk meningkatkan reliabilitas, konsistensi, dan keamanan SDLC Workflow Power. Spesifikasi ini melengkapi fitur Multi-Developer Support yang sudah diimplementasikan dengan menambahkan:

- Mekanisme concurrency control dan atomic ownership
- Checkpoint dan crash recovery
- Evidence lifecycle dan validasi otomatis
- Release lifecycle end-to-end
- Audit logging
- Actor type policies (human vs AI agent)
- Definition of Ready enforcement

## Kondisi Existing

### Sudah Diimplementasikan dan Terverifikasi

| Komponen | Status | Lokasi |
|----------|--------|--------|
| Team_Manager | ✓ Implemented | `scripts/team-manager.ts` |
| Task_Assigner | ✓ Implemented | `scripts/task-assigner.ts` |
| Dependency_Resolver | ✓ Implemented | `scripts/dependency-resolver.ts` |
| Parallel_Group_Manager | ✓ Implemented | `scripts/parallel-group-manager.ts` |
| Workload_Analyzer | ✓ Implemented | `scripts/workload-analyzer.ts` |
| Handoff_Coordinator | ✓ Implemented | `scripts/handoff-coordinator.ts` |
| Team_Validator | ✓ Implemented | `scripts/team-validator.ts` |
| SDLC Guard (TDD enforcement) | ✓ Implemented | `scripts/sdlc-guard.js` |
| Project state template | ✓ Updated | `templates/project-state.yaml.tmpl` |
| Task template | ✓ Updated | `templates/task.md.tmpl` |
| 13 steering files | ✓ Complete | `steering/*.md` |
| Unit tests | ✓ Complete | `scripts/__tests__/*.unit.test.ts` |
| Property tests | ✓ Complete | `scripts/__tests__/*.property.test.ts` |
| Integration tests | ✓ Complete | `scripts/__tests__/integration/*.ts` |

### Belum Diimplementasikan (Gap Analysis)

| Kebutuhan | Status | Catatan |
|-----------|--------|---------|
| Atomic task ownership claim | ❌ Missing | Tidak ada version/optimistic locking |
| Lease/heartbeat untuk AI agent | ❌ Missing | Tidak ada timeout mechanism |
| Fencing token | ❌ Missing | Worker lama bisa overwrite |
| Checkpoint/recovery | ❌ Missing | Hanya prosedural di resume.md |
| Evidence staleness detection | ❌ Partial | Manual, tidak otomatis per commit |
| Merge queue/serial integration | ❌ Missing | Hanya dokumentasi |
| Release lifecycle automation | ❌ Partial | Tahapan didokumentasikan, tidak di-enforce |
| Audit logging | ❌ Missing | Tidak ada operation ID, correlation |
| Actor type (HUMAN/AI_AGENT) | ❌ Missing | Tidak ada policy berbeda |
| Definition of Ready enforcement | ❌ Missing | Hanya prosedural |
| Review finding register | ❌ Missing | Tidak ada tracking formal |

### Arsitektur Saat Ini

- **State Storage**: File YAML di `.kiro/sdlc/`
- **Enforcement**: Steering files (prosedural) + sdlc-guard.js (PreToolUse hook)
- **Git Integration**: Konseptual, tidak ada automation
- **External Services**: Tidak ada (standalone)

## Glossary

| Term | Definition |
|------|------------|
| State Version | Nomor urut yang di-increment setiap perubahan state untuk optimistic concurrency |
| Lease | Hak sementara untuk mengerjakan task dengan durasi terbatas |
| Heartbeat | Signal periodik dari worker untuk mempertahankan lease |
| Fencing Token | Identifier unik per ownership period yang mencegah stale owner menulis |
| Checkpoint | Snapshot state minimum yang cukup untuk resume setelah crash |
| Evidence | Bukti verifikasi dengan metadata (commit SHA, timestamp, command, result) |
| Definition of Ready (DoR) | Kriteria yang harus dipenuhi sebelum task boleh dimulai |
| Definition of Done (DoD) | Kriteria yang harus dipenuhi sebelum task dianggap selesai |
| Finding | Issue yang ditemukan saat review dengan severity dan status |
| Actor | Pelaksana task: HUMAN atau AI_AGENT |

## Aktor

| Actor | Description |
|-------|-------------|
| Project Lead | Mengelola tim, assignment, approval gates |
| Developer (Human) | Mengerjakan task dengan TDD cycle |
| AI Agent | Autonomous worker dengan batasan lease/capability |
| Reviewer | Memeriksa deliverable dan approval gates |
| System | Automated processes (hooks, validation) |

---

## Requirements

### R01 — Definition of Ready

**User Story:** Sebagai project lead, saya ingin memastikan task hanya boleh dimulai jika kondisi kesiapan terpenuhi, sehingga developer tidak terblokir karena informasi/dependency yang belum tersedia.

#### Acceptance Criteria

**R01.1** WHEN task akan di-transisi ke IN_PROGRESS, THEN sistem SHALL memvalidasi semua kondisi Definition of Ready terpenuhi.

**R01.2** Definition of Ready SHALL mencakup:
- Scope dan acceptance criteria terdefinisi (non-empty)
- Semua blocking dependencies dalam status DONE
- Keputusan yang menghambat (linked DEC-xxx) telah resolved
- Assignee memiliki role yang sesuai dengan role_required

**R01.3** IF kondisi DoR tidak terpenuhi, THEN sistem SHALL menolak transisi dengan pesan yang menyebutkan kondisi mana yang gagal.

**R01.4** WHEN task memiliki blocker aktif (BLOCKER-xxx dengan status OPEN), THEN task tersebut SHALL ditandai BLOCKED dan tidak boleh transisi ke IN_PROGRESS.

**R01.5** Sistem SHALL menyimpan DoR check result sebagai bagian dari task metadata dengan timestamp.

**R01.6** WHEN kondisi dependency berubah (upstream task re-opened atau requirement berubah), THEN sistem SHALL re-evaluate DoR dan update status task terdampak.

---

### R02 — Task Ownership dan Concurrency Control

**User Story:** Sebagai developer, saya ingin memastikan hanya satu orang yang aktif mengerjakan task pada satu waktu, sehingga tidak terjadi konflik perubahan.

#### Acceptance Criteria

**R02.1** Setiap record di project-state.yaml SHALL memiliki field `state_version` (integer, increment on every write).

**R02.2** WHEN update ke state dilakukan, sistem SHALL menggunakan optimistic concurrency:
- Baca current version
- Validasi expected version == current version
- Jika cocok, increment version dan write
- Jika tidak cocok, reject dengan CONFLICT error

**R02.3** Task assignment SHALL bersifat atomic: claim berhasil sepenuhnya atau gagal sepenuhnya.

**R02.4** WHEN task sudah memiliki assignee aktif, THEN assignment ke developer lain SHALL ditolak dengan error TASK_ALREADY_ASSIGNED, kecuali melalui explicit reassignment atau handoff.

**R02.5** Setiap ownership period SHALL memiliki `fencing_token` (UUID) yang di-generate saat claim.

**R02.6** Operasi write ke task/evidence SHALL menyertakan fencing_token; write dengan token yang tidak match current ownership SHALL ditolak.

**R02.7** Untuk AI Agent, ownership SHALL memiliki:
- `lease_acquired_at`: timestamp saat lease dimulai
- `lease_duration_seconds`: durasi lease (configurable, default 3600)
- `last_heartbeat_at`: timestamp heartbeat terakhir
- `heartbeat_interval_seconds`: interval heartbeat (configurable, default 300)

**R02.8** WHEN `last_heartbeat_at + (2 * heartbeat_interval_seconds) < current_time`, THEN lease dianggap expired dan ownership dapat diambil alih.

**R02.9** WHEN lease expired, sistem SHALL:
- Mencatat expiry di audit log
- Menandai task sebagai ABANDONED (state ortogonal)
- Memperbolehkan claim oleh worker lain

**R02.10** Human developer TIDAK terikat lease timeout, tetapi inactivity warning DAPAT ditampilkan setelah configurable period.

**R02.11** Retry operasi yang gagal karena version conflict SHALL idempotent: operasi yang sudah berhasil tidak menyebabkan duplicate effect.

---

### R03 — Isolasi Pekerjaan dan Deteksi Konflik

**User Story:** Sebagai developer, saya ingin pekerjaan saya terisolasi dari developer lain sampai siap di-merge, sehingga tidak ada interference selama development.

#### Acceptance Criteria

**R03.1** Sistem SHALL mendefinisikan mekanisme isolasi yang didukung:
- Git branch per task (default)
- Git worktree per task (optional, jika multi-worktree digunakan)

**R03.2** WHEN task dimulai (transisi ke IN_PROGRESS), sistem SHALL:
- Mencatat `working_branch` di task metadata
- Validate branch belum digunakan task lain yang aktif

**R03.3** Sistem SHALL mengidentifikasi potential conflict zones:
- Files yang di-list di `expected_files` task
- Database migration files (pattern configurable)
- Lock files (package-lock.json, yarn.lock, etc.)
- Shared configuration files
- Generated files dan types

**R03.4** WHEN dua task aktif memiliki overlapping `expected_files`, sistem SHALL:
- Menandai keduanya sebagai POTENTIAL_CONFLICT
- Menampilkan warning ke developer terkait
- Merekomendasikan coordination atau serialization

**R03.5** Exclusive resource lock (opsional) DAPAT digunakan untuk resource yang memerlukan akses serial:
- Claim explicit oleh developer
- Auto-release saat task selesai atau timeout
- Daftar resource locks tersimpan di project-state.yaml

**R03.6** Dependency logis (R01 blocking) berbeda dari conflict resource; task tanpa dependency DAPAT memiliki conflict resource.

---

### R04 — Task Lifecycle yang Lengkap

**User Story:** Sebagai developer, saya ingin lifecycle task yang jelas dengan semua kemungkinan state dan transisi, sehingga saya tahu apa yang diharapkan di setiap tahap.

#### Acceptance Criteria

**R04.1** Task state machine SHALL mendukung states berikut:

| State | Description |
|-------|-------------|
| PENDING | Task dibuat, belum siap |
| READY | DoR terpenuhi, siap dikerjakan |
| ASSIGNED | Sudah ada assignee, belum dimulai |
| IN_PROGRESS | Sedang dikerjakan (TDD cycle) |
| REVIEW | Menunggu review |
| CHANGES_REQUESTED | Review meminta perubahan |
| READY_TO_MERGE | Review approved, siap merge |
| INTEGRATED | Sudah di-merge ke target branch |
| DONE | Selesai dan terverifikasi |
| CANCELLED | Dibatalkan |
| SUPERSEDED | Digantikan oleh task lain |

**R04.2** BLOCKED SHALL merupakan atribut ortogonal yang dapat di-apply ke state PENDING, READY, ASSIGNED, IN_PROGRESS, REVIEW:
- `blocked: true/false`
- `blocked_reason: string`
- `blocker_refs: [BLOCKER-xxx]`

**R04.3** HANDOFF_PENDING SHALL merupakan atribut ortogonal:
- `handoff_pending: true/false`
- `handoff_id: HO-xxx`

**R04.4** Valid state transitions SHALL di-enforce:

```
PENDING → READY (DoR met)
READY → ASSIGNED (assignee set)
ASSIGNED → IN_PROGRESS (work started)
IN_PROGRESS → REVIEW (implementation done)
REVIEW → CHANGES_REQUESTED (reviewer requests changes)
CHANGES_REQUESTED → IN_PROGRESS (addressing changes)
REVIEW → READY_TO_MERGE (approved)
READY_TO_MERGE → INTEGRATED (merged)
INTEGRATED → DONE (verified post-merge)
Any → BLOCKED (blocker added)
BLOCKED → Previous (blocker resolved)
Any → CANCELLED (explicit cancel)
Any → SUPERSEDED (replaced by new task)
```

**R04.5** Transisi invalid SHALL ditolak dengan error INVALID_STATE_TRANSITION yang menyebutkan current state dan attempted transition.

**R04.6** WHEN task transisi ke DONE, sistem SHALL memvalidasi semua Definition of Done criteria terpenuhi.

**R04.7** Reopen task dari DONE SHALL memerlukan:
- Alasan (string non-empty)
- Bukti baru (issue ID, test failure reference)
- Target state (default: IN_PROGRESS)

---

### R05 — Perbaikan TDD Enforcement

**User Story:** Sebagai developer, saya ingin aturan TDD yang fair dan akurat, sehingga test yang legitimate PASS di RED phase tidak salah ditolak.

#### Acceptance Criteria

**R05.1** WHEN test PASS di RED phase, sistem SHALL mengevaluasi kemungkinan:
1. Behavior sudah ada (code exists) → Bukan RED valid, perlu investigasi
2. Test tidak menguji behavior yang dimaksud → Test perlu diperbaiki
3. Test tidak dieksekusi (skipped, wrong filter) → Bukan RED valid
4. Mock/fixture salah → Test perlu diperbaiki

**R05.2** RED phase SHALL valid ONLY IF:
- Test executable berjalan
- Test gagal karena behavior yang ditargetkan belum ada
- Failure bukan karena import error, syntax error, atau environment issue

**R05.3** Evidence RED SHALL mencatat:
- Command yang dijalankan
- Exit code
- Failure message excerpt (menunjukkan behavior yang missing)
- Git ref saat test dijalankan
- Test file dan test name

**R05.4** GREEN phase SHALL valid ONLY IF:
- Test yang sama dengan RED sekarang PASS
- Tidak ada test lain yang FAIL (regression)

**R05.5** REFACTOR phase SHALL valid ONLY IF:
- Semua test tetap PASS setelah refactor
- Behavior tidak berubah (no new functionality)

**R05.6** WHEN test FAIL setelah REFACTOR, sistem SHALL:
1. Mendiagnosis apakah refactor menyebabkan regression
2. Jika ya, require rollback atau fix sebelum proceed
3. TIDAK menghapus work lain yang tidak terkait

**R05.7** Task yang tidak cocok dengan TDD (documentation-only, config-only) SHALL:
- Ditandai `tdd_applicable: false`
- Memiliki `tdd_exemption_reason` yang non-empty
- Memiliki `verification_method` alternatif (manual review, static check, etc.)

**R05.8** Test error categories SHALL dibedakan:
- BEHAVIOR_MISSING: Expected RED, valid
- TEST_ERROR: Syntax, import, assertion bug → Fix test first
- ENVIRONMENT_ERROR: Runtime, connection, config → Fix environment
- SKIPPED: Test tidak dieksekusi → Invalid evidence

---

### R06 — Evidence dan Quality Gates

**User Story:** Sebagai reviewer, saya ingin evidence yang akurat dan terikat ke revisi yang benar, sehingga approval saya berdasarkan kondisi actual.

#### Acceptance Criteria

**R06.1** Setiap evidence record SHALL mencakup:

| Field | Description | Required |
|-------|-------------|----------|
| evidence_id | Unique identifier (EVD-xxx) | Yes |
| task_id | Task yang diverifikasi | Yes |
| requirement_refs | [REQ-xxx] yang di-cover | Yes |
| ac_refs | Acceptance criteria IDs | Yes |
| commit_sha | Commit yang diverifikasi | Yes |
| working_tree_dirty | Ada uncommitted changes? | Yes |
| command | Command yang dijalankan | Yes |
| config | Test config/environment | No |
| environment | Tool versions | No |
| timestamp | ISO 8601 execution time | Yes |
| exit_code | Process exit code | Yes |
| result | PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE | Yes |
| summary | Brief result description | Yes |
| log_path | Path to detailed log | No |
| executor_id | Developer/agent ID | Yes |
| executor_type | HUMAN/AI_AGENT | Yes |

**R06.2** Evidence result categories:
- PASS: Test/check berhasil
- FAIL: Test/check gagal
- BLOCKED: Tidak bisa dijalankan karena blocker
- NOT_RUN: Skipped, tidak dieksekusi
- NOT_APPLICABLE: Check tidak relevan untuk task ini

**R06.3** NOT_RUN dan skipped tests SHALL NOT otomatis dianggap PASS; harus ada explicit policy dan alasan jika di-exclude.

**R06.4** WHEN commit_sha di evidence berbeda dari HEAD current branch, evidence SHALL ditandai `stale: true`.

**R06.5** WHEN `stale: true` dan ada perubahan pada file yang terkait dengan evidence, sistem SHALL:
- Menandai evidence sebagai REQUIRES_REVALIDATION
- Menyimpan `stale_reason` (commit changed, file modified)
- Mencegah task proceed ke DONE tanpa fresh evidence

**R06.6** Evidence SHALL NOT menyimpan secrets, credentials, atau PII; sensitive values di-mask atau di-reference by name only.

**R06.7** Quality gate pass criteria SHALL configurable per gate:

```yaml
quality_gates:
  unit_test:
    required: true
    min_pass_rate: 100
  integration_test:
    required: true
    min_pass_rate: 100
  lint:
    required: true
  type_check:
    required: true
  security_scan:
    required_for_risk: [HIGH, CRITICAL]
```

---

### R07 — Review dan Integration Gate

**User Story:** Sebagai reviewer, saya ingin memastikan perubahan yang di-approve tetap valid saat di-merge, sehingga tidak ada regression dari perubahan yang masuk setelah approval.

#### Acceptance Criteria

**R07.1** Review approval SHALL terikat ke specific commit SHA:
- `approved_commit_sha` dicatat saat approval
- Jika HEAD berubah setelah approval, approval menjadi STALE

**R07.2** WHEN approval STALE dan ada perubahan substantif (non-trivial diff), sistem SHALL:
- Memerlukan re-review
- Atau memerlukan explicit confirmation dari reviewer

**R07.3** Sebelum merge, sistem SHALL memvalidasi:
- Target branch belum berubah sejak last review (atau rebase clean)
- CI checks pass pada merged result (merge commit atau rebase)
- Tidak ada unresolved blocking findings

**R07.4** Serial integration mode (jika merge queue tidak tersedia):
- Hanya satu task dalam READY_TO_MERGE boleh merge pada satu waktu
- Lock mechanism mencegah concurrent merge attempts
- Setelah merge, task lain harus rebase dan re-validate

**R07.5** Merge queue integration (jika tersedia):
- Sistem menyerahkan merge ke queue
- Mencatat queue position dan status
- Update state ke INTEGRATED setelah queue merge success

**R07.6** WHEN merge FAIL (conflict, CI fail), sistem SHALL:
- Mengembalikan task ke CHANGES_REQUESTED atau IN_PROGRESS
- Mencatat failure reason
- Invalidate approval jika karena substantive conflict

**R07.7** Sistem SHALL NOT mengasumsikan fitur Git provider tertentu tersedia; integration mode harus configurable:

```yaml
integration:
  mode: serial | merge_queue | manual
  merge_queue_provider: github | gitlab | none
```

---

### R08 — Handoff yang Aman

**User Story:** Sebagai developer yang menerima handoff, saya ingin context yang lengkap dan transfer yang aman, sehingga saya bisa melanjutkan tanpa kehilangan informasi.

#### Acceptance Criteria

**R08.1** Handoff package SHALL mencakup:
- Task scope dan acceptance criteria
- Current status dan TDD phase
- Branch/worktree name dan current commit
- Uncommitted changes summary (if any)
- All evidence collected so far
- Decisions made (DEC-xxx references)
- Assumptions documented
- Active blockers
- Explicit next steps

**R08.2** Handoff sequence SHALL:
1. Source prepares package (auto-generated + manual additions)
2. System validates package completeness
3. Target receives notification
4. Target validates access dan capability
5. Target explicitly accepts atau rejects dengan reason
6. IF accepted: atomic ownership transfer dengan new fencing_token
7. Previous owner fencing_token invalidated
8. Both parties notified of completion

**R08.3** WHEN handoff initiated, sistem SHALL validate:
- Package content matches current state (commit SHA current)
- No active write operations by source in progress
- Target has required role

**R08.4** WHEN target rejects handoff, sistem SHALL:
- Return task to source dengan rejection reason
- Record rejection in handoff history
- Allow source to address issues dan retry

**R08.5** WHEN handoff timeout (configurable, default 24 hours without response), sistem SHALL:
- Notify source dan target
- Escalate to project lead
- Auto-cancel handoff after extended timeout (configurable)

**R08.6** Partial handoff (mid-TDD-cycle) SHALL preserve:
- Current TDD phase
- All evidence from completed phases
- Work in progress status

**R08.7** Crash/disconnect during handoff SHALL be recoverable:
- Handoff state persisted before each step
- On recovery, resume from last completed step
- No dual-ownership possible (atomic transfer)

---

### R09 — Checkpoint dan Recovery

**User Story:** Sebagai developer/agent, saya ingin pekerjaan saya recoverable setelah crash atau context reset, sehingga progress tidak hilang.

#### Acceptance Criteria

**R09.1** Checkpoint SHALL menyimpan:

| Field | Description |
|-------|-------------|
| checkpoint_id | Unique identifier |
| timestamp | ISO 8601 |
| task_id | Current task (if any) |
| owner_id | Current owner |
| fencing_token | Current fencing token |
| state_version | project-state version |
| tdd_phase | Current TDD phase |
| branch_name | Working branch |
| commit_sha | Last known commit |
| uncommitted_paths | List of modified files not committed |
| evidence_refs | Evidence collected so far |
| blockers | Active blockers |
| next_action | Recommended next step |

**R09.2** Checkpoint SHALL dibuat otomatis pada:
- State transisi (task status change)
- TDD phase transisi
- Evidence record creation
- Handoff initiation/completion
- Periodic interval (configurable, default 15 minutes jika ada activity)

**R09.3** Manual checkpoint SHALL bisa di-trigger oleh user dengan optional note.

**R09.4** WHEN resume dari checkpoint, sistem SHALL:
1. Read latest checkpoint untuk task/owner
2. Validate checkpoint terhadap current repository state:
   - Commit masih ada dan reachable?
   - Branch masih ada?
   - State version masih valid atau ada newer version?
3. Detect dan report discrepancies:
   - Checkpoint stale (newer state exists)
   - Repository diverged (commits not in checkpoint)
   - Files modified outside workflow
4. Preserve existing user work (uncommitted changes)
5. Require user confirmation sebelum proceed

**R09.5** Checkpoint reconciliation strategies:
- AUTO_MERGE: Jika changes compatible, auto-reconcile
- PROMPT_USER: Jika conflict atau ambiguous, ask user
- REJECT: Jika checkpoint terlalu stale, require fresh start

**R09.6** WHEN state update succeeds but response lost (partial failure), retry SHALL:
- Detect already-completed operation via idempotency key
- Return success without re-executing
- Log duplicate attempt

**R09.7** Checkpoint storage:
- Primary: `.kiro/sdlc/checkpoints/`
- Git committed for durability
- Pruning policy: Keep last N checkpoints per task (configurable)

---

### R10 — Change Impact Analysis dan Traceability

**User Story:** Sebagai project lead, saya ingin mengetahui dampak perubahan requirement terhadap task dan evidence, sehingga saya bisa memastikan konsistensi.

#### Acceptance Criteria

**R10.1** Traceability graph SHALL connect:
```
Requirement (REQ-xxx)
  → Acceptance Criteria (REQ-xxx-ACy)
    → Design Decision (DESIGN-xxx, ADR-xxx)
      → Task (TASK-xxx)
        → Test (file:function)
          → Evidence (EVD-xxx)
```

**R10.2** Setiap entity SHALL memiliki stable ID:
- Format: `{TYPE}-{SEQUENTIAL}-{OPTIONAL-SLUG}`
- ID tidak boleh diubah setelah creation
- Display order dapat berbeda dari ID

**R10.3** WHEN requirement berubah (edit to frozen REQ), sistem SHALL:
- Require Change Request (CR-xxx)
- Identify affected acceptance criteria
- Identify tasks yang implement affected AC
- Identify evidence yang verify affected AC
- Mark affected evidence sebagai REQUIRES_REVALIDATION
- Generate impact report

**R10.4** WHEN task di-reopen atau FAIL verification setelah sebelumnya PASS, sistem SHALL:
- Identify downstream dependencies
- Notify owners of dependent tasks
- Update dependency status

**R10.5** Traceability report SHALL dapat di-generate menunjukkan:
- Coverage: % AC dengan task, % task dengan evidence
- Gaps: AC tanpa task, task tanpa evidence
- Staleness: Evidence yang stale
- Orphans: Task tanpa REQ reference

**R10.6** Counter dan statistics di dokumen/report HARUS derived dari actual data, bukan hardcoded.

---

### R11 — Review Closure tanpa Loop Berulang

**User Story:** Sebagai reviewer, saya ingin review cycle yang konvergen dengan finding yang jelas, sehingga review tidak berputar-putar tanpa closure.

#### Acceptance Criteria

**R11.1** Finding register SHALL track:

| Field | Description |
|-------|-------------|
| finding_id | FND-xxx unique identifier |
| task_id | Related task |
| review_round | Which review iteration |
| severity | CRITICAL/HIGH/MEDIUM/LOW/INFO |
| category | BUG/SECURITY/PERFORMANCE/STYLE/DOCUMENTATION/OTHER |
| scope | Specific file:line or general |
| description | Finding description |
| evidence | How it was found |
| acceptance_criteria | What constitutes fix |
| owner_id | Who should fix |
| status | OPEN/IN_PROGRESS/RESOLVED/WONT_FIX/DUPLICATE |
| resolution_evidence | Proof of fix |
| created_at | Timestamp |
| resolved_at | Timestamp |

**R11.2** Review scope rules:
- Initial review: Check against agreed acceptance criteria
- Follow-up review: Focus on changes since last review, resolution of previous findings, and impact of changes
- Full re-review: Only if scope significantly changed or reviewer has specific concern

**R11.3** WHEN finding closed (RESOLVED atau WONT_FIX), re-opening SHALL require:
- New evidence (regression, new test failure)
- Explicit justification
- Different finding_id jika issue berbeda

**R11.4** Severity definitions SHALL be operational:
- CRITICAL: Blocks release, must fix immediately
- HIGH: Must fix before task DONE
- MEDIUM: Should fix before task DONE, may defer with justification
- LOW: Nice to fix, can defer to backlog
- INFO: Suggestion only, no action required

**R11.5** Review completion criteria:
- All CRITICAL findings resolved
- All HIGH findings resolved
- MEDIUM findings either resolved atau explicitly deferred dengan approval
- Approval recorded dengan commit SHA

**R11.6** Improvement suggestions di luar acceptance criteria SHALL:
- Be recorded as INFO atau logged to backlog
- NOT block task completion
- NOT require response in current review cycle

**R11.7** Material risk discovered during review (missed in design) SHALL:
- Be raised as new finding dengan appropriate severity
- May block jika severity CRITICAL/HIGH
- Require explicit decision dan documentation

**R11.8** Retry limit untuk failing task SHALL NOT convert failure ke PASS:
- After N retries (configurable), escalate
- Escalation requires diagnosis of root cause
- Resolution may be: fix, design change, or cancellation

---

### R12 — Human Developer dan AI Agent Policies

**User Story:** Sebagai project lead, saya ingin policy yang jelas untuk human dan AI agent, sehingga masing-masing bekerja sesuai kapabilitas dan batasan.

#### Acceptance Criteria

**R12.1** Actor type SHALL didefinisikan per assignment:

```yaml
actor:
  id: "dev-001"
  type: HUMAN | AI_AGENT
  capabilities: [...]
  restrictions: [...]
```

**R12.2** Capability categories:
- READ_CODE: Baca source code
- WRITE_CODE: Modifikasi source code
- RUN_TESTS: Eksekusi tests
- COMMIT: Create commits
- PUSH: Push to remote
- CREATE_PR: Create pull/merge requests
- APPROVE_PR: Approve pull requests
- MERGE: Merge pull requests
- DEPLOY_STAGING: Deploy ke staging
- DEPLOY_PRODUCTION: Deploy ke production
- MODIFY_REQUIREMENTS: Edit frozen requirements
- APPROVE_GATE: Approve human gates

**R12.3** Default AI Agent restrictions:
- CANNOT: APPROVE_GATE, DEPLOY_PRODUCTION, MODIFY_REQUIREMENTS (without human approval)
- REQUIRES: Lease dan heartbeat
- SUBJECT TO: Automatic timeout pada lease expiry

**R12.4** Default Human restrictions:
- NOT SUBJECT TO: Automatic timeout
- MAY RECEIVE: Inactivity warnings (configurable)

**R12.5** Escalation policy WHEN AI agent capability exceeded:
- Log attempt
- Notify project lead
- Block operation
- Provide guidance untuk human intervention

**R12.6** Cost/resource tracking untuk AI agent (jika metrics tersedia):
- Token usage
- API calls
- Time spent
- Jika metrics tidak tersedia: field marked UNKNOWN, no fabrication

**R12.7** Authorization caching:
- Once human approves action X untuk scope Y, approval cached untuk session/duration
- Tidak re-prompt untuk repeated actions dalam same scope
- Cache invalidated on: session end, explicit revocation, scope change

---

### R13 — Workload dan Rebalancing

**User Story:** Sebagai project lead, saya ingin workload analysis yang akurat dan rebalancing yang thoughtful, sehingga tim bekerja efisien tanpa bottleneck.

#### Acceptance Criteria

**R13.1** Workload metrics per developer SHALL include:
- Task count by status
- Estimated remaining hours (jika estimates tersedia)
- Actual time spent (jika tracked)
- Blocked task count dan duration
- Critical path involvement

**R13.2** Capacity model SHALL support:
- Availability percentage (80% = 4 hari dari 5)
- WIP limit (max concurrent tasks)
- Skill match score untuk task types

**R13.3** Bottleneck detection thresholds SHALL be configurable:

```yaml
bottleneck_thresholds:
  max_active_tasks: 3
  max_blocked_hours: 24
  min_utilization_percent: 25
  max_utilization_percent: 150
```

**R13.4** WHEN bottleneck detected, sistem SHALL:
- Identify root cause (overload, skill mismatch, dependency block)
- Generate specific recommendations (tidak generic)
- NOT otomatis meng-update status ke "Healthy" tanpa actual resolution

**R13.5** Rebalancing recommendations SHALL consider:
- Handoff cost (context switch overhead)
- Skill match
- Current task progress (avoid moving 80% done task)
- Fairness across team

**R13.6** WHEN rebalance executed:
- Recalculate metrics
- Verify improvement (atau report jika tidak improve)
- Prevent thrashing (same task tidak move >2 kali dalam period)

**R13.7** Manual override SHALL supported:
- Project lead dapat assign meski workload recommendation says otherwise
- Override recorded dengan reason
- Audit trail preserved

---

### R14 — Dependency dan Parallel Scheduling

**User Story:** Sebagai project lead, saya ingin scheduling yang respects dependencies tanpa unnecessarily serializing independent work.

#### Acceptance Criteria

**R14.1** Dependency validation SHALL detect:
- SELF_DEPENDENCY: Task depends on itself
- CIRCULAR_DEPENDENCY: A→B→C→A
- MISSING_REFERENCE: Depends on non-existent task
- DUPLICATE_EDGE: Same dependency declared twice
- INVALID_TYPE: Type bukan blocking/non_blocking

**R14.2** Dependency condition types:
- blocking_for_start: Must be DONE before dependent can start
- blocking_for_complete: Must be DONE before dependent can complete
- recommended: Advisory, not enforced

**R14.3** Task scheduling SHALL follow actual dependencies:
- Task dengan dependencies met dapat start kapan saja
- TIDAK harus menunggu entire group/wave selesai
- Parallel execution maksimal berdasarkan resource availability

**R14.4** Critical path calculation:
- IF estimates tersedia: Use estimated duration
- IF estimates tidak tersedia: Use task count, report as "structure-based approximation"

**R14.5** WHEN upstream task cancelled/reopened/fails, sistem SHALL:
- Identify all downstream tasks
- Evaluate impact per downstream:
  - If dependency still met (via alternative): No change
  - If dependency now unmet: Mark BLOCKED
- Notify affected owners

**R14.6** Exclusive resource coordination:
- Resources defined di project config
- Task can claim exclusive access
- Only one task holds resource at a time
- Auto-release on task completion atau timeout

**R14.7** Resource conflict detection SHALL run:
- At task start (warn if conflict)
- At merge time (block if conflict unresolved)

---

### R15 — Release Lifecycle

**User Story:** Sebagai project lead, saya ingin release process yang complete dari readiness check sampai production deployment dengan proper gates.

#### Acceptance Criteria

**R15.1** Release lifecycle states:

```
PLANNING → READINESS_CHECK → STAGING → PRODUCTION → POST_RELEASE → MONITORING → CLOSED
```

**R15.2** READINESS_CHECK gate SHALL validate:
- All committed tasks DONE
- All required evidence valid (not stale)
- No unresolved CRITICAL/HIGH findings
- Documentation complete
- Known issues documented
- Release notes drafted

**R15.3** Release artifact definition:
- Version number (semver atau custom scheme)
- Git tag atau commit SHA
- Build artifacts (if applicable)
- Changelog

**R15.4** STAGING deployment SHALL:
- Deploy release artifact ke staging environment
- Run smoke tests
- Run integration tests
- Verify health checks
- Record deployment evidence

**R15.5** PRODUCTION gate SHALL require:
- Staging verification passed
- Explicit human approval (APPROVE_GATE capability)
- Approval recorded dengan timestamp dan approver

**R15.6** PRODUCTION deployment SHALL:
- Deploy same artifact as staging (no rebuild)
- Run smoke tests
- Verify health checks
- Monitor untuk observation period (configurable, default 30 minutes)

**R15.7** Rollback/roll-forward triggers:
- Critical error rate threshold exceeded
- Health check failure
- Explicit manual trigger

**R15.8** WHEN rollback executed:
- Record rollback decision dan reason
- Verify previous version restored
- Monitor restored version health
- Create incident record jika applicable

**R15.9** Migration compatibility:
- Database migrations checked untuk backward compatibility
- Rollback plan documented untuk each migration
- System SHALL NOT assume rollback otomatis mengembalikan database

**R15.10** Release closure:
- Mark release CLOSED setelah observation period tanpa issues
- Record final metrics
- Archive release artifacts

**R15.11** Deployment prevention:
- Same version tidak boleh deploy dua kali ke production tanpa explicit override
- Override requires justification

---

### R16 — Audit dan Konsistensi State

**User Story:** Sebagai auditor, saya ingin log lengkap dari semua perubahan penting, sehingga saya bisa trace apa yang terjadi dan siapa yang melakukan.

#### Acceptance Criteria

**R16.1** Audit log entry SHALL include:

| Field | Description |
|-------|-------------|
| operation_id | UUID untuk setiap operation |
| correlation_id | Groups related operations |
| timestamp | ISO 8601 |
| actor_id | Who performed action |
| actor_type | HUMAN/AI_AGENT/SYSTEM |
| action | Action type (e.g., TASK_STATUS_CHANGE) |
| resource_type | Task/Release/Team/etc. |
| resource_id | TASK-xxx, etc. |
| state_version_before | State version before change |
| state_version_after | State version after change |
| changes | Diff of changed fields |
| reason | Why action was taken |
| outcome | SUCCESS/FAILURE |
| error_details | If failure, error info |

**R16.2** Actions that SHALL be logged:
- State transitions
- Assignment changes
- Evidence creation
- Approval/rejection
- Handoff events
- Checkpoint creation
- Configuration changes
- Error conditions

**R16.3** WHEN operation succeeds but logging fails, sistem SHALL:
- Retry logging (configurable attempts)
- If retry fails, record to fallback log
- NOT block operation success

**R16.4** WHEN operation completes but response lost, retry SHALL:
- Check operation_id untuk completion status
- Return cached result jika already completed
- Log duplicate attempt

**R16.5** Audit log retention:
- Configurable retention period
- Archival strategy untuk old logs
- Logs immutable after write

**R16.6** Consistency check SHALL detect:
- Counter mismatches (e.g., tasks.total ≠ sum(by_status))
- Orphan references
- Invalid state combinations
- Missing required fields

---

### R17 — Dokumentasi, Diagram, dan Commands

**User Story:** Sebagai developer, saya ingin dokumentasi yang akurat dan commands yang benar-benar tersedia, sehingga saya tidak mengikuti instruksi yang tidak bisa dijalankan.

#### Acceptance Criteria

**R17.1** Mermaid diagrams SHALL valid syntax (no render errors):
- State diagrams
- Sequence diagrams
- Flowcharts
- Gantt charts (jika digunakan)

**R17.2** Markdown tables SHALL properly escaped (no broken rendering).

**R17.3** Command documentation SHALL specify:

| Field | Description |
|-------|-------------|
| name | Command name |
| description | What it does |
| status | IMPLEMENTED/PLANNED/DEPRECATED |
| inputs | Required dan optional parameters |
| validation | Input validation rules |
| outputs | Success output |
| errors | Possible error conditions |
| side_effects | State changes |
| idempotency | Is it safe to retry? |
| permissions | Required capabilities |

**R17.4** Commands dengan status PLANNED SHALL NOT disebut sebagai available dalam documentation atau steering files.

**R17.5** Diagram lifecycle, TDD, handoff, workload, dependency, dan release SHALL konsisten dengan:
- State machine definitions di design
- Actual implementation behavior

**R17.6** Definition of COMPLETE vs PROJECT_COMPLETE SHALL clear:
- Task COMPLETE: Individual task done
- Milestone COMPLETE: All tasks in milestone done
- Release COMPLETE: Production deployed dan stable
- Project COMPLETE: All planned releases complete

**R17.7** Gantt chart (jika digunakan) SHALL NOT contradict dengan TDD cycle:
- Test design/write bisa dilakukan sebelum implementation
- Implementation phase setelah RED phase

**R17.8** Troubleshooting guide SHALL include:
- Common error codes dan resolutions
- Recovery procedures
- Contact/escalation paths

---

## Non-Functional Requirements

### NFR01 — Performance

- State read/write operations SHALL complete dalam < 500ms untuk typical state size
- Validation checks SHALL complete dalam < 2 seconds
- No external service dependencies untuk core operations

### NFR02 — Compatibility

- Backward compatible dengan existing project-state.yaml (schema migration supported)
- Existing multi-developer-support components TIDAK diubah interface-nya
- New fields optional dengan sensible defaults

### NFR03 — Portability

- Cross-platform (Windows, Linux, macOS)
- No platform-specific dependencies dalam core logic
- Git provider agnostic (GitHub, GitLab, Bitbucket support via adapters)

### NFR04 — Testability

- All components HARUS memiliki unit tests
- Critical paths HARUS memiliki property-based tests
- Integration scenarios HARUS memiliki integration tests

### NFR05 — Observability

- Structured logging (JSON format supported)
- Error messages SHALL include context untuk debugging
- Metrics collection hooks untuk external monitoring

---

## Assumptions

1. Git tersedia sebagai version control system
2. File system local tersedia untuk state storage
3. Single repository workflow (monorepo atau single-service)
4. Human developers dan AI agents menggunakan interface yang sama (Kiro)

## Open Decisions

| ID | Decision Needed | Impact | Recommendation |
|----|-----------------|--------|----------------|
| OD-01 | Apakah perlu external lock service untuk distributed scenario? | R02, R03 | Tidak untuk v1, gunakan file-based locking. Pertimbangkan untuk v2 jika ada kebutuhan multi-machine. |
| OD-02 | Format estimasi waktu (story points vs hours)? | R13, R14 | Support keduanya dengan configurable unit. Default: tidak require estimates, use task count. |
| OD-03 | External notification integration (Slack, email)? | R08, R15 | Out of scope untuk v1. Provide hooks untuk extension. |
| OD-04 | Apakah perlu signed commits untuk audit? | R16 | Optional enhancement. Tidak di-enforce, tapi di-support jika configured. |

---

## Requirement Traceability Matrix

| Req ID | Category | Priority | Dependencies | Existing Work |
|--------|----------|----------|--------------|---------------|
| R01 | Definition of Ready | HIGH | - | Partial (procedural) |
| R02 | Concurrency Control | HIGH | - | None |
| R03 | Isolation | MEDIUM | R02 | Partial (documented) |
| R04 | Task Lifecycle | HIGH | R01, R02 | Partial (basic states) |
| R05 | TDD Enforcement | HIGH | R06 | Partial (sdlc-guard.js) |
| R06 | Evidence | HIGH | R02 | Partial (templates) |
| R07 | Review/Integration | HIGH | R04, R06 | None |
| R08 | Handoff | MEDIUM | R02, R09 | Implemented |
| R09 | Checkpoint/Recovery | HIGH | R02 | None |
| R10 | Traceability | MEDIUM | R06 | Partial (traceability.yaml) |
| R11 | Review Closure | MEDIUM | R06 | None |
| R12 | Actor Policies | MEDIUM | R02 | None |
| R13 | Workload | LOW | R04 | Implemented |
| R14 | Dependency/Schedule | LOW | R04 | Implemented |
| R15 | Release Lifecycle | HIGH | R06, R07 | Partial (documented) |
| R16 | Audit | MEDIUM | R02 | None |
| R17 | Documentation | LOW | All | Partial |

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-10-12 | Kiro | Initial requirements specification |
