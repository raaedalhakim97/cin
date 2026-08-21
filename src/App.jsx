import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2, ShieldOff } from 'lucide-react'
import supabase from './services/supabase'
import useAuthStore from './store/authStore'
import useThemeStore from './store/themeStore'
import PrivateRoute from './components/PrivateRoute'
import SessionTimeoutModal from './components/SessionTimeoutModal'
import { readPendingSignup, runSelfOnboard, clearPendingSignup, isAlreadyOnboardedError } from './utils/onboarding'
import { readPendingInviteToken, clearPendingInviteToken, acceptEmployeeInvite } from './utils/invite'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Demo from './pages/Demo'
import Privacy from './pages/legal/Privacy'
import Terms from './pages/legal/Terms'
import AcceptInvite from './pages/AcceptInvite'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import EmployeeList from './pages/EmployeeList'
import EmployeeNew from './pages/EmployeeNew'
import EmployeeDetail from './pages/EmployeeDetail'
import Attendance from './pages/Attendance'
import Leave from './pages/Leave'
import Payroll from './pages/Payroll'
import KPI from './pages/KPI'
import TeamAnalytics from './pages/TeamAnalytics'
import NewsFeed from './pages/NewsFeed'
import Leads from './pages/Leads'
import Platform from './pages/Platform'
import PlatformCompany from './pages/PlatformCompany'
import PlatformCountries from './pages/PlatformCountries'
import WorkspaceSuspended from './pages/WorkspaceSuspended'
import Permissions from './pages/Permissions'
import Settings from './pages/Settings'
import Documents from './pages/Documents'
import Schedule from './pages/Schedule'
import ScheduleTemplates from './pages/ScheduleTemplates'
import MySchedule from './pages/MySchedule'

function Unauthorized() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <div className="w-16 h-16 rounded-full bg-[#FF4D4D]/10 flex items-center justify-center">
        <ShieldOff size={32} className="text-[#FF4D4D]" />
      </div>
      <h1 className="text-xl font-bold text-[#1A1A1A] dark:text-white">Access Denied</h1>
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
        You don't have permission to view this page.
      </p>
      <a href="/dashboard" className="text-sm text-[#00D4A0] hover:underline">Go to Dashboard</a>
    </div>
  )
}

// Role constants — mirrors user_roles.role CHECK constraint.
// Note: ADMIN_HR predates the 'admin' role added in migrations 36–37 and
// deliberately does NOT include it for /employees/new or /team-analytics —
// confirmed live via `pg_policies` that `emp_insert`'s WITH CHECK is still
// super_admin/hr_manager only (migration 39 only extended `emp_select`, read
// access, not insert/update/delete), and team analytics was never part of
// any migration granting 'admin' access. SCHEDULE_ROLES, DOCUMENTS_ROLES,
// EMPLOYEES_LIST_ROLES, and ADMIN_HR_MGR are the groups 'admin' actually
// belongs to — matching shift_templates_write/shifts_write RLS (36–37),
// hr_documents_select/hr_documents_write RLS (38), and `emp_select` RLS (39)
// respectively. `document_types` RLS was deliberately NOT extended to
// 'admin' (defining what document types exist is HR policy work) — the
// Document Types tab in Settings stays gated to ADMIN_HR. Everywhere
// 'admin' can now read `employees`, the page itself must still hide
// edit/delete/add UI for that role — `emp_update`/`emp_delete`/`emp_insert`
// were not extended, so writes would 400 if attempted.
const ADMIN_HR      = ['super_admin', 'hr_manager']
const ADMIN_HR_MGR  = ['super_admin', 'hr_manager', 'department_manager', 'admin']
const SUPER_ADMIN   = ['super_admin']
const SCHEDULE_ROLES = ['super_admin', 'hr_manager', 'admin']
const DOCUMENTS_ROLES = ['super_admin', 'hr_manager', 'admin']
const EMPLOYEES_LIST_ROLES = ['super_admin', 'hr_manager', 'admin']
// Migration 42 excluded only 'employee' from Settings. Session 42 (a
// frontend-only fix, no new migration) moved My Privacy & Data — the one
// tab every other excluded role could still see — to /profile for
// everyone, so 'admin'/'department_manager'/
// 'read_only' now have zero visible tabs left in Settings (Data Requests/
// Retention/Company/KPI Config/Document Types/Shift Settings are all
// super_admin/hr_manager-only already) — narrowed to just those two roles
// rather than leaving the other three a route that renders an empty tab bar.
const SETTINGS_ROLES = ['super_admin', 'hr_manager']

