import {
  LayoutDashboard, Users, CalendarCheck, CalendarOff, CreditCard, BarChart3,
  BarChart2, Newspaper, Inbox, Settings, ShieldCheck, FileText, Calendar,
  CalendarClock, UserCircle, Building2, Globe2, UserPlus, FileSpreadsheet,
} from 'lucide-react'
import { NAV } from './vocabulary'

// Who can reach what, defined once.
//
// This file exists because /permissions promised a "role preview" and could not honestly
// deliver one. The sidebar's item list lived inside Sidebar.jsx and the router's role sets
// lived inside App.jsx, so a preview would have had to copy both — and a copy of an access
// rule is a rule that drifts, quietly, until the screen showing people what a role can do
// is wrong. A wrong answer about permissions is worse than no answer.
//
// So the definitions moved here and Sidebar.jsx and App.jsx now import them. The preview
// reads the same arrays the app itself obeys, which means it cannot be out of date without
// the app being broken in the same way.
//
// This describes NAVIGATION and ROUTING only. It is not the security boundary: every one
// of these pages is also protected by row level security in Postgres, which is what
// actually stops someone reaching data by typing a URL. Hiding a link is a courtesy, not
// a control — see BYOND-HR_Access_Control_Standard.md §3, and ACCESS_MATRIX in
// accessMatrix.js for what the database enforces.

export const ADMIN_HR             = ['super_admin', 'hr_manager']
export const ADMIN_HR_MGR         = ['super_admin', 'hr_manager', 'department_manager', 'admin']
export const SUPER_ADMIN          = ['super_admin']
export const SCHEDULE_ROLES       = ['super_admin', 'hr_manager', 'admin']
export const DOCUMENTS_ROLES      = ['super_admin', 'hr_manager', 'admin']
export const EMPLOYEES_LIST_ROLES = ['super_admin', 'hr_manager', 'admin']

// Migration 42 excluded only 'employee' from Settings. Session 42 narrowed it further to
// super_admin/hr_manager: once My Privacy & Data moved to /profile for everyone, 'admin',
// 'department_manager' and 'read_only' had nothing left to see there either.
export const SETTINGS_ROLES = ['super_admin', 'hr_manager']

// ─── Sidebar ────────────────────────────────────────────────────────────────
// `roles` is optional — items without it render for everyone, because the route guard is
// what actually blocks access. Only items that should be hidden entirely from other roles
// (not merely redirected) set it.
export const NAV_ITEMS = [
  { label: NAV.home,          icon: LayoutDashboard, path: '/dashboard',          live: true },
  { label: NAV.profile,       icon: UserCircle,      path: '/profile',            live: true },
  { label: NAV.employees,     icon: Users,           path: '/employees',          live: true, roles: EMPLOYEES_LIST_ROLES },
  { label: NAV.attendance,    icon: CalendarCheck,   path: '/attendance',         live: true },
  { label: NAV.leave,         icon: CalendarOff,     path: '/leave',              live: true },
  { label: NAV.payroll,       icon: CreditCard,      path: '/payroll',            live: true },
  { label: NAV.kpi,           icon: BarChart3,       path: '/kpi',                live: true },
  { label: NAV.teamAnalytics, icon: BarChart2,       path: '/team-analytics',     live: true, roles: ADMIN_HR },
  { label: NAV.documents,     icon: FileText,        path: '/documents',          live: true, roles: DOCUMENTS_ROLES },
  { label: NAV.schedule,      icon: Calendar,        path: '/schedule',           live: true, roles: SCHEDULE_ROLES },
  { label: NAV.mySchedule,    icon: CalendarClock,   path: '/my-schedule',        live: true },
  { label: NAV.news,          icon: Newspaper,       path: '/news',               live: true },
  // Platform-level items. Gated on `platformOwner`, not on a role: a tenant's own
  // super_admin runs one company and must not be shown a list of all of them.
  { label: NAV.platform,      icon: Building2,       path: '/platform',           live: true, platformOwner: true },
  { label: NAV.leads,         icon: Inbox,           path: '/leads',              live: true, platformOwner: true },
  { label: NAV.countries,     icon: Globe2,          path: '/platform/countries', live: true, platformOwner: true },
  { label: NAV.settings,      icon: Settings,        path: '/settings',           live: true, roles: SETTINGS_ROLES },
  { label: NAV.access,        icon: ShieldCheck,     path: '/permissions',        live: true, roles: SUPER_ADMIN },
]

