// Currency comes from company.currency, which self_onboard_company sets from the
// signup country (see web utils/onboarding.js COUNTRY_DEFAULTS).
//
// There is deliberately no default. A missing currency prints a bare number, because
// a figure labelled with the wrong currency is worse than one labelled with none —
// it is a salary that looks like it was quoted in a currency nobody agreed to.
export function money(amount, currency) {
  const n = Number(amount) || 0
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${formatted} ${currency}` : formatted
}

// Local YYYY-MM-DD. Mirrors the web's localDateStr — using toISOString() here
// would shift the date for anyone whose timezone is not UTC, which is most of
// them — the company's own timezone is what decides the working day.
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
