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
// Keyed by ISO 3166-1 alpha-2 since migration 34. company.country is now that code,
// NOT NULL, with a foreign key to country_rules — so "UAE", "uae" and "United Arab
// Emirates" are no longer three different countries. The label lives in `name` and is
// display text only; the key is the only thing that ever reaches the database.
//
// This list must stay in step with country_rules. If it drifts, the foreign key rejects
// the insert outright rather than filing the company under the wrong country, so the
// failure is loud — but it is still a failure, so add countries in both places.
export const COUNTRY_DEFAULTS = {
  AE: { name: 'United Arab Emirates', currency: 'AED', timezone: 'Asia/Dubai' },
  SA: { name: 'Saudi Arabia',         currency: 'SAR', timezone: 'Asia/Riyadh' },
  QA: { name: 'Qatar',                currency: 'QAR', timezone: 'Asia/Qatar' },
  KW: { name: 'Kuwait',               currency: 'KWD', timezone: 'Asia/Kuwait' },
  BH: { name: 'Bahrain',              currency: 'BHD', timezone: 'Asia/Bahrain' },
  OM: { name: 'Oman',                 currency: 'OMR', timezone: 'Asia/Muscat' },
  JO: { name: 'Jordan',               currency: 'JOD', timezone: 'Asia/Amman' },
  EG: { name: 'Egypt',                currency: 'EGP', timezone: 'Africa/Cairo' },
  NG: { name: 'Nigeria',              currency: 'NGN', timezone: 'Africa/Lagos' },
  KE: { name: 'Kenya',                currency: 'KES', timezone: 'Africa/Nairobi' },
  IN: { name: 'India',                currency: 'INR', timezone: 'Asia/Kolkata' },
  PK: { name: 'Pakistan',             currency: 'PKR', timezone: 'Asia/Karachi' },
  GB: { name: 'United Kingdom',       currency: 'GBP', timezone: 'Europe/London' },
}

// One place for both selects to read, so adding a country is one edit and neither
// screen can drift from the other. Deliberately NOT sorted alphabetically — a select
// with no chosen value shows its first option, and the UAE being first is worth more
// to the people signing up today than tidy ordering.
export const COUNTRY_OPTIONS = Object.entries(COUNTRY_DEFAULTS)
  .map(([code, { name }]) => ({ code, name }))

// Currency and timezone for a country code, or null if we do not know it. Returns null
// rather than falling back to the UAE: a country we cannot price is a bug to surface,
// not a Kenyan company quietly invoiced in dirhams.
export function countryDefaultsFor(code) {
  return COUNTRY_DEFAULTS[code] ?? null
}

// Display name for a stored country code. company.country holds 'AE'; a payslip has to
// say "United Arab Emirates". Falls back to the code itself, because an operator can add
// a country under Platform > Countries that this list has never heard of — showing 'ZA'
// is honest, and better than a blank where the country should be.
export function countryNameFor(code) {
  if (!code) return null
  return COUNTRY_DEFAULTS[code]?.name ?? code
}