// A platform owner sees ONLY the platform items. They run BYOND; they are not staff at one
// of its companies, so Attendance, KPI, Payroll and the employee list are not theirs to
// look at.
//
// Written as "platform items only" rather than "hide these few" on purpose: a page added
// to the tenant app later cannot leak into the operator's sidebar by someone forgetting to
// exclude it.
export function visibleNavFor({ role, isPlatformOwner }) {
  return NAV_ITEMS.filter((item) => {
    if (isPlatformOwner) return item.platformOwner === true
    if (item.platformOwner) return false
    return !item.roles || item.roles.includes(role)
  })
}

// ─── Routes ─────────────────────────────────────────────────────────────────
// Every guarded route, with the roles its PrivateRoute allows. `roles: null` means any
// signed-in account reaches it.
//
// Listed separately from NAV_ITEMS because the two genuinely differ, and the differences
// are the interesting part of a role preview. An 'admin' sees the Employees link and can
// open the list, but /employees/new is ADMIN_HR — so they can look and not add. No
// sidebar can express that; this can.
export const ROUTE_ACCESS = [
  { path: '/dashboard',          label: 'Dashboard',            icon: LayoutDashboard, roles: null },
  { path: '/profile',            label: 'My profile',            icon: UserCircle,      roles: null },
  { path: '/attendance',         label: 'Attendance',            icon: CalendarCheck,   roles: null },
  { path: '/leave',              label: 'Leave',                 icon: CalendarOff,     roles: null },
  { path: '/kpi',                label: 'KPI',                   icon: BarChart3,       roles: null },
  { path: '/payroll',            label: 'Payroll',               icon: CreditCard,      roles: null },
  { path: '/my-schedule',        label: 'My schedule',           icon: CalendarClock,   roles: null },
  { path: '/news',               label: 'News',                  icon: Newspaper,       roles: null },
  { path: '/employees',          label: 'Employee list',         icon: Users,           roles: EMPLOYEES_LIST_ROLES },
  { path: '/employees/:id',      label: 'Employee record',       icon: Users,           roles: ADMIN_HR_MGR },
  { path: '/employees/new',      label: 'Add an employee',       icon: UserPlus,        roles: ADMIN_HR },
  { path: '/team-analytics',     label: 'Team analytics',        icon: BarChart2,       roles: ADMIN_HR },
  { path: '/documents',          label: 'Documents',             icon: FileText,        roles: DOCUMENTS_ROLES },
  { path: '/schedule',           label: 'Schedule',              icon: Calendar,        roles: SCHEDULE_ROLES },
  { path: '/schedule/templates', label: 'Schedule templates',    icon: FileSpreadsheet, roles: SCHEDULE_ROLES },
  { path: '/settings',           label: 'Settings',              icon: Settings,        roles: SETTINGS_ROLES },
  { path: '/permissions',        label: 'Permissions',           icon: ShieldCheck,     roles: SUPER_ADMIN },
  { path: '/platform',           label: 'Operator console',      icon: Building2,       platformOwner: true },
  { path: '/platform/:id',       label: 'Company file',          icon: Building2,       platformOwner: true },
  { path: '/platform/countries', label: 'Country packs',         icon: Globe2,          platformOwner: true },
  { path: '/leads',              label: 'Leads',                 icon: Inbox,           platformOwner: true },
]

// Splits the route list into what a role reaches and what it is redirected away from.
// A tenant role never "reaches" a platform route and vice versa, which is why
// platformOwner is a separate axis rather than a seventh role.
export function routeAccessFor({ role, isPlatformOwner = false }) {
  const allowed = []
  const denied  = []
  for (const route of ROUTE_ACCESS) {
    const ok = route.platformOwner
      ? isPlatformOwner === true
      : !isPlatformOwner && (!route.roles || route.roles.includes(role))
    ;(ok ? allowed : denied).push(route)
  }
  return { allowed, denied }
}
