> **Confidential — do not publish.** This file names the live project and
> inventories which functions bypass RLS and what they expose. It was written
> for a private repository. If this repository is ever made public, this file
> must be removed from the working tree *and* from git history first. See
> `SECURITY.md`.

# Database security snapshot — BYOND-hr

**Captured 2026-08-05 from project `rxkgnbvjywiqkgbbypfs` at migration `20260728143114`
(51 applied migrations).** Read-only capture: policy and function definitions only,
no employee rows.

## Why this file exists

`BYOND-HR_Access_Control_Standard.md` states it was "derived from live database
policies (46 migrations)". The database is now at 51. That gap is the root cause
of every discrepancy listed below — the document has not drifted from itself, the
database moved and the document did not follow.

This snapshot is the corrected input for bringing that document back in step, and
a reference point for detecting future drift. Regenerate with the queries in
"How this was captured" at the bottom.

Counts at capture: **104 RLS policies · 44 functions · 32 tables · 4 views.**

---

## 1. Unguarded SECURITY DEFINER functions

`SECURITY DEFINER` functions bypass RLS by design, so their only access control is
whatever they check internally. These have `EXECUTE` granted and **no role check**
in the body — no `get_user_role`, no `is_platform_owner`.

| Function | Callable by | Role check | Assessment |
|---|---|---|---|
| `generate_wps_sif(p_year, p_month)` | `authenticated` | **none** | Emits company-wide salary + IBAN + labour card data. Highest priority. |
| `recompute_kpi_totals(p_year, p_month)` | `authenticated` | **none** | Recomputes company-wide KPI totals. Write-side. |
| `log_login_attempt(p_email, p_success)` | **`anon`** + `authenticated` | **none** | Audit rows can be forged by anyone, undermining Art. 26.5. |
| `create_user_session(p_token, p_expires_at)` | `authenticated` | none | Accepts a caller-supplied token. |
| `mark_session_inactive(p_token)` | `authenticated` | none | Ends any session whose token is known. |
| `get_active_session_count()` / `(uid)` | `authenticated` | none | Two overloads — see §4. |
| `self_onboard_company(...)` | `authenticated` | none | Unguarded by design; raises if already onboarded. |

For contrast, these **do** guard themselves internally and are the pattern to
follow: `anonymize_employee`, `export_employee_data`, `create_employee_invite`,
`generate_employee_invite`, `approve_warning_recommendation`.

Not verified by execution — no write-path probes were run against production. The
finding is the absence of a guard in the definition.

## 2. No column-level protection on `employees`

`authenticated` holds column `SELECT` on every sensitive column:

`basic_salary` · `housing_allowance` · `transport_allowance` · `other_allowance` ·
`bank_account` · `iban` · `national_id` · `labour_card_number` ·
`agent_bank_routing_code`

RLS is row-level only, so any client issuing `select('*')` receives all of them for
every row the policy admits. `emp_select` admits:

- company-wide: `super_admin`, `hr_manager`, `admin`, `read_only`
- own department: `department_manager`
- own row: everyone

So `src/pages/EmployeeDetail.jsx` reading `select('*')` exposes salary, bank and
national ID to **four roles company-wide**, including `read_only` — whose matrix
entitlement on employees is `R`, and whose §4.1 purpose is viewing reports.

Column grants or a masked view are the durable fix; an explicit column list in the
client is the immediate one.

## 3. Document vs database discrepancies

Each row is the live policy against the §3 cell. **The database is more permissive
than the document in every case**, which means the document is the safer of the two
to have followed — but it is not what is enforced.

| §3 module | Role | Document | Live policy |
|---|---|---|---|
| Attendance (others) | `read_only` | `–` | `att_select` grants company-wide read |
| Attendance (others) | `department_manager` | `B` (branch) | `att_select` is **not** branch-scoped — company-wide |
| Attendance (others) | `admin` | `R` | `attendance_admin_select` grants company-wide read ✓ |
| Leave — request | `read_only` | `–` | `leave_select` + `leave_bal_select` grant read |
| Payroll — view | `admin` | `–` | `payroll_select`'s own-record clause allows own payslip |
| User roles / permissions | `hr_manager` | `–` | `roles_select` grants company-wide read |
| User roles / permissions | all others | `–` | `roles_select` allows `user_id = auth.uid()` — own row always readable |
| KPI — view | — | *no such row* | `kpi_select` grants `read_only` company-wide read |

The last two settle questions raised earlier and deliberately not guessed at:
own-row role reads are permitted for every role, and `read_only` can read KPI
scores.

Per the standard's own preamble — "the conflict must be resolved here FIRST" —
these belong in the document before any further code follows them.

