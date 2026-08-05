// Demo seed data. Personas and KPI figures are taken from hr_design_final.pdf's
// sample screens so a demo build lines up with the design document.
//
// Rows here carry their embedded relations already resolved (e.g. an attendance
// row includes `employees: { full_name }`). The demo query builder returns whole
// rows and ignores the requested column list — harmless, since screens only read
// the fields they asked for, and it avoids reimplementing PostgREST projection.

import { localDateStr } from '../format'

const COMPANY_ID = 'demo-company'
const YEAR = new Date().getFullYear()
const MONTH = new Date().getMonth() + 1

function atToday(hh, mm) {
  const d = new Date()
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysAhead(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// ── People ──────────────────────────────────────────────────────────────────

const PEOPLE = [
  { id: 'e1', full_name: 'Sarah Al-Hamdan', job_title: 'Product Manager', dept: 'Product', emp_code: 'EMP-0042', kpi: 91 },
  { id: 'e2', full_name: 'Omar Khalid', job_title: 'Sr. Developer', dept: 'Engineering', emp_code: 'EMP-0043', kpi: 78 },
  { id: 'e3', full_name: 'Lina Mansour', job_title: 'HR Specialist', dept: 'HR', emp_code: 'EMP-0031', kpi: 85 },
  { id: 'e4', full_name: 'Yousef Nasser', job_title: 'UX Designer', dept: 'Design', emp_code: 'EMP-0044', kpi: 67 },
  { id: 'e5', full_name: 'Dana Al-Rashid', job_title: 'Finance Analyst', dept: 'Finance', emp_code: 'EMP-0022', kpi: 94 },
  { id: 'e6', full_name: 'Tariq Al-Ghamdi', job_title: 'Sales Manager', dept: 'Sales', emp_code: 'EMP-0018', kpi: 80 },
  { id: 'e7', full_name: 'Nour Ibrahim', job_title: 'Marketing Lead', dept: 'Marketing', emp_code: 'EMP-0051', kpi: 88 },
  { id: 'e8', full_name: 'Raaed Hassan', job_title: 'Chief Executive', dept: 'Executive', emp_code: 'EMP-0001', kpi: 96 },
  { id: 'e9', full_name: 'Faisal Al-Omar', job_title: 'Ops Coordinator', dept: 'Operations', emp_code: 'EMP-0020', kpi: 82 },
  { id: 'e10', full_name: 'Hana Al-Zahra', job_title: 'Internal Auditor', dept: 'Finance', emp_code: 'EMP-0060', kpi: 79 },
]

// One account per role, so all six of the access-control standard's roles can be
// walked through without a database. Order matches §1 of that document, most
// privileged first.
export const PERSONAS = [
  { userId: 'u8', employeeId: 'e8', role: 'super_admin', label: 'Raaed Hassan', sub: 'Super Admin · owns the company' },
  { userId: 'u3', employeeId: 'e3', role: 'hr_manager', label: 'Lina Mansour', sub: 'HR Manager · all HR operations' },
  { userId: 'u6', employeeId: 'e6', role: 'department_manager', label: 'Tariq Al-Ghamdi', sub: 'Dept. Manager · Sales only' },
  { userId: 'u9', employeeId: 'e9', role: 'admin', label: 'Faisal Al-Omar', sub: 'Ops Coordinator · shifts & documents' },
  { userId: 'u1', employeeId: 'e1', role: 'employee', label: 'Sarah Al-Hamdan', sub: 'Employee · self-service only' },
  { userId: 'u10', employeeId: 'e10', role: 'read_only', label: 'Hana Al-Zahra', sub: 'Read Only · auditor, no writes' },
]

const employeeRow = (p) => ({
  id: p.id,
  user_id: `u${p.id.slice(1)}`,
  full_name: p.full_name,
  email: `${p.full_name.split(' ')[0].toLowerCase()}@company.com`,
  phone: '+971 50 123 4567',
  photo_url: null,
  job_title: p.job_title,
  department_id: `d-${p.dept}`,
  classification: 'full_time_permanent',
  contract_type: 'indefinite',
  hire_date: '2023-01-15',
  status: 'active',
  can_post_feed: p.dept === 'HR' || p.dept === 'Executive',
  emp_code: p.emp_code,
  departments: { name: p.dept },
})

// ── Tables ──────────────────────────────────────────────────────────────────

export function buildSeed() {
  const employees = PEOPLE.map(employeeRow)

  const user_roles = PERSONAS.map((p) => ({
    user_id: p.userId,
    role: p.role,
    company_id: COMPANY_ID,
  }))

  const company = [
    {
      id: COMPANY_ID,
      name: 'Northwind Trading LLC',
      plan: 'trial',
      // AED here, but change this one value to NGN and every money figure in the
      // app follows — the hardcoding the web app has is not reproduced.
      currency: 'AED',
      trial_ends_at: daysAhead(9).toISOString(),
      work_start_time: '08:00',
      // §4.7 — salary visibility is opt-in. Left false so the default state is
      // what a reviewer sees: a department manager gets no team payroll.
      manager_salary_visibility: false,
      privacy_contact_email: 'privacy@northwind.example',
    },
  ]

  // Today: Sarah is clocked in and late-minor; the rest of the team is mixed, so
  // the manager view has something to look at.
  const attendance = [
    {
      id: 'a-today-e1',
      company_id: COMPANY_ID,
      employee_id: 'e1',
      date: localDateStr(),
      clock_in: atToday(8, 12),
      clock_out: null,
      status: 'late_minor',
      clock_in_lat: 25.0993,
      clock_in_lng: 55.1735,
      overtime_hours: 0,
      employees: { full_name: 'Sarah Al-Hamdan' },
    },
    ...['e2', 'e3', 'e5', 'e6', 'e7', 'e8', 'e9'].map((id, i) => {
      const person = PEOPLE.find((p) => p.id === id)
      return {
        id: `a-today-${id}`,
        company_id: COMPANY_ID,
        employee_id: id,
        date: localDateStr(),
        clock_in: atToday(7 + (i % 2), 45 + i * 3),
        clock_out: i % 3 === 0 ? atToday(17, 5) : null,
        status: i === 3 ? 'late_moderate' : 'present',
        clock_in_lat: 25.0993,
        clock_in_lng: 55.1735,
        overtime_hours: i % 2 ? 0.5 : 0,
        employees: { full_name: person.full_name },
      }
    }),
    // Sarah's month so far — drives the "This month" tiles and history list.
    ...Array.from({ length: 12 }).map((_, i) => {
      const d = daysAgo(i + 1)
      const weekend = d.getDay() === 0 || d.getDay() === 6
      const status = weekend ? 'on_leave' : i === 2 ? 'late_minor' : i === 7 ? 'absent' : 'present'
      return {
        id: `a-hist-e1-${i}`,
        company_id: COMPANY_ID,
        employee_id: 'e1',
        date: localDateStr(d),
        clock_in: weekend || status === 'absent' ? null : atToday(8, i === 2 ? 24 : 2),
        clock_out: weekend || status === 'absent' ? null : atToday(17, 8),
        status,
        clock_in_lat: 25.0993,
        clock_in_lng: 55.1735,
        overtime_hours: i % 4 === 0 ? 1.1 : 0,
        employees: { full_name: 'Sarah Al-Hamdan' },
      }
    }),
  ]

  // Column names follow the live schema: entitled_days (not total_days), plus
  // pending_days for requests awaiting approval. remaining_days is generated in
  // Postgres; the demo client keeps it in step on write.
  const leaveFor = (employeeId, entries) =>
    entries.map(([leave_type, entitled_days, used_days], i) => ({
      id: `lb-${employeeId}-${i}`,
      company_id: COMPANY_ID,
      employee_id: employeeId,
      leave_type,
      year: YEAR,
      entitled_days,
      used_days,
      pending_days: 0,
      remaining_days: entitled_days - used_days,
    }))

  const leave_balances = [
    ...leaveFor('e1', [
      ['annual', 21, 6],
      ['sick', 10, 2],
      ['emergency', 3, 1],
    ]),
    ...leaveFor('e6', [
      ['annual', 30, 12],
      ['sick', 10, 0],
    ]),
    ...leaveFor('e3', [
      ['annual', 21, 8],
      ['sick', 10, 3],
    ]),
    ...leaveFor('e8', [['annual', 30, 4]]),
    ...leaveFor('e9', [
      ['annual', 21, 9],
      ['sick', 10, 1],
    ]),
    ...leaveFor('e10', [['annual', 21, 2]]),
  ]

  const leave_requests = [
    {
      id: 'lr1',
      company_id: COMPANY_ID,
      employee_id: 'e1',
      leave_type: 'annual',
      start_date: localDateStr(daysAhead(12)),
      end_date: localDateStr(daysAhead(16)),
      days_requested: 5,
      status: 'pending',
      reason: 'Family vacation',
      rejection_reason: null,
      created_at: daysAgo(1).toISOString(),
      employees: { full_name: 'Sarah Al-Hamdan' },
    },
    {
      id: 'lr2',
      company_id: COMPANY_ID,
      employee_id: 'e1',
      leave_type: 'sick',
      start_date: localDateStr(daysAgo(9)),
      end_date: localDateStr(daysAgo(8)),
      days_requested: 2,
      status: 'approved',
      reason: 'Medical certificate provided',
      rejection_reason: null,
      created_at: daysAgo(11).toISOString(),
      employees: { full_name: 'Sarah Al-Hamdan' },
    },
    {
      id: 'lr3',
      company_id: COMPANY_ID,
      employee_id: 'e4',
      leave_type: 'emergency',
      start_date: localDateStr(daysAhead(1)),
      end_date: localDateStr(daysAhead(1)),
      days_requested: 1,
      status: 'pending',
      reason: 'Family emergency',
      rejection_reason: null,
      created_at: daysAgo(0).toISOString(),
      employees: { full_name: 'Yousef Nasser' },
    },
    {
      id: 'lr4',
      company_id: COMPANY_ID,
      employee_id: 'e2',
      leave_type: 'annual',
      start_date: localDateStr(daysAhead(20)),
      end_date: localDateStr(daysAhead(24)),
      days_requested: 5,
      status: 'manager_approved',
      reason: 'Pre-booked trip',
      rejection_reason: null,
      created_at: daysAgo(3).toISOString(),
      employees: { full_name: 'Omar Khalid' },
    },
    {
      id: 'lr5',
      company_id: COMPANY_ID,
      employee_id: 'e1',
      leave_type: 'study',
      start_date: localDateStr(daysAgo(30)),
      end_date: localDateStr(daysAgo(28)),
      days_requested: 3,
      status: 'rejected',
      reason: 'Exam preparation',
      rejection_reason: 'Overlaps with the quarterly release window.',
      created_at: daysAgo(34).toISOString(),
      employees: { full_name: 'Sarah Al-Hamdan' },
    },
  ]

  const WEIGHTS = { attendance: 30, behavior: 25, achievement: 20, manager: 15, self: 10 }

  const ratingFor = (score) => {
    if (score >= 90) return 'Exceptional'
    if (score >= 75) return 'High Performer'
    if (score >= 60) return 'Meets Expectations'
    if (score >= 45) return 'Needs Improvement'
    return 'Unsatisfactory'
  }

  const kpiRow = (employeeId, year, month, total, parts) => ({
    id: `k-${employeeId}-${year}-${month}`,
    company_id: COMPANY_ID,
    employee_id: employeeId,
    period_year: year,
    period_month: month,
    attendance_score: parts.attendance,
    behavior_score: parts.behavior,
    achievement_score: parts.achievement,
    manager_score: parts.manager,
    self_score: parts.self,
    total_score: total,
    rating: ratingFor(total),
    weights_used: WEIGHTS,
    notes: null,
    employees: { full_name: PEOPLE.find((p) => p.id === employeeId)?.full_name },
  })

  const kpi_scores = [
    kpiRow('e1', YEAR, MONTH, 91, { attendance: 88, behavior: 92, achievement: 95, manager: 90, self: 85 }),
    kpiRow('e2', YEAR, MONTH, 78, { attendance: 74, behavior: 80, achievement: 82, manager: 76, self: 75 }),
    kpiRow('e3', YEAR, MONTH, 85, { attendance: 92, behavior: 84, achievement: 80, manager: 82, self: 80 }),
    kpiRow('e4', YEAR, MONTH, 67, { attendance: 58, behavior: 70, achievement: 72, manager: 68, self: 70 }),
    kpiRow('e5', YEAR, MONTH, 94, { attendance: 100, behavior: 92, achievement: 90, manager: 94, self: 90 }),
    kpiRow('e6', YEAR, MONTH, 80, { attendance: 82, behavior: 78, achievement: 80, manager: 80, self: 78 }),
    kpiRow('e7', YEAR, MONTH, 88, { attendance: 90, behavior: 86, achievement: 88, manager: 88, self: 85 }),
    kpiRow('e8', YEAR, MONTH, 96, { attendance: 98, behavior: 96, achievement: 96, manager: 95, self: 92 }),
    kpiRow('e9', YEAR, MONTH, 82, { attendance: 86, behavior: 82, achievement: 80, manager: 80, self: 80 }),
    kpiRow('e10', YEAR, MONTH, 79, { attendance: 84, behavior: 78, achievement: 76, manager: 78, self: 75 }),
    // Sarah's previous months, for the history list.
    kpiRow('e1', YEAR, MONTH === 1 ? 12 : MONTH - 1, 88, { attendance: 85, behavior: 90, achievement: 92, manager: 86, self: 82 }),
    kpiRow('e1', YEAR, MONTH <= 2 ? 11 : MONTH - 2, 82, { attendance: 80, behavior: 84, achievement: 85, manager: 80, self: 78 }),
  ]

  const payrollRow = (employeeId, monthsBack, status) => {
    const d = daysAgo(monthsBack * 30)
    return {
      id: `p-${employeeId}-${monthsBack}`,
      employee_id: employeeId,
      period_year: d.getFullYear(),
      period_month: d.getMonth() + 1,
      status,
      basic_salary: 8000,
      housing_allowance: 2000,
      transport_allowance: 800,
      other_allowance: 0,
      overtime_pay: monthsBack === 0 ? 450 : 320,
      performance_bonus: monthsBack === 0 ? 500 : 0,
      deductions: 500,
    }
  }

  const payroll_runs = [
    payrollRow('e1', 0, 'approved'),
    payrollRow('e1', 1, 'paid'),
    payrollRow('e1', 2, 'paid'),
    payrollRow('e6', 0, 'approved'),
    payrollRow('e3', 0, 'approved'),
    payrollRow('e8', 0, 'paid'),
    // e9 is the ops coordinator: a row exists, but 'Payroll — view' is '-' for
    // admin, so the app must never show it.
    payrollRow('e9', 0, 'approved'),
    payrollRow('e10', 0, 'approved'),
  ]

  const hr_documents_with_status = [
    { id: 'doc1', employee_id: 'e1', document_type_id: 'dt1', file_name: 'Employment Contract.pdf', expiry_date: null, expiry_status: 'valid', scope: 'employee' },
    { id: 'doc2', employee_id: 'e1', document_type_id: 'dt2', file_name: 'Passport Copy.pdf', expiry_date: localDateStr(daysAhead(40)), expiry_status: 'expiring_soon', scope: 'employee' },
    { id: 'doc3', employee_id: 'e1', document_type_id: 'dt3', file_name: 'Visa.pdf', expiry_date: localDateStr(daysAhead(11)), expiry_status: 'expiring_critical', scope: 'employee' },
    { id: 'doc4', employee_id: 'e6', document_type_id: 'dt1', file_name: 'Employment Contract.pdf', expiry_date: null, expiry_status: 'valid', scope: 'employee' },
  ]

  const feed_posts = [
    {
      id: 'fp1',
      company_id: COMPANY_ID,
      author_employee_id: 'e3',
      status: 'published',
      category: 'payroll',
      title: 'April payslips are ready',
      body: 'You can now view and download your April payslip from the Profile tab. Payroll disputes must be raised within 5 working days of salary credit.',
      created_at: daysAgo(0).toISOString(),
      employees: { full_name: 'Lina Mansour' },
    },
    {
      id: 'fp2',
      company_id: COMPANY_ID,
      author_employee_id: 'e8',
      status: 'published',
      category: 'recognition',
      title: 'Dana Al-Rashid — Employee of the Month',
      body: 'Dana closed the quarter with a KPI of 94 and perfect attendance. That earns +10 KPI points and a certificate. Congratulations!',
      created_at: daysAgo(2).toISOString(),
      employees: { full_name: 'Raaed Hassan' },
    },
    {
      id: 'fp3',
      company_id: COMPANY_ID,
      author_employee_id: 'e3',
      status: 'published',
      category: 'policy',
      title: 'Ramadan working hours',
      body: 'Working hours are reduced by 2 hours per day for the duration of Ramadan, per applicable local labour law. Shift schedules have been updated already — check the Attend tab.',
      created_at: daysAgo(6).toISOString(),
      employees: { full_name: 'Lina Mansour' },
    },
  ]

  const feed_reactions = [
    { id: 'fr1', post_id: 'fp1', employee_id: 'e2', reaction: 'like' },
    { id: 'fr2', post_id: 'fp2', employee_id: 'e1', reaction: 'celebrate' },
    { id: 'fr3', post_id: 'fp2', employee_id: 'e2', reaction: 'celebrate' },
    { id: 'fr4', post_id: 'fp2', employee_id: 'e7', reaction: 'support' },
    { id: 'fr5', post_id: 'fp3', employee_id: 'e4', reaction: 'like' },
  ]

  const feed_comments = [
    {
      id: 'fc1',
      post_id: 'fp2',
      employee_id: 'e7',
      body: 'Very well deserved — congratulations Dana!',
      created_at: daysAgo(2).toISOString(),
      employees: { full_name: 'Nour Ibrahim' },
    },
    {
      id: 'fc2',
      post_id: 'fp3',
      employee_id: 'e2',
      body: 'Does this apply to the on-call rotation as well?',
      created_at: daysAgo(5).toISOString(),
      employees: { full_name: 'Omar Khalid' },
    },
  ]

  const today_schedule = PERSONAS.map((p) => ({
    employee_id: p.employeeId,
    start_at: atToday(8, 0),
    end_at: atToday(17, 0),
    template_name: 'Day Shift',
    shift_type: 'work',
  }))

  const shifts = PERSONAS.map((p, i) => ({
    id: `s-${i}`,
    employee_id: p.employeeId,
    shift_date: localDateStr(),
    shift_type: 'work',
    status: 'published',
    start_at: atToday(8, 0),
  }))

  return {
    employees,
    user_roles,
    company,
    departments: [...new Set(PEOPLE.map((p) => p.dept))].map((name) => ({ id: `d-${name}`, name })),
    attendance,
    leave_balances,
    leave_requests,
    kpi_scores,
    payroll_runs,
    hr_documents_with_status,
    feed_posts,
    feed_reactions,
    feed_comments,
    today_schedule,
    shifts,
    shift_settings: [
      {
        company_id: COMPANY_ID,
        late_grace_minutes: 15,
        require_shift_to_clock_in: false,
        // Off in demo so clock-in works without a location permission prompt.
        require_gps_clock_in: false,
      },
    ],
    kpi_settings: [
      {
        company_id: COMPANY_ID,
        late_grace_minutes: 15,
        weight_attendance: 30,
        weight_behavior: 25,
        weight_achievement: 20,
        weight_manager: 15,
        weight_self: 10,
        evaluation_frequency_months: 1,
        evaluation_anchor_month: 1,
      },
    ],
    employee_compliance_status: [
      { employee_id: 'e1', compliance_status: 'valid' },
      { employee_id: 'e1', compliance_status: 'expiring_soon' },
    ],
    pdp_plans: [],
  }
}

export { COMPANY_ID }
