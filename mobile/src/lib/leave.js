import supabase from './supabase'

// Matches the web's LEAVE_TYPES, which in turn matches handbook Art. 7–9.
export const LEAVE_TYPES = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'marriage', label: 'Marriage' },
  { value: 'paternity', label: 'Paternity' },
  { value: 'maternity', label: 'Maternity' },
  { value: 'hajj', label: 'Hajj' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'study', label: 'Study' },
]

export const STATUS_META = {
  pending: { label: 'Pending', tone: 'warning' },
  manager_approved: { label: 'Manager approved', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
}

export function typeLabel(value) {
  return LEAVE_TYPES.find((t) => t.value === value)?.label ?? value
}

// Inclusive day count between two YYYY-MM-DD strings. Parsed at local midnight
// so the count doesn't shift by a day in UTC+4 / UTC+1.
export function dayCount(startDate, endDate) {
  if (!startDate || !endDate) return 0
  const a = new Date(`${startDate}T00:00:00`)
  const b = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86400000) + 1
}

// Adjusts leave_balances.used_days by `delta`. The web app does this inline in
// two places with the same read-then-write shape; centralised here.
//
// NOTE: this is a non-atomic read-modify-write, inherited from the web
// implementation. Two requests submitted at once can lose one increment. The
// correct fix is a single SQL statement or an RPC doing
// `used_days = used_days + $1`; flagged rather than silently diverging from the
// behaviour the web app already has.
async function adjustBalance({ employeeId, leaveType, year, delta }) {
  const { data: bal } = await supabase
    .from('leave_balances')
    .select('id, used_days')
    .eq('employee_id', employeeId)
    .eq('leave_type', leaveType)
    .eq('year', year)
    .maybeSingle()

  if (!bal) return
  await supabase
    .from('leave_balances')
    .update({ used_days: Math.max(0, Number(bal.used_days || 0) + delta) })
    .eq('id', bal.id)
}

export async function submitRequest({ employeeId, companyId, leaveType, startDate, endDate, reason }) {
  const days = dayCount(startDate, endDate)
  if (days <= 0) return { error: 'Choose an end date on or after the start date.' }

  const { error } = await supabase.from('leave_requests').insert({
    company_id: companyId,
    employee_id: employeeId,
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    days_requested: days,
    reason: (reason ?? '').trim(),
    status: 'pending',
  })

  if (error) {
    console.error('[leave] submitRequest failed', error)
    return { error: 'Something went wrong submitting your request. Please try again.' }
  }

  // Balance reflects pending requests, same as the web.
  await adjustBalance({
    employeeId,
    leaveType,
    year: new Date(`${startDate}T00:00:00`).getFullYear(),
    delta: days,
  })

  return { error: null, days }
}

// Two-step flow per Art. 10.1 (Employee → Manager → HR): a department_manager
// acting on a 'pending' request advances it to 'manager_approved'; HR and
// super_admin finalise. Only `status` is sent — the aa_leave_transition trigger
// fills in who reviewed it based on the caller's own role, and throws on an
// invalid transition, so trigger messages are surfaced verbatim.
export async function approveRequest({ request, isHR }) {
  const nextStatus = !isHR && request.status === 'pending' ? 'manager_approved' : 'approved'
  const { error } = await supabase.from('leave_requests').update({ status: nextStatus }).eq('id', request.id)
  if (error) {
    console.error('[leave] approveRequest failed', error)
    return { error: error.message, status: null }
  }
  return { error: null, status: nextStatus }
}

export async function rejectRequest({ request, reason }) {
  const { error } = await supabase
    .from('leave_requests')
    .update({ status: 'rejected', rejection_reason: (reason ?? '').trim() || null })
    .eq('id', request.id)

  if (error) {
    console.error('[leave] rejectRequest failed', error)
    return { error: error.message }
  }

  // Give the days back — the submit deducted them up front.
  await adjustBalance({
    employeeId: request.employee_id,
    leaveType: request.leave_type,
    year: new Date(`${request.start_date}T00:00:00`).getFullYear(),
    delta: -Number(request.days_requested || 0),
  })

  return { error: null }
}
