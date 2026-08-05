// SOURCE OF TRUTH: BYOND-HR_Access_Control_Standard.md v1.0 (§1 roles, §3 matrix,
// §4 principles). If that document changes, change this file in the same session.
//
// §4.10 is the rule this module exists to serve: "The frontend must never offer
// what RLS will reject. If a role can't perform an action, hide the button."
// Every capability below is transcribed from a §3 row rather than inferred, so a
// reviewer can diff the two side by side.

export const ROLES = ['super_admin', 'hr_manager', 'department_manager', 'admin', 'employee', 'read_only']

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hr_manager: 'HR Manager',
  department_manager: 'Dept. Manager',
  admin: 'Ops Coordinator',
  employee: 'Employee',
  read_only: 'Read Only',
}

// §1's one-line purposes, shown in the app so a user can see why their access
// looks the way it does.
export const ROLE_PURPOSE = {
  super_admin: 'Full control of your own company',
  hr_manager: 'Runs all HR operations company-wide',
  department_manager: 'Manages your own department only',
  admin: 'Schedules shifts and coordinates documents',
  employee: 'Self-service only',
  read_only: 'Views reports — no changes anywhere',
}

// Legend, matching §3: F full · W write, no delete · O own only · B branch/team
// only · R read only · '-' no access.
const F = 'F'
const W = 'W'
const O = 'O'
const B = 'B'
const R = 'R'
const X = '-'

// §3, transcribed row for row. Keys are the module names from the document.
export const MATRIX = {
  'Own profile & documents': { super_admin: F, hr_manager: F, department_manager: F, admin: F, employee: F, read_only: R },
  'Company settings': { super_admin: F, hr_manager: X, department_manager: X, admin: X, employee: X, read_only: X },
  Departments: { super_admin: F, hr_manager: W, department_manager: R, admin: R, employee: R, read_only: R },
  'Employees (records)': { super_admin: F, hr_manager: F, department_manager: B, admin: R, employee: O, read_only: R },
  'Employee invites': { super_admin: F, hr_manager: F, department_manager: X, admin: R, employee: X, read_only: X },
  'Attendance (own)': { super_admin: O, hr_manager: O, department_manager: O, admin: O, employee: O, read_only: X },
  'Attendance (others)': { super_admin: F, hr_manager: F, department_manager: B, admin: R, employee: X, read_only: X },
  'Shift templates': { super_admin: F, hr_manager: F, department_manager: X, admin: F, employee: R, read_only: R },
  'Shift schedule': { super_admin: F, hr_manager: F, department_manager: B, admin: F, employee: O, read_only: R },
  'Leave — request': { super_admin: O, hr_manager: O, department_manager: O, admin: O, employee: O, read_only: X },
  'Leave — approve step 1': { super_admin: F, hr_manager: F, department_manager: B, admin: X, employee: X, read_only: X },
  'Leave — approve final': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: X, read_only: X },
  'Leave — cancel own (pending)': { super_admin: O, hr_manager: O, department_manager: O, admin: O, employee: O, read_only: X },
  'Payroll — draft/edit': { super_admin: F, hr_manager: W, department_manager: X, admin: X, employee: X, read_only: X },
  'Payroll — approve': { super_admin: F, hr_manager: X, department_manager: X, admin: X, employee: X, read_only: X },
  'Payroll — mark paid': { super_admin: F, hr_manager: W, department_manager: X, admin: X, employee: X, read_only: X },
  // department_manager's B here is toggle-gated on company.manager_salary_visibility (§4.7).
  'Payroll — view': { super_admin: F, hr_manager: F, department_manager: B, admin: X, employee: O, read_only: R },
  'KPI settings & weights': { super_admin: F, hr_manager: X, department_manager: X, admin: X, employee: X, read_only: X },
  'KPI scores — evaluate': { super_admin: F, hr_manager: F, department_manager: B, admin: X, employee: X, read_only: X },
  'KPI scores — self-eval': { super_admin: O, hr_manager: O, department_manager: O, admin: O, employee: O, read_only: X },
  'KPI adjustments (rewards)': { super_admin: F, hr_manager: W, department_manager: X, admin: X, employee: X, read_only: X },
  'Warnings — issue directly': { super_admin: F, hr_manager: W, department_manager: X, admin: X, employee: X, read_only: X },
  'Warnings — recommend': { super_admin: X, hr_manager: X, department_manager: W, admin: X, employee: X, read_only: X },
  'Warnings — approve rec.': { super_admin: F, hr_manager: W, department_manager: X, admin: X, employee: X, read_only: X },
  'PDP plans': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: O, read_only: X },
  'PDP action complete': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: O, read_only: X },
  'HR documents (all)': { super_admin: F, hr_manager: F, department_manager: B, admin: F, employee: O, read_only: X },
  'Document types (catalog)': { super_admin: F, hr_manager: W, department_manager: R, admin: R, employee: R, read_only: R },
  'News feed — post': { super_admin: F, hr_manager: F, department_manager: W, admin: X, employee: X, read_only: R },
  'News feed — react/comment': { super_admin: F, hr_manager: F, department_manager: F, admin: F, employee: O, read_only: X },
  'News feed — moderate': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: X, read_only: X },
  'Shift settings': { super_admin: F, hr_manager: W, department_manager: R, admin: R, employee: R, read_only: R },
  'Data subject requests': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: O, read_only: R },
  'Consent records': { super_admin: F, hr_manager: F, department_manager: X, admin: X, employee: O, read_only: R },
  'Audit logs': { super_admin: R, hr_manager: R, department_manager: X, admin: X, employee: X, read_only: X },
  'Login attempts': { super_admin: R, hr_manager: X, department_manager: X, admin: X, employee: X, read_only: X },
  'User roles / permissions': { super_admin: F, hr_manager: X, department_manager: X, admin: X, employee: O, read_only: X },
}

