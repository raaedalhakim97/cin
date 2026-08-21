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

// Currency and timezone a workspace starts with, by country. Both are only defaults —
// Settings can change either, and every screen reads the company's own values rather
// than assuming these.
//
// The list used to hold two entries, and everything that missed fell back to the UAE.
// That is the shape of assumption this product is removing: a Kenyan company should not
// have to notice that its salaries were labelled in dirhams.
//
// Country is stored as the label, not a code, because that is what existing rows hold.
// Moving to ISO 3166 alpha-2 is the right end state — "UAE", "uae" and "United Arab
// Emirates" are three different countries to a text column — and is tracked separately.
export const COUNTRY_DEFAULTS = {
  UAE:            { currency: 'AED', timezone: 'Asia/Dubai' },
  'Saudi Arabia': { currency: 'SAR', timezone: 'Asia/Riyadh' },
  Qatar:          { currency: 'QAR', timezone: 'Asia/Qatar' },
  Kuwait:         { currency: 'KWD', timezone: 'Asia/Kuwait' },
  Bahrain:        { currency: 'BHD', timezone: 'Asia/Bahrain' },
  Oman:           { currency: 'OMR', timezone: 'Asia/Muscat' },
  Jordan:         { currency: 'JOD', timezone: 'Asia/Amman' },
  Egypt:          { currency: 'EGP', timezone: 'Africa/Cairo' },
  Nigeria:        { currency: 'NGN', timezone: 'Africa/Lagos' },
  Kenya:          { currency: 'KES', timezone: 'Africa/Nairobi' },
  India:          { currency: 'INR', timezone: 'Asia/Kolkata' },
  Pakistan:       { currency: 'PKR', timezone: 'Asia/Karachi' },
  'United Kingdom': { currency: 'GBP', timezone: 'Europe/London' },
}

// One place for both selects to read, so adding a country is one edit and neither
// screen can drift from the other.
export const COUNTRY_OPTIONS = Object.keys(COUNTRY_DEFAULTS)
