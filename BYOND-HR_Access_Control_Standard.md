# BYOND HR — Role-Based Access Control Standard

**Version 1.0 · Derived from live database policies (46 migrations) · This is the canonical source of truth.**

> Any future feature, page, or migration must conform to this document. If a new requirement conflicts with a rule below, the conflict must be resolved here FIRST — update this document, then build. Frontend UI must never offer a control that the matching RLS policy would reject; hide it instead.

---

## 1. The Six Roles

| Role | Who they are | One-line purpose |
|---|---|---|
| `super_admin` | Company owner/CEO | Full control of their own tenant |
| `hr_manager` | HR department | Runs all HR operations company-wide |
| `department_manager` | Team lead / line manager | Manages their own department only |
| `admin` | Ops coordinator | Schedules shifts, coordinates documents — operational, not people-management |
| `employee` | All staff | Self-service only |
| `read_only` | Auditor / Finance / Legal (external or internal) | Views reports; **zero write access anywhere**, including their own records |

Plus one cross-cutting flag, independent of role:

**`is_platform_owner`** — marks BYOND's own staff (you), not a tenant role. Grants access to platform-level data (`demo_requests`, cross-tenant `company` reads). A client's `super_admin` is master of their own company but is **never** a platform owner.

---

## 2. The Standard Pattern

Every table in this system follows one of these five shapes. When adding a new table, pick the matching shape rather than inventing a new one.

| Shape | SELECT | INSERT/UPDATE/DELETE | Example tables |
|---|---|---|---|
| **A — Company-wide HR data** | super_admin, hr_manager (+ sometimes admin/manager/read_only) | super_admin + hr_manager only | employees, leave_balances, payroll_runs |
| **B — Branch-scoped** | manager sees own department only | manager writes own department only | employees (mgr slice), hr_documents (mgr slice), leave (approval) |
| **C — Self-service** | owner of the row only | owner of the row only, **excludes read_only** | kpi self-eval, feed reactions/comments, leave self-cancel |
| **D — Config/settings** | all company members read | super_admin only writes | kpi_settings, shift_settings, document_types (read) |
| **E — Platform-level** | `is_platform_owner` only | `is_platform_owner` only | demo_requests, cross-tenant company admin |

---

## 3. Full Access Matrix (per module)

Legend: **F**=Full CRUD · **W**=Write (create/update, no delete) · **O**=Own records only · **B**=Branch/team only · **R**=Read only · **–**=No access

| Module | super_admin | hr_manager | department_manager | admin | employee | read_only |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Own profile & documents** | F | F | F | F | F | R |
| **Company settings** | F | – | – | – | – | – |
| **Departments** | F | W | R | R | R | R |
| **Employees (records)** | F | F | B (read) | R | O | R |
| **Employee invites** | F | F | – | R (view links) | – | – |
| **Attendance (own)** | O | O | O | O | O | – |
| **Attendance (others)** | F | F | B (read) | R | – | – |
| **Shift templates** | F | F | – | F | R | R |
| **Shift schedule** | F | F | B (read) | F | O (read own) | R |
| **Leave — request** | O | O | O | O | O | – |
| **Leave — approve step 1** | F | F | B | – | – | – |
| **Leave — approve final** | F | F | – | – | – | – |
| **Leave — cancel own (pending)** | O | O | O | O | O | – (blocked) |
| **Payroll — draft/edit** | F | W | – | – | – | – |
| **Payroll — approve** | F (only role) | – | – | – | – | – |
| **Payroll — mark paid** | F | W | – | – | – | – |
| **Payroll — view** | F | F | B (toggle-gated) | – | O (own payslip) | R |
| **KPI settings & weights** | F | – | – | – | – | – |
| **KPI scores — evaluate** | F | F | B | – | – | – |
| **KPI scores — self-eval** | O | O | O | O | O | – (blocked) |
| **KPI adjustments (rewards)** | F | W | – | – | – | – |
| **Warnings — issue directly** | F | W | – | – | – | – |
| **Warnings — recommend** | – | – | W (own team) | – | – | – |
| **Warnings — approve rec.** | F | W | – | – | – | – |
| **PDP plans** | F | F | – | – | O (read) | – |
| **PDP action complete** | F | F | – | – | O | – (blocked) |
| **HR documents (all)** | F | F | B (read/write) | F | O (own, read) | – |
| **Document types (catalog)** | F | W | R | R | R | R |
| **News feed — post** | F | F | W | – | – | R (read) |
| **News feed — react/comment** | F | F | F | F | O | – (blocked) |
| **News feed — moderate** | F | F | – | – | – | – |
| **Shift settings** | F | W | R | R | R | R |
| **Data subject requests** | F | F | – | – | O (own) | R |
| **Consent records** | F | F | – | – | O (own) | R |
| **Audit logs** | R | R | – | – | – | – |
| **Login attempts** | R | – | – | – | – | – |
| **User roles / permissions** | F | – | – | – | O (own, read) | – |
| **Leads / demo requests** | Platform owner only, regardless of role | | | | | |

