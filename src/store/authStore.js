import { create } from 'zustand'
import supabase from '../services/supabase'
import { sanitizeEmployee } from '../utils/security'
import { createUserSession, endUserSession } from '../services/sessionService'

// Only these employee fields enter the client store — salary/bank/national_id excluded
const SAFE_SELECT =
  'id, user_id, full_name, email, phone, photo_url, job_title, department_id, classification, contract_type, hire_date, status, can_post_feed, emp_code, job_description, departments!employees_department_id_fkey(name)'

const useAuthStore = create((set, get) => ({
  session: null,
  employee: null,     // never contains salary, bank_account, or national_id
  role: null,
  companyId: null,    // tenant scope — sourced from user_roles.company_id
  company: null,       // { id, name, plan, trial_ends_at, created_via, privacy_contact_email } — for TrialBanner + Profile.jsx's Privacy & Data section
  sessionToken: null, // Supabase access token — in memory only, never persisted
  loading: true,

  init: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) await get().loadProfile(session)
    set({ loading: false })

    // Returned so App.jsx can unsubscribe on unmount — StrictMode double-mounts
    // effects in dev, and without unsubscribing here init() ends up registering
    // two listeners, each firing loadProfile() a second time on every auth event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await get().loadProfile(session)
      } else {
        set({ session: null, employee: null, role: null, companyId: null, company: null, sessionToken: null })
      }
    })
    return subscription
  },

  loadProfile: async (session) => {
    const { data: rawEmployee, error: employeeError } = await supabase
      .from('employees')
      .select(SAFE_SELECT)
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (employeeError) {
      console.error('[authStore] employees fetch failed for user_id', session.user.id, employeeError)
    }

    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role, company_id')
      .eq('user_id', session.user.id)
      .maybeSingle()

    if (roleError) {
      console.error('[authStore] user_roles fetch failed for user_id', session.user.id, roleError)
    }
    if (!roleData) {
      console.warn('[authStore] no user_roles row matched user_id', session.user.id, '— companyId will be null')
    }

    // No company yet (e.g. mid-signup, before self_onboard_company has run) — skip the fetch.
    let company = null
    if (roleData?.company_id) {
      const { data: companyData, error: companyError } = await supabase
        .from('company')
        .select('id, name, plan, trial_ends_at, created_via, privacy_contact_email')
        .eq('id', roleData.company_id)
        .maybeSingle()
      if (companyError) {
        console.error('[authStore] company fetch failed for company_id', roleData.company_id, companyError)
      }
      company = companyData ?? null
    }

    // sanitizeEmployee is a belt-and-suspenders guard — SAFE_SELECT already excludes sensitive fields
    set({
      session,
      employee: sanitizeEmployee(rawEmployee) ?? null,
      role: roleData?.role ?? null,
      companyId: roleData?.company_id ?? null,
      company,
      sessionToken: session.access_token,
    })
  },

  // Called after login: registers session in DB
  registerSession: async (accessToken) => {
    await createUserSession(accessToken)
    set({ sessionToken: accessToken })
  },

  signOut: async () => {
    const token = get().sessionToken
    if (token) await endUserSession(token)
    await supabase.auth.signOut()
    set({ session: null, employee: null, role: null, companyId: null, company: null, sessionToken: null })
  },
}))

export default useAuthStore
