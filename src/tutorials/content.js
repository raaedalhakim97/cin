// First-visit page tutorials, written per audience.
//
// Each page has a short guide for each kind of person who can open it. An employee and
// an HR manager land on the same Attendance page and see different things on it, so a
// single guide would either describe buttons one of them does not have or leave out
// the part the other one needs.
//
// Audiences (see audienceFor):
//   employee — their own records
//   manager  — department_manager: their own records plus their team
//   hr       — hr_manager and super_admin: the whole company, and the power to change it
//   admin    — operations: schedules and documents, reads most things, changes few
//   viewer   — read_only: an auditor's account, looks at everything and changes nothing
//
// A page can also hold a variant keyed by an exact role (super_admin) when that one role
// sees a genuinely different page — the owner's dashboard is not the HR manager's.
//
// Steps: { title, body, target? }. `target` names a [data-tour="..."] element to
// spotlight; when it is missing (not rendered for this role, or still loading) the
// step shows as a centred card instead, so a guide never breaks on a layout change.
//
// Rewriting a guide? Bump VERSION for that page so people see the new one once.

export const VERSION = { default: 1 }

export function audienceFor(role) {
  switch (role) {
    case 'employee':           return 'employee'
    case 'department_manager': return 'manager'
    case 'hr_manager':
    case 'super_admin':        return 'hr'
    case 'admin':              return 'admin'
    case 'read_only':          return 'viewer'
    default:                   return null
  }
}

// The route a pathname belongs to, as a tutorial page key.
export function pageKeyFor(pathname) {
  if (pathname === '/employees/new') return 'employee-new'
  if (/^\/employees\/[^/]+$/.test(pathname)) return 'employee-detail'
  if (pathname === '/schedule/templates') return 'schedule-templates'
  const first = pathname.split('/')[1]
  return first || null
}

const BELL = {
  title: 'Notifications',
  body: 'The bell tells you when something needs you — a leave decision, a new shift, a review to fill in. Nothing important happens silently.',
  target: 'header-bell',
}
const GUIDE = {
  title: 'Help on every page',
  body: 'The first time you open a page, a short guide like this explains it. Press ? at the top any time to see it again.',
  target: 'header-guide',
}
const MENU = {
  title: 'The menu',
  body: 'Everything else is in the menu on the left. On a phone, tap ☰ at the top to open it.',
}

// ─── Shared variants ────────────────────────────────────────────────────────

const PROFILE_ALL = [
  { title: 'Your profile', body: 'Your personal and employment details as the company holds them. If something is wrong, ask HR to correct it.' },
  { title: 'Your documents', body: 'Your contract, ID and other documents HR has on file for you, with their expiry dates so nothing lapses unnoticed.' },
  { title: 'My Privacy & Data', body: 'You can ask to see, correct, export or delete your personal data. The request goes to HR, and you can follow its status here.' },
]

const LEAVE_EMPLOYEE = [
  { title: 'Your leave', body: 'My Leave holds your balances and requests. Calendar shows leave month by month.', target: 'leave-tabs' },
  { title: 'Balances', body: 'How many days of each leave type you have left this year. Only the leave types your company offers are listed.', target: 'leave-balances' },
  { title: 'Request leave', body: 'Pick the type and the dates, give a reason, and send. You can cancel a request while it is still pending.', target: 'leave-request' },
  { title: 'Two approvals', body: 'Your manager approves first, then HR gives the final approval. Each request shows where it is, and you\'re notified at every step.' },
  { title: 'Overtime banked', body: 'Overtime HR has approved is added up here for the year. Your company decides whether it is paid or kept as a record.' },
]