export function cell(module, role) {
  return MATRIX[module]?.[role] ?? X
}

const WRITE_LEVELS = new Set([F, W, O, B])
const ANY_ACCESS = new Set([F, W, O, B, R])

// Can this role change anything in this module?
export function canWrite(module, role) {
  const v = cell(module, role)
  // R is read; B may be read-only depending on the row, so callers needing the
  // distinction should read the cell directly (see the notes below).
  return WRITE_LEVELS.has(v)
}

export function canSee(module, role) {
  return ANY_ACCESS.has(cell(module, role))
}

// ── Capabilities the mobile app actually needs ──────────────────────────────
//
// Each is tied to the §3 row it comes from. Where a row's B is documented as
// read-only ("B (read)") the write capability is false even though the cell is B.

export function capabilities(role, { managerSalaryVisibility = false } = {}) {
  const isReadOnly = role === 'read_only'

  return {
    role,
    label: ROLE_LABELS[role] ?? role,
    purpose: ROLE_PURPOSE[role] ?? '',

    // §4.1 — read_only means read only, full stop. Every self-service write is
    // off, including on their own records.
    isReadOnly,

    // 'Attendance (own)' — read_only is '-', i.e. no own attendance at all.
    viewOwnAttendance: canSee('Attendance (own)', role),
    clockInOut: canWrite('Attendance (own)', role),

    // 'Leave — request' / 'Leave — cancel own (pending)'
    viewOwnLeave: canSee('Leave — request', role),
    requestLeave: canWrite('Leave — request', role),
    cancelOwnLeave: canWrite('Leave — cancel own (pending)', role),

    // 'Leave — approve step 1' / 'approve final'
    approveLeaveStep1: canWrite('Leave — approve step 1', role),
    approveLeaveFinal: canWrite('Leave — approve final', role),

    // 'KPI scores — self-eval' / 'evaluate'
    selfEvaluate: canWrite('KPI scores — self-eval', role),
    evaluateOthers: canWrite('KPI scores — evaluate', role),

    // 'Payroll — view'. admin is '-' — an ops coordinator sees no payroll at
    // all, not even their own payslip. department_manager's team view is
    // additionally gated on company.manager_salary_visibility (§4.7).
    viewOwnPayslip: canSee('Payroll — view', role),
    viewTeamPayroll:
      cell('Payroll — view', role) === F ||
      (cell('Payroll — view', role) === B && managerSalaryVisibility),

    // 'Attendance (others)' — B and R are both read-only here.
    viewTeamAttendance: canSee('Attendance (others)', role),
    editOthersAttendance: cell('Attendance (others)', role) === F,

    // 'Employees (records)' — department_manager's B is documented "B (read)".
    viewEmployees: canSee('Employees (records)', role),

    // 'News feed — post' — department_manager has W. read_only's R is read.
    // The employees table also carries can_post_feed; callers should require
    // both (role allows AND the flag is set), as the web app does.
    postToFeed: canWrite('News feed — post', role),
    reactAndComment: canWrite('News feed — react/comment', role),
    moderateFeed: canWrite('News feed — moderate', role),

    // 'Shift schedule' / 'Shift templates' — admin is F on both (§4.3).
    viewSchedule: canSee('Shift schedule', role),
    manageShifts: cell('Shift schedule', role) === F,

    // 'HR documents (all)' — read_only is '-' entirely.
    viewDocuments: canSee('HR documents (all)', role),
    manageDocuments: cell('HR documents (all)', role) === F || cell('HR documents (all)', role) === B,

    // 'PDP plans' — employee gets O (read).
    viewPdp: canSee('PDP plans', role),
    completePdpAction: canWrite('PDP action complete', role),

    // 'Warnings' — §4.6, managers recommend, HR issues.
    recommendWarning: canWrite('Warnings — recommend', role),
    issueWarning: canWrite('Warnings — issue directly', role),

    // 'Employee invites'
    viewInvites: canSee('Employee invites', role),
  }
}

// Which second surface, if any, this role gets beside Personal.
//
// Manager  — approvals and team performance (super_admin, hr_manager,
//            department_manager)
// Ops      — shifts and documents, no people management (admin; §4.3)
// none     — employee and read_only have a single surface
export function secondMode(role) {
  if (role === 'super_admin' || role === 'hr_manager' || role === 'department_manager') return 'manager'
  if (role === 'admin') return 'ops'
  return null
}

export const MODE_LABEL = { personal: 'Personal', manager: 'Manager', ops: 'Operations' }