---

## 4. Design Principles (why the matrix looks like this)

1. **`read_only` means read only — full stop.** No self-service writes anywhere, even to their own KPI self-eval, own leave cancellation, or feed reactions. If a real auditor account also needs to clock in as an employee, they need TWO accounts — a `read_only` one and an `employee` one — never one role trying to do both.

2. **Managers are branch-scoped, not company-scoped.** A `department_manager` sees and acts on their own department's employees, documents, attendance, and leave — never another department's. This is enforced via `get_user_department_id()` in every relevant policy, not by frontend filtering.

3. **`admin` is operational, not managerial.** They schedule shifts and coordinate documents. They do NOT approve leave, run payroll, score KPIs, or issue discipline. They can read attendance/leave to schedule around it, but never edit those records — the person who builds the schedule should never also be able to falsify the clock-in it produces.

4. **Maker-checker on payroll is non-negotiable.** `hr_manager` prepares; only `super_admin` approves; either can mark paid once approved. This is enforced at the trigger level (`aa_payroll_transition`), not just RLS — even a direct SQL UPDATE respects it.

5. **Two-step leave mirrors the handbook.** Employee → department manager (step 1) → HR/super_admin (final). HR may also approve directly from `pending` for teams without an assigned manager. Enforced by `aa_leave_transition`.

6. **Discipline is recommend-then-issue.** Managers recommend a warning; only HR/super_admin issue it (which is what actually touches the employee's KPI). This prevents a manager's same-day frustration from becoming a permanent KPI hit without HR oversight — matching the handbook's disciplinary-hearing process.

7. **Salary visibility is opt-in, not default.** `company.manager_salary_visibility` (default `false`) is the ONLY thing that lets a department manager see payroll data for their team, and even then it's read-only. Salary confidentiality is the default state for every new tenant.

8. **Platform-owner is separate from `super_admin`.** A client's `super_admin` owns their tenant completely but can NEVER see another tenant's data, another tenant's leads, or platform-wide anything. Only BYOND's own account (`is_platform_owner = true`) crosses tenant boundaries — and only for the specific platform-level tables (`demo_requests`, cross-tenant `company` admin).

9. **Every write policy checks `company_id` first.** No exception. Multi-tenant isolation is the first clause of every policy in this system, before role, before ownership.

10. **The frontend must never offer what RLS will reject.** If a role can't perform an action, hide the button — don't show it and let a failed request explain the rule. (Historical example: `read_only`'s clock-in/self-eval/react/comment controls must be hidden now that migration 46 blocks them at the database.)

---

## 5. What Changes When You Add a New Feature

Checklist for every future module:

- [ ] Which of the 5 shapes (§2) does this fit? If none, that's a signal to reconsider the design before writing RLS.
- [ ] Does `company_id` gate every policy?
- [ ] Is `read_only` explicitly excluded from every INSERT/UPDATE/DELETE?
- [ ] Does a `department_manager` policy (if any) scope through `get_user_department_id()`?
- [ ] Does this need a maker-checker or two-step pattern (money, discipline, compliance)? If so, model it on `aa_payroll_transition` / `aa_leave_transition`.
- [ ] Add the new module as a row in §3's matrix, and update this document in the same session as the migration.

---

*This document is derived directly from live `pg_policies` output as of migration 46 (2026). It supersedes any informal description of roles found in earlier handover sessions. Update it whenever RLS changes — it should never drift from what the database actually enforces.*
