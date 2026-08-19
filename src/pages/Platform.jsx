import { useCallback, useEffect, useState } from 'react'
import { Building2, Users, AlertTriangle, MapPinOff, CircleSlash, Clock } from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonRow } from '../components/Skeleton'

// The operator console. Every tenant on the platform, in one list.
//
// This is the only screen in the app that deliberately looks across companies, and
// everything about it is narrower than the rest of the product on purpose.
//
// It reads exactly one thing: platform_company_overview(), which refuses anyone
// who is not a platform owner and returns only counts and dates — no names, no
// salaries, no national IDs, no emails. So there is no query here to widen and no
// column to accidentally expose. If this page is ever asked to show who somebody
// is, that belongs in the tenant app, which already has the policies for it.
//
// It is also read-only. Suspending or deleting a tenant is a different kind of
// action, and a list you are scanning is the wrong place to put a button that
// erases a company through its cascades.

// A tenant nobody has clocked into for this long has effectively stopped using the
// product. Two weeks rather than a month: a month is long enough that the customer
// has already decided to leave.
const STALE_DAYS = 14

function daysSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(dateStr + 'T00:00:00')
  return Math.floor((Date.now() - then.getTime()) / 86400000)
}

// The whole point of the console: not the numbers, but which numbers need looking
// at. Each one names a consequence, because "0 work locations" means nothing to
// someone who does not already know what it breaks.
function warningsFor(c) {
  const out = []
  const idle = daysSince(c.last_clock_in)

  if (c.owners === 0) {
    out.push({ key: 'no-owner', tone: 'danger', icon: CircleSlash,
      text: 'No owner or HR manager — nobody can administer this company' })
  }
  if (c.last_clock_in === null) {
    out.push({ key: 'never', tone: 'danger', icon: Clock,
      text: 'Never clocked in — onboarding never finished' })
  } else if (idle !== null && idle > STALE_DAYS) {
    out.push({ key: 'idle', tone: 'warn', icon: Clock,
      text: `No attendance for ${idle} days` })
  }
  if (c.work_locations === 0) {
    out.push({ key: 'no-site', tone: 'warn', icon: MapPinOff,
      text: 'No work location — the geofence cannot be enforced and clock-in distance is never recorded' })
  }
  if (c.plan === 'trial' && c.trial_ends_at === null) {
    out.push({ key: 'endless-trial', tone: 'warn', icon: AlertTriangle,
      text: 'On trial with no end date — this trial never expires' })
  }
  if (c.employees_total > 0 && c.login_accounts === 0) {
    out.push({ key: 'no-logins', tone: 'warn', icon: Users,
      text: 'No employee can sign in — records exist but none are linked to an account' })
  }
  return out
}

const TONE = {
  danger: 'text-[#FF4D4D] bg-[#FF4D4D]/10 border-[#FF4D4D]/20',
  warn:   'text-[#FF8C42] bg-[#FF8C42]/10 border-[#FF8C42]/20',
}

const PLAN_BADGE = {
  active: 'bg-[#00D4A0]/10 text-[#00D4A0]',
  trial:  'bg-[#FF8C42]/10 text-[#FF8C42]',
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-4">
      <p className="text-2xl font-bold text-[#1A1A1A] dark:text-white tabular-nums">{value}</p>
      <p className="text-xs font-medium text-[#1A1A1A] dark:text-white mt-1">{label}</p>
      {hint && <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-0.5">{hint}</p>}
    </div>
  )
}

