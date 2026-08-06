// Currency comes from company.currency, which self_onboard_company already sets
// from the signup country (AED for UAE, NGN for Nigeria — see web
// utils/onboarding.js COUNTRY_DEFAULTS). The web app hardcodes 'AED' in
// EmployeeNew, EmployeeDetail and Payroll, so an NGN tenant sees the wrong
// symbol everywhere but the payslip PDF. Mobile reads the real value from the
// start.
export function money(amount, currency = 'AED') {
  const n = Number(amount) || 0
  return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
}

// Local YYYY-MM-DD. Mirrors the web's localDateStr — using toISOString() here
// would shift the date for anyone east of UTC, which is every user in both
// target markets (Asia/Dubai, Africa/Lagos).
export function localDateStr(d = new Date()) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

export function timeOfDay(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function shortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function longDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export function greeting(hour = new Date().getHours()) {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function initials(name) {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

export function periodLabel(year, month) {
  if (!year || !month) return '—'
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
