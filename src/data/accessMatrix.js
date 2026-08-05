// SOURCE OF TRUTH: BYOND-HR_Access_Control_Standard.md §3. If you change
// one, change the other in the same session.
//
// Copied verbatim from §3's 38-row matrix. Each cell's value is the bare
// legend letter (F/W/O/B/R/-) so the UI can color-code it consistently;
// any parenthetical qualifier the Standard attaches to a specific cell
// (e.g. "B (read)", "F (only role)", "– (blocked)") is preserved in that
// row's `notes` object instead of being dropped — keyed by the same role
// name, shown as a tooltip in the UI. Nothing from the source table is
// summarized or inferred away.
//
// The Standard renders "no access" as an en dash "–"; this file uses a
// plain hyphen '-' instead so it works as a valid object key / CSS class
// token — same meaning, ASCII-safe spelling.

export const ROLES = [
  'super_admin',
  'hr_manager',
  'department_manager',
  'admin',
  'employee',
  'read_only',
]

export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hr_manager: 'HR Manager',
  department_manager: 'Dept. Manager',
  admin: 'Admin',
  employee: 'Employee',
  read_only: 'Read Only',
}

export const LEGEND = {
  F: 'Full',
  W: 'Write (no delete)',
  O: 'Own only',
  B: 'Branch/team only',
  R: 'Read only',
  '-': 'No access',
}

export const ACCESS_MATRIX = [
  {
    module: 'Own profile & documents',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'F', admin: 'F', employee: 'F', read_only: 'R' },
  },
  {
    module: 'Company settings',
    access: { super_admin: 'F', hr_manager: '-', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Departments',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: 'R', admin: 'R', employee: 'R', read_only: 'R' },
  },
  {
    module: 'Employees (records)',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: 'R', employee: 'O', read_only: 'R' },
    notes: { department_manager: 'read' },
  },
  {
    module: 'Employee invites',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: 'R', employee: '-', read_only: '-' },
    notes: { admin: 'view links' },
  },
  {
    module: 'Attendance (own)',
    access: { super_admin: 'O', hr_manager: 'O', department_manager: 'O', admin: 'O', employee: 'O', read_only: '-' },
  },
  {
    module: 'Attendance (others)',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: 'R', employee: '-', read_only: '-' },
    notes: { department_manager: 'read' },
  },
  {
    module: 'Shift templates',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: 'F', employee: 'R', read_only: 'R' },
  },
  {
    module: 'Shift schedule',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: 'F', employee: 'O', read_only: 'R' },
    notes: { department_manager: 'read', employee: 'read own' },
  },
  {
    module: 'Leave — request',
    access: { super_admin: 'O', hr_manager: 'O', department_manager: 'O', admin: 'O', employee: 'O', read_only: '-' },
  },
  {
    module: 'Leave — approve step 1',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Leave — approve final',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Leave — cancel own (pending)',
    access: { super_admin: 'O', hr_manager: 'O', department_manager: 'O', admin: 'O', employee: 'O', read_only: '-' },
    notes: { read_only: 'blocked' },
  },
  {
    module: 'Payroll — draft/edit',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Payroll — approve',
    access: { super_admin: 'F', hr_manager: '-', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
    notes: { super_admin: 'only role' },
  },
  {
    module: 'Payroll — mark paid',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Payroll — view',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: '-', employee: 'O', read_only: 'R' },
    notes: { department_manager: 'toggle-gated', employee: 'own payslip' },
  },
  {
    module: 'KPI settings & weights',
    access: { super_admin: 'F', hr_manager: '-', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'KPI scores — evaluate',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'KPI scores — self-eval',
    access: { super_admin: 'O', hr_manager: 'O', department_manager: 'O', admin: 'O', employee: 'O', read_only: '-' },
    notes: { read_only: 'blocked' },
  },
  {
    module: 'KPI adjustments (rewards)',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Warnings — issue directly',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Warnings — recommend',
    access: { super_admin: '-', hr_manager: '-', department_manager: 'W', admin: '-', employee: '-', read_only: '-' },
    notes: { department_manager: 'own team' },
  },
  {
    module: 'Warnings — approve rec.',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'PDP plans',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: 'O', read_only: '-' },
    notes: { employee: 'read' },
  },
  {
    module: 'PDP action complete',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: 'O', read_only: '-' },
    notes: { read_only: 'blocked' },
  },
  {
    module: 'HR documents (all)',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'B', admin: 'F', employee: 'O', read_only: '-' },
    notes: { department_manager: 'read/write', employee: 'own, read' },
  },
  {
    module: 'Document types (catalog)',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: 'R', admin: 'R', employee: 'R', read_only: 'R' },
  },
  {
    module: 'News feed — post',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'W', admin: '-', employee: '-', read_only: 'R' },
    notes: { read_only: 'read' },
  },
  {
    module: 'News feed — react/comment',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: 'F', admin: 'F', employee: 'O', read_only: '-' },
    notes: { read_only: 'blocked' },
  },
  {
    module: 'News feed — moderate',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Shift settings',
    access: { super_admin: 'F', hr_manager: 'W', department_manager: 'R', admin: 'R', employee: 'R', read_only: 'R' },
  },
  {
    module: 'Data subject requests',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: 'O', read_only: 'R' },
    notes: { employee: 'own' },
  },
  {
    module: 'Consent records',
    access: { super_admin: 'F', hr_manager: 'F', department_manager: '-', admin: '-', employee: 'O', read_only: 'R' },
    notes: { employee: 'own' },
  },
  {
    module: 'Audit logs',
    access: { super_admin: 'R', hr_manager: 'R', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'Login attempts',
    access: { super_admin: 'R', hr_manager: '-', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
  },
  {
    module: 'User roles / permissions',
    access: { super_admin: 'F', hr_manager: '-', department_manager: '-', admin: '-', employee: 'O', read_only: '-' },
    notes: { employee: 'own, read' },
  },
  {
    module: 'Leads / demo requests',
    // AMBIGUOUS CELL, flagged rather than guessed: the Standard's §3 source
    // row does not give one letter per role at all — it's a single merged
    // note spanning the row: "Platform owner only, regardless of role."
    // Per §1, `is_platform_owner` is a cross-cutting flag independent of
    // role — a company's own super_admin does NOT get this just by being
    // super_admin. Represented here as '-' for all 6 roles (true for every
    // ordinary tenant account, super_admin included) with the qualifier
    // preserved verbatim in `rowNote` rather than inventing a per-role
    // breakdown the source doesn't provide.
    access: { super_admin: '-', hr_manager: '-', department_manager: '-', admin: '-', employee: '-', read_only: '-' },
    rowNote: 'Platform owner only, regardless of role',
  },
]