## 4. Migration drift

Two functions exist as duplicate overloads. PostgREST resolves by argument shape
and an ambiguous call raises at runtime:

- `calculate_attendance_score(p_employee_id, p_year, p_month)` and
  `(p_employee_id, p_year, p_month, p_company_id)`
- `get_active_session_count()` and `(uid)`

## 5. Auth configuration

Leaked-password protection is **disabled**. Enabling it checks new passwords
against HaveIBeenPwned and is the cheapest available step toward Art. 32.1, which
mandates password strength rules the platform does not currently enforce
(`Signup.jsx` checks length only; there is no complexity, rotation or history
requirement, and no MFA).

## 6. Confirmed working as documented

Worth recording, because these were verified rather than assumed:

- `payroll_mgr_select` genuinely reads `company.manager_salary_visibility` and is
  branch-scoped — §4.7's toggle is live. The **frontend has no surface for it**, so
  a capability that exists and is paid for is unreachable.
- `warn_rec_mgr_insert` is branch-scoped to the manager's department, and only
  `hr_manager`/`super_admin` can update — §4.6's recommend-then-issue holds.
- `generate_wps_sif` exists (migration `add_wps_compliance_fields_and_sif_generator`).
  WPS SIF generation is **built**; only the button is missing. Earlier notes in this
  repo describing SIF generation as absent were wrong.
- Config tables (`shift_settings`, `shift_templates`, `document_types`,
  `kpi_settings`, `kpi_adjustment_types`, `departments`) all read company-wide and
  write `super_admin`-only or HR-only, matching Shape D.
- Every policy examined gates on `company_id` first, per §9.

## 7. Test accounts (BYOND Test Co only)

Six accounts, one per role, were created inside `BYOND Test Co`
(`2f6ba7dc-8a63-4300-9213-6b0e3b8eb425`) so all six roles can be exercised. The
real `BYOND` tenant was not touched. Each is linked to an already-seeded
fictional employee; passwords are held outside this repo.

| Role | Email | Linked employee |
|---|---|---|
| `super_admin` | `superadmin@byond-test.com` | Aisha Rahman |
| `hr_manager` | `hrmanager@byond-test.com` | Mariam Saleh |
| `department_manager` | `deptmanager@byond-test.com` | Omar Haddad (Sales) |
| `admin` | `opsadmin@byond-test.com` | Khalid Mansour |
| `employee` | `employee@byond-test.com` | Hassan Ali |
| `read_only` | `readonly@byond-test.com` | Fatima Zahra |

**These are test credentials in a production project and share one password.**
They should be deleted, or their passwords rotated, before real customers are
onboarded.

### RLS verified per role

Measured by impersonating each account with RLS enforced (`set local role
authenticated` plus `request.jwt.claims`), counting visible rows:

| Role | employees | rows from the other tenant | user_roles |
|---|---|---|---|
| `super_admin` | 10 | **0** | 6 |
| `hr_manager` | 10 | **0** | 6 |
| `department_manager` | **3** | **0** | 1 |
| `admin` | 10 | **0** | 1 |
| `employee` | **1** | **0** | 1 |
| `read_only` | 10 | **0** | 1 |

What this establishes:

- **Multi-tenant isolation holds.** Every role sees zero rows from the other
  company. §9 is now verified rather than assumed.
- **Branch scoping works.** The department manager sees 3 of 10 employees — the
  Sales department only — so `get_user_department_id()` scoping is real.
- **`employee` sees exactly its own row**, and every non-privileged role sees
  exactly one `user_roles` row: its own. This settles the question left open
  earlier — own-row reads are permitted for all roles.
- **`hr_manager` sees all 6 `user_roles` rows**, confirming by measurement that
  §3's `–` on that cell is wrong.

Attendance, payroll and leave all returned 0 for every role because Test Co has
no rows in those tables. Those paths are **unverified, not passing** — seeding
Test Co activity would close that gap.

## How this was captured

```sql
-- Policy surface
select tablename, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, cmd;

-- Column exposure
select c.column_name,
       has_column_privilege('authenticated','public.employees',c.column_name,'SELECT')
from information_schema.columns c
where c.table_schema='public' and c.table_name='employees';

-- Function guards
select p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef,
       (p.prosrc like '%get_user_role%' or p.prosrc like '%is_platform_owner%') as checks_role
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';
```

Note when re-reading a capture: `qual` carries the rule for SELECT/UPDATE/DELETE,
`with_check` for INSERT. A capture that selects only `qual` shows INSERT policies as
empty, which is misleading rather than permissive.
