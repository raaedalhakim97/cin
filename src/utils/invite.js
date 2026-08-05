// Employee invite flow (migration 40) — mirrors onboarding.js's pending/
// bootstrap pattern, but for joining an EXISTING company via an HR-issued
// invite rather than self-onboarding a brand new one. NEVER call
// onboard_company()/self_onboard_company() from anywhere in this flow —
// accept_employee_invite() alone links the auth account to the pending
// employee record, assigns the role, and consumes the invite.
const INVITE_TOKEN_KEY = 'byond_pending_invite_token'

// sessionStorage (not localStorage) per the task's explicit instruction —
// an invite token is single-use and tab-scoped, unlike the signup pending
// payload which deliberately persists across tabs/reloads.
export function savePendingInviteToken(token) {
  sessionStorage.setItem(INVITE_TOKEN_KEY, token)
}

export function readPendingInviteToken() {
  return sessionStorage.getItem(INVITE_TOKEN_KEY)
}

export function clearPendingInviteToken() {
  sessionStorage.removeItem(INVITE_TOKEN_KEY)
}

export async function acceptEmployeeInvite(supabase, token) {
  return supabase.rpc('accept_employee_invite', { p_token: token })
}

// Migration 42 — profile-first invite flow. Issues an invite for an
// EXISTING employee profile (created via the "Add Employee" form, which now
// always saves with status: 'invited'), rather than creating the record and
// the invite in one step like the deprecated create_employee_invite(). See
// generate_employee_invite()'s own body for the exact warning strings and
// guard-clause exceptions (already has a login, pending invite exists,
// invalid email) — both are shown verbatim to the caller.
export async function generateEmployeeInvite(supabase, employeeId, role) {
  return supabase.rpc('generate_employee_invite', { p_employee_id: employeeId, p_role: role })
}

// Matches create_employee_invite's p_role CHECK exactly (confirmed live via
// pg_get_functiondef) — no 'super_admin' option, the RPC itself throws if
// asked to create one.
export const INVITE_ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'department_manager', label: 'Department Manager' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'read_only', label: 'Read Only' },
]

export const INVITE_ROLE_LABEL = Object.fromEntries(INVITE_ROLE_OPTIONS.map((o) => [o.value, o.label]))

export function inviteLinkFor(token) {
  return `${window.location.origin}/invite/${token}`
}
