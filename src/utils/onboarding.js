// Shared by Signup.jsx (immediate self-onboard right after signUp()) and
// App.jsx (retries self-onboard on a later authenticated visit, for the
// email-confirmation-required flow where no session exists yet at signup
// time). Both call the same RPC with the same shape, so this is the single
// source of truth for that contract rather than two hand-copies of it.
const PENDING_KEY = 'byond_pending_signup'

export function savePendingSignup({ companyName, fullName, country, currency, timezone }) {
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ companyName, fullName, country, currency, timezone })
  )
}

export function readPendingSignup() {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPendingSignup() {
  localStorage.removeItem(PENDING_KEY)
}

// NEVER call onboard_company() — it's admin-only and revoked from anon/authenticated.
export async function runSelfOnboard(supabase, pending) {
  return supabase.rpc('self_onboard_company', {
    p_company_name: pending.companyName,
    p_full_name: pending.fullName,
    p_country: pending.country,
    p_currency: pending.currency,
    p_timezone: pending.timezone,
  })
}

// self_onboard_company() throws when the caller already belongs to a
// company — exact message text isn't documented, so this matches loosely
// rather than on a specific string.
export function isAlreadyOnboardedError(error) {
  if (!error?.message) return false
  const msg = error.message.toLowerCase()
  return msg.includes('already') && (msg.includes('company') || msg.includes('belong'))
}

export const COUNTRY_DEFAULTS = {
  UAE:     { currency: 'AED', timezone: 'Asia/Dubai' },
  Nigeria: { currency: 'NGN', timezone: 'Africa/Lagos' },
}