const KPI_EMPLOYEE = [
  { title: 'The quarterly review', body: 'When HR opens a quarter, this panel shows the countdown, the four steps and what you need to do. Open "How the quarterly review works" for the full picture.', target: 'kpi-tracker' },
  { title: 'Rate yourself once a quarter', body: 'Your self-assessment is one score out of 100. You submit it once and it locks until next quarter — so take a minute over it.' },
  { title: 'My KPI', body: 'Your monthly score and how it is made up. Attendance is measured from your clock-ins; your manager scores the rest.', target: 'kpi-tabs' },
  { title: 'Evaluation', body: 'Your quarterly scorecard. Your manager\'s ratings and your final score appear once HR publishes the quarter.' },
  { title: 'History and development plans', body: 'Past scores, and any development plan you and your manager agree on.' },
]

const SCHEDULE_OPS = (who) => [
  { title: 'Building the week', body: 'Week View is the rota. Add shifts to each person\'s day — new shifts start as drafts that nobody else can see.' },
  { title: 'Publish', body: 'Publishing the week sends every drafted shift out. Each employee is notified and it appears in their My Schedule.' },
  { title: 'Today and Coverage', body: 'Today lists everyone\'s shift for today by department, with its status. Coverage shows how many people each department has each day — red is nobody, orange is thin.' },
  { title: 'Templates', body: `Shift templates save the shifts you use every week, so building a rota is a few clicks. ${who === 'hr' ? 'Shift rules like grace periods live in Settings → Shift Settings.' : ''}`.trim() },
]

const DOCUMENTS_OPS = (canUpload) => [
  { title: 'HR documents', body: 'Company documents — licences, policies, contracts — and every employee\'s documents, in one place.' },
  { title: 'Expiry Tracker', body: 'Everything with an expiry date, soonest first. Orange is expiring soon, red is critical or already expired.' },
  { title: canUpload ? 'Upload and renew' : 'Keeping them current', body: canUpload
      ? 'Upload a document against the company or an employee and set its expiry date. The tracker and the dashboard pick it up automatically.'
      : 'Renewals are uploaded by HR. Use the tracker to see what needs chasing.' },
]

// ─── The guides ─────────────────────────────────────────────────────────────

