import { create } from 'zustand'
import supabase from '../lib/supabase'

// Same discipline as the web authStore: salary, bank_account and national_id are
// never selected into the client. On mobile this matters more, not less — the
// employee app has no legitimate reason to hold another person's pay data, and
// an explicit column list is the only thing that keeps it off the device.
const SAFE_SELECT =
  'id, user_id, full_name, email, phone, photo_url, job_title, department_id, ' +
  'classification, contract_type, hire_date, status, can_post_feed, emp_code, ' +
  'departments!employees_department_id_fkey(name)'

// Roles that see the manager surface (leave approvals + team attendance).
// Mirrors the web's leave-approval gating: department_manager approves step 1,
// hr_manager/super_admin approve final.
export const MANAGER_ROLES = ['super_admin', 'hr_manager', 'department_manager']

const useAuthStore = create((set, get) => ({
  session: null,
  employee: null,
  role: null,
  companyId: null,
  company: null,
  loading: true,

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
      else set({ session: null, employee: null, role: null, companyId: null, company: null })
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
        .select('id, name, plan, currency, trial_ends_at')
        .eq('id', roleRow.company_id)
        .maybeSingle()
      company = data ?? null
    }

    set({
      session,
      employee: employee ?? null,
      role: roleRow?.role ?? null,
      companyId: roleRow?.company_id ?? null,
      company,
    })
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, employee: null, role: null, companyId: null, company: null })
  },

  isManager: () => MANAGER_ROLES.includes(get().role),
}))

export default useAuthStore