export default function Platform() {
  // null means never loaded — the only state that shows a skeleton, so a refresh
  // does not blank the table you are reading.
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  // Retry bumps this rather than calling the fetch directly. The effect owns the
  // request, so no setState happens synchronously in its body — the shape
  // react-hooks/set-state-in-effect wants, and it costs one less cascading render
  // per mount. Several older pages here call an async loader straight from an
  // effect; that is what most of the lint baseline is.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let cancelled = false

    supabase.rpc('platform_company_overview').then(({ data, error: rpcError }) => {
      if (cancelled) return

      if (rpcError) {
        console.error('[Platform] platform_company_overview failed', rpcError.code, rpcError)
        // The function raises "Not a platform owner" rather than returning an empty
        // set, so this branch can genuinely mean "you are not allowed" — worth
        // saying, because an empty table would read as "no companies exist".
        setError(
          /platform owner/i.test(rpcError.message ?? '')
            ? 'This page is for BYOND platform owners only.'
            : 'Could not load the company list. Please try again.'
        )
        return
      }
      setRows(data ?? [])
      setError('')
    })

    return () => { cancelled = true }
  }, [reloadKey])

  const list = rows ?? []
  const totalEmployees = list.reduce((n, c) => n + (c.employees_total ?? 0), 0)
  const totalLogins = list.reduce((n, c) => n + (c.login_accounts ?? 0), 0)
  const needsAttention = list.filter((c) => warningsFor(c).length > 0).length

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />
      {/* lg:ml-60 is required, not decorative: Sidebar renders `fixed ... w-60`, so
          without the margin the content sits underneath it and the first column is
          unreadable. Every other page does the same. */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Platform</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Every company on BYOND. Counts and activity only — this view holds no
              employee records, salaries or personal data.
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              {error}
              <button onClick={reload} className="shrink-0 font-semibold hover:underline">Retry</button>
            </div>
          )}

          {rows !== null && list.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <Stat label="Companies" value={list.length} />
              <Stat label="Employees" value={totalEmployees} hint="across all tenants" />
              <Stat label="Can sign in" value={totalLogins} hint={`of ${totalEmployees} records`} />
              <Stat label="Need attention" value={needsAttention}
                    hint={needsAttention === 0 ? 'all clear' : 'see flags below'} />
            </div>
          )}

          {/* Hidden entirely when the load failed and nothing has ever arrived.
              Rendering the card here left a bare header row — COMPANY, PLAN,
              EMPLOYEES — sitting under an "access denied" message, which reads as
              a table that happens to be empty rather than a request that was
              refused. */}
          {!(error && rows === null) && (
          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {rows === null && !error ? (
              <div className="p-5 space-y-4 animate-pulse">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <SkeletonRow className="h-3 w-1/4" />
                    <SkeletonRow className="h-2.5 w-1/3" />
                  </div>
                ))}
              </div>
            ) : list.length === 0 && !error ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-14 h-14 rounded-full bg-[#F5F5F0] dark:bg-[#252525] flex items-center justify-center">
                  <Building2 size={24} className="text-[#AAAAAA] dark:text-[#555555]" />
                </div>
                <p className="text-sm font-medium text-[#1A1A1A] dark:text-white">No companies yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                      {['Company', 'Plan', 'Employees', 'Owners', 'Last clock-in', '30-day punches'].map((h) => (
                        <th key={h} className="text-left py-3.5 px-4 first:pl-5 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => {
                      const warnings = warningsFor(c)
                      const idle = daysSince(c.last_clock_in)
                      return (
                        <tr key={c.company_id} className="border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-0 align-top">
                          <td className="py-4 px-5">
                            <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{c.name}</p>
                            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                              {c.country ?? '—'} · {c.currency ?? '—'}
                              {c.created_via ? ` · via ${c.created_via}` : ''}
                            </p>
                            {warnings.length > 0 && (
                              <ul className="mt-2 space-y-1.5">
                                {warnings.map((w) => {
                                  const Icon = w.icon
                                  return (
                                    <li key={w.key}
                                        className={`flex items-start gap-1.5 text-[11px] leading-snug px-2 py-1 rounded border ${TONE[w.tone]}`}>
                                      <Icon size={12} className="shrink-0 mt-0.5" />
                                      <span>{w.text}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </td>

                          <td className="py-4 px-4 whitespace-nowrap">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${PLAN_BADGE[c.plan] ?? 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]'}`}>
                              {c.plan ?? 'unknown'}
                            </span>
                            {c.trial_days_left !== null && c.trial_days_left !== undefined && (
                              <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-1">
                                {c.trial_days_left} days left
                              </p>
                            )}
                          </td>

                          <td className="py-4 px-4 text-sm text-[#1A1A1A] dark:text-white tabular-nums whitespace-nowrap">
                            {c.employees_total}
                            <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0]">
                              {c.employees_active} active
                              {c.employees_invited > 0 && ` · ${c.employees_invited} invited`}
                            </span>
                            <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0]">
                              {c.login_accounts} can sign in
                            </span>
                          </td>

                          <td className={`py-4 px-4 text-sm tabular-nums ${c.owners === 0 ? 'text-[#FF4D4D] font-semibold' : 'text-[#1A1A1A] dark:text-white'}`}>
                            {c.owners}
                          </td>

                          <td className="py-4 px-4 text-sm text-[#1A1A1A] dark:text-white whitespace-nowrap">
                            {c.last_clock_in ?? <span className="text-[#666666] dark:text-[#A0A0A0]">never</span>}
                            {idle !== null && (
                              <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0]">
                                {idle === 0 ? 'today' : `${idle}d ago`}
                              </span>
                            )}
                          </td>

                          <td className="py-4 px-4 text-sm text-[#1A1A1A] dark:text-white tabular-nums">
                            {c.clock_ins_30d}
                            {c.open_leave > 0 && (
                              <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0]">
                                {c.open_leave} leave pending
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          <p className="mt-4 text-xs text-[#666666] dark:text-[#A0A0A0]">
            Read-only. Suspending or removing a company is not done from here —
            deleting a tenant cascades through every employee, punch and payslip it
            owns, which is not a thing to have one tap away from a list.
          </p>
        </main>
      </div>
    </div>
  )
}
