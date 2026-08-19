import { create } from 'zustand'
import supabase from '../lib/supabase'
import { capabilities, secondMode } from '../lib/permissions'
import useNotificationStore from './notificationStore'

// Same discipline as the web authStore: salary, bank_account and national_id are
// never selected into the client. On mobile this matters more, not less — the
// employee app has no legitimate reason to hold another person's pay data, and
// an explicit column list is the only thing that keeps it off the device.
const SAFE_SELECT =
  'id, user_id, full_name, email, phone, photo_url, job_title, department_id, ' +
  'classification, contract_type, hire_date, status, can_post_feed, emp_code, ' +
  'departments!employees_department_id_fkey(name)'

// Which roles get which surface is decided by the access-control standard, not
// by a list kept here — see lib/permissions.js secondMode().

// Capabilities are stored, not computed in a selector. capabilities() builds a
// fresh object each call, and zustand compares selector results by reference —
// selecting `s.can()` therefore re-rendered forever (React error #185). Keeping
// the object in state gives every screen a stable reference.
const useAuthStore = create((set, get) => ({
  session: null,
  employee: null,
  role: null,
  companyId: null,
  company: null,
  loading: true,
  caps: capabilities(null),
  second: null,

  init: async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (session) await get().loadProfile(session)
    set({ loading: false })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (next) await get().loadProfile(next)
      else {
        // Also the path taken when a refresh token expires, not just an explicit
        // sign-out, so the badge has to be cleared here too.
        useNotificationStore.getState().reset()
        set({ session: null, employee: null, role: null, companyId: null, company: null })
      }
    })
    return subscription
  },

  loadProfile: async (session) => {
    const [{ data: employee }, { data: roleRow }] = await Promise.all([
      supabase.from('employees').select(SAFE_SELECT).eq('user_id', session.user.id).maybeSingle(),
      supabase.from('user_roles').select('role, company_id').eq('user_id', session.user.id).maybeSingle(),
    ])

    let company = null
    if (roleRow?.company_id) {
      const { data } = await supabase
        .from('company')
        .select('id, name, plan, currency, trial_ends_at, manager_salary_visibility, work_start_time')
        .eq('id', roleRow.company_id)
        .maybeSingle()
      company = data ?? null
    }

    const role = roleRow?.role ?? null
    set({
      session,
      employee: employee ?? null,
      role,
      companyId: roleRow?.company_id ?? null,
      company,
      // Recomputed here, once per profile load, so screens can select a stable
      // object. Salary visibility is folded in so callers never have to remember
      // that department_manager's payroll access is toggle-gated (§4.7).
      caps: capabilities(role, { managerSalaryVisibility: !!company?.manager_salary_visibility }),
      second: secondMode(role),
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    // Otherwise the previous user's unread count stays on the bell until the next
    // successful refresh — and on a shared phone that is someone else's number.
    useNotificationStore.getState().reset()
    set({
      session: null,
      employee: null,
      role: null,
      companyId: null,
      company: null,
      caps: capabilities(null),
      second: null,
    })
  },

  // Retained for callers that only need to know a team surface exists.
  isManager: () => get().second === 'manager',
}))

export default useAuthStore
