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
  // Platform ownership is NOT a role — it is a separate flag on the same row, and
  // the two answer different questions. role says what you may do inside one
  // company; isPlatformOwner says whether you may see the list of companies at
  // all. A tenant's super_admin is not a platform owner, which is exactly the
  // distinction the operator console depends on.
  isPlatformOwner: false,
  company: null,       // { id, name, plan, trial_ends_at, created_via, privacy_contact_email, currency, timezone, country } — for TrialBanner, Profile.jsx's Privacy & Data section, and money/time formatting
  // The country pack for company.country: { code, name, currency, default_timezone,
  // weekend_days, payment_file, identity_label, permit_label, verified }. This is what
  // lets a screen say "Emirates ID" in Dubai and "National ID" in Lagos off one field,
  // and what tells the dashboard not to ask a Nigerian company for a MOHRE number.
  // Null when the company has no country pack on file — treat that as "no local
  // vocabulary known" and fall back to generic wording, never to the UAE's.
  countryRules: null,
  // Set only when the ordinary queries came back with nothing — see loadProfile.
  // It is the one thing a suspended workspace can still read about itself:
  // { company_id, company_name, plan, plan_note, plan_changed_at, role, employee_id, platform_owner }
  workspace: null,
  suspended: false,
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
        set({ session: null, employee: null, role: null, companyId: null, company: null, countryRules: null, workspace: null, suspended: false, sessionToken: null, isPlatformOwner: false })
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
      .select('role, company_id, is_platform_owner')
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
        // currency and timezone are here because they are formatting inputs the
        // whole app needs: without currency in the store, every salary figure
        // fell back to a hardcoded 'AED', which is wrong for any tenant that
        // is not in that one country.
        .select('id, name, plan, trial_ends_at, created_via, privacy_contact_email, currency, timezone, country')
        .eq('id', roleData.company_id)
        .maybeSingle()
      if (companyError) {
        console.error('[authStore] company fetch failed for company_id', roleData.company_id, companyError)
      }
      company = companyData ?? null
    }

    // The country pack for whatever country this company is in. Migration 31 put
    // identity_label, permit_label and payment_file here precisely so screens could stop
    // saying "Emirates ID" and "MOL Establishment ID" to companies that have neither, and
    // until now nothing read them.
    //
    // A separate query rather than a PostgREST embed on the company row above. The embed
    // would save a round trip, but if the relationship hint were ever wrong the whole
    // company fetch fails and nobody can sign in. This can fail on its own and cost only
    // the labels.
    let countryRules = null
    if (company?.country) {
      const { data: cr, error: crError } = await supabase
        .from('country_rules')
        .select('code, name, currency, default_timezone, weekend_days, payment_file, identity_label, permit_label, verified')
        .eq('code', company.country)
        .maybeSingle()
      if (crError) {
        console.error('[authStore] country_rules fetch failed for code', company.country, crError)
      }
      countryRules = cr ?? null
    }

    // A missing user_roles row used to have one meaning — "this login was never
    // linked to an employee record". Since migration 25 it has two, because
    // roles_select is scoped by get_user_company_id and that helper returns NULL
    // once the company's plan stops granting access. So a suspended workspace and
    // an unlinked account look identical from here: no role, no company, an app
    // full of empty pages and no reason given.
    //
    // my_workspace() is the one reader that answers while the gate is shut — it
    // reads user_roles and company directly and reports only the caller's own row.
    // Called only on this branch: an ordinary login does not pay for it.
    let workspace = null
    if (!roleData) {
      const { data: ws, error: wsError } = await supabase.rpc('my_workspace')
      if (wsError) {
        console.error('[authStore] my_workspace failed for user_id', session.user.id, wsError)
      }
      // RETURNS TABLE arrives as an array; no row means the account really is
      // attached to nothing.
      workspace = (Array.isArray(ws) ? ws[0] : ws) ?? null
    }

    // Ownership can arrive from either reader. It has to: BYOND's own workspace is
    // a company row like any other, and if it were ever suspended the platform
    // owners would lose the user_roles read that tells them they are owners —
    // locking them out of the console that is the only place to undo it.
    const platformOwner = roleData?.is_platform_owner === true || workspace?.platform_owner === true

    // Mirrors get_user_company_id's JOIN exactly. Kept as a list of what grants
    // access rather than a list of what blocks it, so a plan added later is denied
    // by default in both places instead of silently allowed in one.
    const suspended = workspace != null && !platformOwner
      && !['trial', 'active'].includes(workspace.plan)

    // sanitizeEmployee is a belt-and-suspenders guard — SAFE_SELECT already excludes sensitive fields
    set({
      session,
      employee: sanitizeEmployee(rawEmployee) ?? null,
      role: roleData?.role ?? null,
      companyId: roleData?.company_id ?? null,
      // Defaults to false on a missing row rather than undefined: the console's
      // gate reads this, and an absent flag must mean "no" and never "maybe".
      isPlatformOwner: platformOwner,
      company,
      countryRules,
      workspace,
      suspended,
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
    set({ session: null, employee: null, role: null, companyId: null, company: null, countryRules: null, workspace: null, suspended: false, sessionToken: null, isPlatformOwner: false })
  },
}))

export default useAuthStore