export const TUTORIALS = {
  dashboard: {
    employee: [
      { title: 'Welcome to BYOND', body: 'This is your home page: today\'s status and shift, your leave balance, your latest KPI score and your documents at a glance.' },
      { title: 'Quick actions', body: 'Shortcuts to clock in or out and to request leave.' },
      MENU, BELL, GUIDE,
    ],
    manager: [
      { title: 'Welcome to BYOND', body: 'Your home page shows your team today — who is present, late, absent, on leave or not clocked in yet.' },
      { title: 'Pending approvals', body: 'Leave requests from your team wait here. You approve first; HR gives the final approval.' },
      { title: 'Team KPI snapshot', body: 'How your team is scoring, so you know who needs a conversation.' },
      MENU, BELL, GUIDE,
    ],
    hr: [
      { title: 'Welcome to BYOND', body: 'Your home page is the company\'s to-do list: pending leave, expiring documents, contract ends, no-shows and data requests.' },
      { title: 'Pending approvals', body: 'Leave requests waiting for final approval. Ones a manager already approved are ready for you.' },
      { title: 'Upcoming', body: 'Contracts ending and documents expiring soon, so renewals happen before the deadline, not after.' },
      MENU, BELL, GUIDE,
    ],
    super_admin: [
      { title: 'Welcome to BYOND', body: 'As the owner, your home page is the whole company: headcount, KPI trend, people at risk and recent activity.' },
      { title: 'What needs attention', body: 'Expiring documents, missing payment details, no-shows and data requests are counted here, so nothing waits unnoticed.' },
      { title: 'Company KPI trend', body: 'The company\'s average score month by month, and the people below 60 who may need support.' },
      MENU, BELL, GUIDE,
    ],
    admin: [
      { title: 'Welcome to BYOND', body: 'Your home page is operations: today\'s shifts, no-shows this week and documents that need renewing.' },
      { title: 'Quick actions', body: 'Shortcuts to the schedule and your shift templates.' },
      MENU, BELL, GUIDE,
    ],
    viewer: [
      { title: 'Welcome to BYOND', body: 'Your account is read-only. You can look at company records for review, but you cannot change anything.' },
      { title: 'Your details', body: 'Your own employment details — department, contract and dates — are shown here.' },
      MENU, GUIDE,
    ],
  },

  profile: {
    employee: PROFILE_ALL, manager: PROFILE_ALL, hr: PROFILE_ALL, admin: PROFILE_ALL, viewer: PROFILE_ALL,
  },

  attendance: {
    employee: [
      { title: 'Clock in and out', body: 'Press Clock In when you start and Clock Out when you finish. Leaving before your shift ends asks you to confirm first.', target: 'att-today' },
      { title: 'Your week', body: 'Days present, hours worked and overtime so far this week.', target: 'att-week' },
      { title: 'The month at a glance', body: 'Each day is coloured: green present, orange late, blue approved absence, red unauthorised absence.', target: 'att-calendar' },
      { title: 'Overtime', body: 'Time beyond your schedule is counted automatically. Once HR approves it, it shows as banked hours on the Leave page.' },
      { title: 'Something wrong?', body: 'You can\'t edit your own records. If a punch is missing or wrong, tell HR — they can correct it.' },
    ],
    manager: [
      { title: 'Your own day', body: 'Clock in and out here like everyone else.', target: 'att-today' },
      { title: 'Your team', body: 'Pick someone from your team to see their month. You can look and export, but only HR can change a record.', target: 'att-roster' },
      { title: 'Reading the calendar', body: 'Green present, orange late (darker is later), blue approved absence, red unauthorised absence.', target: 'att-calendar' },
      { title: 'Exceptions', body: 'Days with a clock-in but no clock-out are listed so nothing slips through.', target: 'att-exceptions' },
      { title: 'Late alerts', body: 'You\'re notified when someone on your team clocks in late.' },
    ],
    hr: [
      { title: 'Anyone\'s attendance', body: 'Pick any employee to see their month. Your own clock in and out is here too.', target: 'att-roster' },
      { title: 'Correct a record', body: 'Open a day on the calendar to fix its times or status — for a forgotten punch or an approved absence.', target: 'att-calendar' },
      { title: 'Approve overtime', body: 'When a day has overtime, approve it in the same window. Only approved hours count as banked overtime in Leave.' },
      { title: 'Exceptions', body: 'Every day this month with a clock-in and no clock-out, across the company. Fix them before payroll.', target: 'att-exceptions' },
      { title: 'Export', body: 'Download the whole month\'s attendance for everyone.', target: 'att-export' },
    ],
    admin: [
      { title: 'Your own day', body: 'Clock in and out here.', target: 'att-today' },
      { title: 'Anyone\'s attendance', body: 'Look up any employee\'s month. You can view and export; corrections are HR\'s job.', target: 'att-roster' },
      { title: 'Exceptions', body: 'Days with a clock-in but no clock-out. Flag them to HR to fix.', target: 'att-exceptions' },
      { title: 'Export', body: 'Download the month\'s attendance for everyone.', target: 'att-export' },
    ],
    viewer: [
      { title: 'Attendance records', body: 'Look up any employee\'s month. Your account is read-only, so nothing here can be changed.', target: 'att-roster' },
      { title: 'Reading the calendar', body: 'Green present, orange late, blue approved absence, red unauthorised absence.', target: 'att-calendar' },
      { title: 'Export', body: 'Download the month\'s attendance for your review.', target: 'att-export' },
    ],
  },

  leave: {
    employee: LEAVE_EMPLOYEE,
    admin: LEAVE_EMPLOYEE,
    viewer: LEAVE_EMPLOYEE,
    manager: [
      { title: 'Your leave and your team\'s', body: 'My Leave is your own. Team Requests is where your team\'s requests wait — the number on the tab is how many need you.', target: 'leave-tabs' },
      { title: 'Approving', body: 'You give the first approval; HR gives the final one. Rejecting asks for a reason, and the employee sees it.' },
      { title: 'Calendar', body: 'Leave by month, so you can spot two people off on the same day before you approve.' },
      { title: 'Your own requests', body: 'Request your own leave from My Leave. Your balances are shown there too.', target: 'leave-request' },
    ],
    hr: [
      { title: 'Company leave', body: 'Team Requests holds every request in the company. The number on the tab is how many are waiting.', target: 'leave-tabs' },
      { title: 'Final approval', body: 'Requests a manager approved show as Manager Approved — you give the final approval. You can also approve a request directly.' },
      { title: 'Calendar', body: 'Everyone\'s leave by month, with names, so cover gaps are easy to see.' },
      { title: 'Leave policy', body: 'Which leave types the company offers, and how many days each, is set in Settings → Leave Policy.' },
    ],
  },

  kpi: {
    employee: KPI_EMPLOYEE,
    admin: KPI_EMPLOYEE,
    viewer: KPI_EMPLOYEE,
    manager: [
      { title: 'The quarterly review', body: 'This panel shows the quarter\'s countdown and what you and your team still have to do.', target: 'kpi-tracker' },
      { title: 'Your team first rates itself', body: 'Your team submits self-assessments first. You can\'t rate anyone until HR moves the quarter to manager review — you\'ll be notified.' },
      { title: 'Team Review', body: 'Rate each person on behavior, achievement and overall. Their self-assessment sits beside yours; you can\'t change it.', target: 'kpi-tabs' },
      { title: 'Team KPI and Scorecards', body: 'Team KPI shows monthly scores. Scorecards hold the criteria and weights each person is reviewed against.' },
      { title: 'Your own KPI', body: 'My KPI and Evaluation are your own results — you rate yourself each quarter too.' },
    ],
    hr: [
      { title: 'The quarterly review', body: 'This panel follows the current quarter for the whole company and tells you when a step is ready to move on.', target: 'kpi-tracker' },
      { title: 'Review Cycles', body: 'Open each quarter here with two deadlines. Then move it along: self-assessment → manager review → calculate → publish.', target: 'kpi-tabs' },
      { title: 'Reminders are automatic', body: 'People are reminded 7, 3 and 1 day before a deadline, on the day and once after — only if they still have something to do.' },
      { title: 'Team Review', body: 'Anyone without a manager is yours to rate during manager review.' },
      { title: 'Scorecards, warnings and rewards', body: 'Set the criteria and weights in Scorecards. Warnings & Rewards adjust a person\'s score with a recorded reason.' },
    ],
  },

  'my-schedule': Object.fromEntries(['employee', 'manager', 'hr', 'admin', 'viewer'].map((a) => [a, [
    { title: 'Your shifts', body: 'Your upcoming shifts with their times. Only published shifts appear here — drafts stay hidden until they are final.' },
    { title: 'Changes reach you', body: 'You\'re notified when a new week is published or you\'re given a day off.' },
  ]])),

  news: {
    employee: [
      { title: 'Company news', body: 'Announcements, news, achievements, training and policy updates. Filter by type at the top.' },
      { title: 'React', body: 'Like, celebrate, support or mark a post insightful.' },
      { title: 'Posting', body: 'If HR gives you posting rights, a New Post button appears here.' },
    ],
    manager: [
      { title: 'Company news', body: 'Announcements, news, achievements, training and policy updates. Filter by type at the top.' },
      { title: 'You can post', body: 'Share team news or celebrate an achievement. Everyone in the company sees it.' },
      { title: 'React', body: 'Like, celebrate, support or mark a post insightful.' },
    ],
    hr: [
      { title: 'Company news', body: 'The company\'s feed. Filter by announcement, news, achievement, training or policy.' },
      { title: 'Post and pin', body: 'Create a post and pin the important ones to the top of everyone\'s feed.' },
      { title: 'Moderate', body: 'Edit, archive or delete any post. To let a specific employee post, turn it on in their employee record.' },
    ],
  },

  employees: {
    hr: [
      { title: 'Your people', body: 'Everyone in the company. Search, and filter by status or department.' },
      { title: 'Add an employee', body: 'Add someone and send them an invite to set up their account. Until they accept, they show as Invite pending.' },
      { title: 'Pending invites', body: 'See invites that haven\'t been accepted yet, and cancel any that were sent by mistake.' },
      { title: 'Export', body: 'Download the list to Excel or PDF. Identity numbers are never included.' },
    ],
    admin: [
      { title: 'Employee list', body: 'Everyone in the company. Search, filter and open a record to read it. Your access is read-only here.' },
      { title: 'Export', body: 'Download the list to Excel or PDF.' },
    ],
  },

  'employee-detail': {
    hr: [
      { title: 'One employee\'s file', body: 'Profile, attendance, leave, KPI and documents for this person, one tab each.' },
      { title: 'Keep it complete', body: 'A checklist flags anything missing — job description, department, interview score — so records don\'t stay half-filled.' },
      { title: 'News feed access', body: 'Posting in the company news feed is switched on or off for this person here.' },
    ],
    manager: [
      { title: 'A team member\'s file', body: 'Their attendance, leave, KPI and documents in one place. You can read everything here; changes go through HR.' },
    ],
    admin: [
      { title: 'An employee\'s file', body: 'Profile, attendance, leave, KPI and documents in one place. Read-only for your role.' },
    ],
  },

  'employee-new': {
    hr: [
      { title: 'Adding someone', body: 'Fill in their details, then send the invite. They set their own password — you never need to know it.' },
      { title: 'Identity numbers', body: 'Emirates ID and labour card numbers are stored separately and only HR and the employee can read them.' },
    ],
  },

  'team-analytics': {
    hr: [
      { title: 'Team performance', body: 'The company\'s KPI at a glance: the average, the top performer, who is at risk below 60, and who is bonus-eligible.' },
      { title: 'Where the numbers come from', body: 'The latest monthly KPI scores — the same ones each employee sees on their own KPI page. Nothing here is estimated.' },
    ],
  },

  documents: {
    hr: DOCUMENTS_OPS(true),
    admin: DOCUMENTS_OPS(true),
  },

  schedule: {
    hr: SCHEDULE_OPS('hr'),
    admin: SCHEDULE_OPS('admin'),
  },

  'schedule-templates': Object.fromEntries(['hr', 'admin'].map((a) => [a, [
    { title: 'Shift templates', body: 'Save a shift once — name, start, end, break — and reuse it on the schedule every week.' },
  ]])),

  settings: {
    hr: [
      { title: 'Settings', body: 'Company-wide rules. Each tab is one area — leave policy, shift settings, document types and data requests.' },
      { title: 'Data requests', body: 'When someone asks to see, correct or delete their data, it lands here. Update its status so they can follow it.' },
      { title: 'Owner-only tabs', body: 'Company details, KPI weights and data retention can only be changed by the account owner.' },
    ],
  },

  permissions: {
    hr: [
      { title: 'Who can do what', body: 'The access matrix: every role and what it can see and change. The database enforces the same rules.' },
      { title: 'Role preview', body: 'Pick a role to see exactly which pages it reaches and which it doesn\'t.' },
    ],
  },
}

// The steps for this page and role, or null when there is no guide for it.
export function tutorialFor(pageKey, role) {
  const page = TUTORIALS[pageKey]
  if (!page) return null
  const audience = audienceFor(role)
  const steps = page[role] ?? (audience ? page[audience] : null)
  if (!steps?.length) return null
  const variant = page[role] ? role : audience
  const v = VERSION[pageKey] ?? VERSION.default
  return { key: `${pageKey}.${variant}.v${v}`, steps }
}