function App() {
  const init       = useAuthStore((s) => s.init)
  const loading    = useAuthStore((s) => s.loading)
  const session    = useAuthStore((s) => s.session)
  const role       = useAuthStore((s) => s.role)
  const suspended  = useAuthStore((s) => s.suspended)
  const loadProfile = useAuthStore((s) => s.loadProfile)
  const isDark     = useThemeStore((s) => s.isDark)
  const [onboarding, setOnboarding] = useState(false)
  const [acceptingInvite, setAcceptingInvite] = useState(false)
  const attemptedOnboardRef = useRef(false)
  const attemptedInviteRef = useRef(false)

  // The theme class belongs on <html>, not on a div inside #root.
  //
  // It used to live on a wrapper div, which meant html and body were never
  // given a background at all. A div only paints its own box, so any pixel
  // outside it fell back to browser white — visible as a white band down the
  // right of any page wide enough to scroll horizontally, and on the
  // rubber-band overscroll area. Setting it here lets index.css colour the
  // whole canvas. color-scheme comes along for free, which is what makes the
  // scrollbars and native form controls dark instead of light.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  useEffect(() => {
    let subscription
    init().then((sub) => { subscription = sub })
    return () => subscription?.unsubscribe()
  }, [init])

  // Email-confirmation signup flow: signUp() had no session yet, so
  // Signup.jsx couldn't call self_onboard_company immediately. This runs it
  // on the user's first authenticated visit after they confirm — session
  // exists but role is still null (self_onboard_company hasn't run for
  // them). NEVER calls onboard_company() — that RPC is admin-only.
  //
  // `suspended` is in the condition because since migration 25 a null role has a
  // second cause: a suspended workspace cannot read its own user_roles row. Without
  // it, a suspended owner with a stale pendingSignup key would have this effect try
  // to onboard them a second time on every visit.
  useEffect(() => {
    if (loading || !session || role || suspended || attemptedOnboardRef.current) return
    const pending = readPendingSignup()
    if (!pending) return

    attemptedOnboardRef.current = true
    setOnboarding(true)
    ;(async () => {
      const { error } = await runSelfOnboard(supabase, pending)
      if (!error || isAlreadyOnboardedError(error)) {
        clearPendingSignup()
        await loadProfile(session)
      } else {
        console.error('[App] self_onboard_company failed on bootstrap retry', error)
      }
      setOnboarding(false)
    })()
  }, [loading, session, role, suspended, loadProfile])

  // Invite acceptance flow (migration 40): when email confirmation is ON,
  // AcceptInvite.jsx couldn't call accept_employee_invite immediately after
  // signUp() since no session exists yet — it stashes the token in
  // sessionStorage instead. This runs it on the user's first authenticated
  // visit after they confirm and log in — session exists but role is still
  // null (the invite hasn't been accepted for them yet). Independent of the
  // self-onboard effect above — a user is never in both flows at once, and
  // each effect's own readPendingX() simply returns null/undefined if it's
  // not theirs. NEVER calls onboard_company()/self_onboard_company() — only
  // accept_employee_invite() links the account, per the task's explicit rule.
  // `suspended` is excluded here for the same reason as above — and because an
  // invite into a suspended workspace should not quietly succeed.
  useEffect(() => {
    if (loading || !session || role || suspended || attemptedInviteRef.current) return
    const token = readPendingInviteToken()
    if (!token) return

    attemptedInviteRef.current = true
    setAcceptingInvite(true)
    ;(async () => {
      const { error } = await acceptEmployeeInvite(supabase, token)
      if (!error) {
        clearPendingInviteToken()
        await loadProfile(session)
      } else {
        // Left in place (not cleared) so a transient failure can retry on
        // the next visit — same convention as the self-onboard effect above.
        console.error('[App] accept_employee_invite failed on bootstrap retry', error)
      }
      setAcceptingInvite(false)
    })()
  }, [loading, session, role, suspended, loadProfile])

  return (
    <div>
      {loading || onboarding || acceptingInvite ? (
        <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0] dark:bg-[#0F0F0F]">
          <Loader2 size={28} className="animate-spin text-[#00D4A0]" />
        </div>
      ) : (
        <BrowserRouter>
          {/* Session timeout modal: only rendered when a session exists */}
          {session && <SessionTimeoutModal />}

          <Routes>
            {/* Public marketing site — no auth guard, never touches Supabase.
                Logged-in users hitting "/" are bounced to their dashboard. */}
            <Route path="/" element={
              session ? <Navigate to="/dashboard" replace /> : <Landing />
            } />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/demo" element={<Demo />} />
            {/* Reachable signed out and signed in alike: a privacy notice
                nobody can read without an account is not a privacy notice. */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Deliberately not wrapped in PrivateRoute: that guard is what sends
                people here, and wrapping it would be a redirect loop. It needs a
                session (everything on it comes from my_workspace(), which refuses
                an anonymous caller) and it must bounce anyone whose workspace is
                fine, or a stale bookmark would show a suspension that isn't. */}
            <Route path="/workspace-suspended" element={
              !session ? <Navigate to="/login" replace />
                : suspended ? <WorkspaceSuspended />
                : <Navigate to="/dashboard" replace />
            } />

            {/* All authenticated users */}
            <Route path="/dashboard" element={
              <PrivateRoute>
                <Dashboard />
              </PrivateRoute>
            } />

            {/* All authenticated users — own profile, read-only employment details + own documents */}
            <Route path="/profile" element={
              <PrivateRoute>
                <Profile />
              </PrivateRoute>
            } />

            <Route path="/attendance" element={
              <PrivateRoute>
                <Attendance />
              </PrivateRoute>
            } />

            <Route path="/leave" element={
              <PrivateRoute>
                <Leave />
              </PrivateRoute>
            } />

            <Route path="/kpi" element={
              <PrivateRoute>
                <KPI />
              </PrivateRoute>
            } />

            <Route path="/news" element={
              <PrivateRoute>
                <NewsFeed />
              </PrivateRoute>
            } />

            {/* super_admin + hr_manager only */}
            <Route path="/team-analytics" element={
              <PrivateRoute roles={ADMIN_HR}>
                <TeamAnalytics />
              </PrivateRoute>
            } />

            {/* super_admin + hr_manager + admin (migration 39 — read-only for admin, EmployeeList.jsx hides Add/Export-to-edit affordances for that role) */}
            <Route path="/employees" element={
              <PrivateRoute roles={EMPLOYEES_LIST_ROLES}>
                <EmployeeList />
              </PrivateRoute>
            } />

            {/* super_admin + hr_manager only — emp_insert RLS was not extended to 'admin' */}
            <Route path="/employees/new" element={
              <PrivateRoute roles={ADMIN_HR}>
                <EmployeeNew />
              </PrivateRoute>
            } />

            {/* super_admin + hr_manager + department_manager + admin (migration 39 — read-only for admin, EmployeeDetail.jsx hides mutating actions for that role) */}
            <Route path="/employees/:id" element={
              <PrivateRoute roles={ADMIN_HR_MGR}>
                <EmployeeDetail />
              </PrivateRoute>
            } />

            {/* Payroll: all authenticated users see their own payslip; Payroll Run + Summary tabs are role-gated inside the page */}
            <Route path="/payroll" element={
              <PrivateRoute>
                <Payroll />
              </PrivateRoute>
            } />

            {/* Settings: super_admin/hr_manager only (SETTINGS_ROLES, narrowed session 42) — admin/department_manager/read_only/employee all use /profile instead now that My Privacy & Data lives there for every role. The 6 remaining tabs here are each further role-gated inside the page. */}
            <Route path="/settings" element={
              <PrivateRoute roles={SETTINGS_ROLES}>
                <Settings />
              </PrivateRoute>
            } />

            {/* The operator console. Gated on platform ownership, NOT on
                super_admin: a tenant's own super_admin must not reach a list of
                every other company. The database enforces the same rule inside
                platform_company_overview(). */}
            <Route path="/platform" element={
              <PrivateRoute platformOwner>
                <Platform />
              </PrivateRoute>
            } />

            {/* Country packs — reference data every workspace inherits from.
                Declared BEFORE /platform/:companyId, because a dynamic segment
                would otherwise match "countries" and try to load a company by
                that id. React Router prefers the static path regardless of
                order, but relying on that is a footgun for whoever adds the
                next /platform/<word> route. */}
            <Route path="/platform/countries" element={
              <PrivateRoute platformOwner>
                <PlatformCountries />
              </PrivateRoute>
            } />

            {/* BYOND's file on one customer: contacts, contract, payments, action
                plans, support. Same gate — the five tables behind it have
                is_platform_owner as their only policy, so the customer cannot read
                their own row. */}
            <Route path="/platform/:companyId" element={
              <PrivateRoute platformOwner>
                <PlatformCompany />
              </PrivateRoute>
            } />

            {/* Demo requests are platform-level — demo_requests has no company_id
                and its RLS policies require is_platform_owner. This was gated on
                super_admin, which showed the nav item to every tenant owner and
                then handed them a page that could only ever be empty. */}
            <Route path="/leads" element={
              <PrivateRoute platformOwner>
                <Leads />
              </PrivateRoute>
            } />

            {/* Static documentation view of the Access Control Standard's §3
                matrix — no DB calls, no impersonation. super_admin only, same
                as /leads: any tenant super_admin can view their own role
                model, is_platform_owner is not required. */}
            <Route path="/permissions" element={
              <PrivateRoute roles={SUPER_ADMIN}>
                <Permissions />
              </PrivateRoute>
            } />

            <Route path="/documents" element={
              <PrivateRoute roles={DOCUMENTS_ROLES}>
                <Documents />
              </PrivateRoute>
            } />

            {/* Scheduling: super_admin + hr_manager + admin */}
            <Route path="/schedule" element={
              <PrivateRoute roles={SCHEDULE_ROLES}>
                <Schedule />
              </PrivateRoute>
            } />

            <Route path="/schedule/templates" element={
              <PrivateRoute roles={SCHEDULE_ROLES}>
                <ScheduleTemplates />
              </PrivateRoute>
            } />

            {/* All authenticated users — their own published shifts */}
            <Route path="/my-schedule" element={
              <PrivateRoute>
                <MySchedule />
              </PrivateRoute>
            } />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      )}
    </div>
  )
}

export default App
