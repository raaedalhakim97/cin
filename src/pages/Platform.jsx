import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  Building2, Users, AlertTriangle, MapPinOff, CircleSlash, Clock,
  Plus, ChevronRight, ChevronDown, Copy, Check, Loader2, XCircle, Link2,
} from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonRow } from '../components/Skeleton'
import { COUNTRY_DEFAULTS } from '../utils/onboarding'

// The operator console. Every tenant on the platform, what state it is in, and who
// can administer it.
//
// This is the only screen that deliberately looks across companies, and it is
// narrower than the rest of the product on purpose. It reads three functions, each
// of which refuses anyone who is not a platform owner before reading a row:
//
//   platform_company_overview()   counts and dates, no personal data at all
//   platform_company_access(id)   who administers one company
//   platform_revoke_invite(id)    withdraw a link that was sent by mistake
//
// and writes through one:
//
//   platform_create_company(...)  a new tenant plus an invite for its owner
//
// What it deliberately cannot reach: any company's staff list, salaries, national
// IDs, attendance or KPI. BYOND grants access; the tenant's own owner runs their
// HR. The access panel is the single exception and it is scoped to people holding
// an administrative role — never the whole workforce.

// A tenant nobody has clocked into for this long has effectively stopped using the
// product. Two weeks rather than a month: a month is long enough that the customer
// has already decided to leave.
const STALE_DAYS = 14

function daysSince(dateStr) {
  if (!dateStr) return null
  const then = new Date(dateStr + 'T00:00:00')
  return Math.floor((Date.now() - then.getTime()) / 86400000)
}

// The point of the console: not the numbers, but which numbers need looking at.
// Each one names a consequence, because "0 work locations" means nothing to
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
  if (c.plan === 'trial' && c.trial_days_left !== null && c.trial_days_left <= 14) {
    out.push({ key: 'trial-ending', tone: 'warn', icon: AlertTriangle,
      text: c.trial_days_left === 0
        ? 'Trial has ended — decide whether to convert or suspend'
        : `Trial ends in ${c.trial_days_left} days` })
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
  active:    'bg-[#00D4A0]/10 text-[#00D4A0]',
  trial:     'bg-[#FF8C42]/10 text-[#FF8C42]',
  suspended: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  cancelled: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]',
}

const ROLE_LABEL = {
  super_admin: 'Owner',
  hr_manager:  'HR Manager',
  admin:       'Ops Coordinator',
}

const inputClass =
  'w-full px-3 py-2 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white ' +
  'border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0]'

function Stat({ label, value, hint, tone }) {
  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-4">
      <p className={`text-2xl font-bold tabular-nums ${tone ?? 'text-[#1A1A1A] dark:text-white'}`}>{value}</p>
      <p className="text-xs font-medium text-[#1A1A1A] dark:text-white mt-1">{label}</p>
      {hint && <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-0.5">{hint}</p>}
    </div>
  )
}

// ── The invite link ───────────────────────────────────────────────────────────
// Shown rather than emailed. There is no SMTP on this project yet, and the link is
// the credential: whoever holds it sets the owner's password. So it is displayed
// once, in full, for the operator to send by whatever channel they already use.
function InviteLink({ path, email }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}${path}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused outright (insecure context, permissions
      // policy). The link is rendered as selectable text below regardless, so a
      // failure here costs a convenience rather than the ability to proceed.
      setCopied(false)
    }
  }

  return (
    <div className="rounded-lg border border-[#00D4A0]/30 bg-[#00D4A0]/[0.06] p-4">
      <div className="flex items-start gap-2">
        <Link2 size={15} className="text-[#00A57D] dark:text-[#00D4A0] shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
            Send this link to {email}
          </p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
            They set their own password on it and become the owner of this company.
            It expires in 7 days, and it is the only thing needed — no email is sent.
          </p>
          <code className="block mt-2 px-2 py-1.5 rounded bg-white dark:bg-[#0F0F0F] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[11px] break-all text-[#1A1A1A] dark:text-white">
            {url}
          </code>
          <button
            onClick={copy}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Provisioning a company ────────────────────────────────────────────────────
function NewCompany({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    company: '', ownerName: '', ownerEmail: '', country: 'UAE', trialMonths: 3,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    // Currency and timezone follow the country rather than being asked for
    // separately — same table Signup uses, so a company created here and one that
    // signed itself up get identical defaults.
    const d = COUNTRY_DEFAULTS[form.country] ?? COUNTRY_DEFAULTS.UAE

    const { data, error: rpcError } = await supabase.rpc('platform_create_company', {
      p_company_name:  form.company,
      p_ceo_full_name: form.ownerName,
      p_ceo_email:     form.ownerEmail,
      p_country:       form.country,
      p_currency:      d.currency,
      p_timezone:      d.timezone,
      p_trial_months:  Number(form.trialMonths),
    })
    setBusy(false)

    if (rpcError) {
      console.error('[Platform] platform_create_company failed', rpcError.code, rpcError)
      // The function's own exceptions are written for this screen — "That email
      // already administers a company on BYOND", "An invite is already pending" —
      // so they are shown as-is rather than replaced with something vaguer.
      setError(rpcError.message || 'Could not create the company.')
      return
    }

    setResult(data)
    setForm({ company: '', ownerName: '', ownerEmail: '', country: 'UAE', trialMonths: 3 })
    onCreated()
  }

  if (result) {
    return (
      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-5 mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
              {result.company_name} created
            </h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
              On {result.plan}. Departments and default document types are already set up.
            </p>
          </div>
          <button
            onClick={() => { setResult(null); setOpen(false) }}
            className="text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:underline shrink-0"
          >
            Done
          </button>
        </div>
        <InviteLink path={result.invite_path} email={result.owner_email} />
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors"
      >
        <Plus size={16} /> New company
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">New company</h2>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
            Creates the company and one invite for its owner. They hire their own
            staff from there — you do not add employees for them.
          </p>
        </div>
        <button type="button" onClick={() => { setOpen(false); setError('') }}
                className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white shrink-0"
                aria-label="Cancel">
          <XCircle size={18} />
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Company name</span>
          <input required value={form.company} onChange={set('company')}
                 placeholder="Al Noor Trading LLC" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Owner's full name</span>
          <input required value={form.ownerName} onChange={set('ownerName')}
                 placeholder="Fatima Al Noor" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Owner's email</span>
          <input required type="email" value={form.ownerEmail} onChange={set('ownerEmail')}
                 placeholder="ceo@company.com" className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Country</span>
          <select value={form.country} onChange={set('country')} className={inputClass}>
            {Object.keys(COUNTRY_DEFAULTS).map((c) => (
              <option key={c} value={c}>
                {c} · {COUNTRY_DEFAULTS[c].currency}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Trial</span>
          <select value={form.trialMonths} onChange={set('trialMonths')} className={inputClass}>
            <option value={3}>3 months</option>
            <option value={1}>1 month</option>
            <option value={6}>6 months</option>
            <option value={0}>No trial — paid from day one</option>
          </select>
        </label>
      </div>

      {error && (
        <p className="mt-3 px-3 py-2 rounded-lg text-xs text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors">
        {busy && <Loader2 size={15} className="animate-spin" />}
        {busy ? 'Creating…' : 'Create company and invite the owner'}
      </button>
    </form>
  )
}

// ── Who can administer one company ───────────────────────────────────────────
function AccessPanel({ companyId, onChanged }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [revoking, setRevoking] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('platform_company_access', { p_company_id: companyId })
      .then(({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError) {
          console.error('[Platform] platform_company_access failed', rpcError.code, rpcError)
          setError('Could not load who administers this company.')
          return
        }
        setRows(data ?? [])
        setError('')
      })
    return () => { cancelled = true }
  }, [companyId, reloadKey])

  async function revoke(inviteId) {
    setRevoking(inviteId)
    const { error: rpcError } = await supabase.rpc('platform_revoke_invite', { p_invite_id: inviteId })
    setRevoking(null)
    if (rpcError) {
      console.error('[Platform] platform_revoke_invite failed', rpcError.code, rpcError)
      setError(rpcError.message || 'Could not revoke that invite.')
      return
    }
    setReloadKey((k) => k + 1)
    onChanged()
  }

  if (rows === null && !error) {
    return <div className="px-5 py-4"><SkeletonRow className="h-3 w-1/3" /></div>
  }

  return (
    <div className="px-5 py-4 bg-[#F5F5F0]/60 dark:bg-[#0F0F0F]/60">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0] mb-2">
        Who can administer this company
      </p>

      {error && (
        <p className="mb-2 text-xs text-[#FF4D4D]">{error}</p>
      )}

      {rows && rows.length === 0 ? (
        <p className="text-xs text-[#FF4D4D]">
          Nobody. This company cannot be administered until someone is invited as its owner.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {(rows ?? []).map((r) => (
            <li key={(r.invite_id ?? 'active') + r.email}
                className="flex items-center gap-2 flex-wrap text-xs">
              <span className={`px-1.5 py-0.5 rounded font-semibold ${
                r.kind === 'pending'
                  ? 'bg-[#FF8C42]/10 text-[#FF8C42]'
                  : 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]'
              }`}>
                {r.kind === 'pending' ? 'Invited' : 'Active'}
              </span>
              <span className="font-medium text-[#1A1A1A] dark:text-white">
                {ROLE_LABEL[r.role] ?? r.role}
              </span>
              <span className="text-[#666666] dark:text-[#A0A0A0]">
                {r.full_name ?? '—'} · {r.email}
              </span>
              {r.invite_id && (
                <button
                  onClick={() => revoke(r.invite_id)}
                  disabled={revoking === r.invite_id}
                  className="ml-auto font-semibold text-[#FF4D4D] hover:underline disabled:opacity-50"
                >
                  {revoking === r.invite_id ? 'Revoking…' : 'Revoke invite'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Platform() {
  // null means never loaded — the only state that shows a skeleton, so a refresh
  // does not blank the table you are reading.
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(null)

  // Retry and post-write refresh bump this rather than calling the fetch directly,
  // so no setState happens synchronously in the effect body.
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

  const raw = rows ?? []
  const totalEmployees = raw.reduce((n, c) => n + (c.employees_total ?? 0), 0)
  const totalLogins = raw.reduce((n, c) => n + (c.login_accounts ?? 0), 0)
  const needsAttention = raw.filter((c) => warningsFor(c).length > 0).length

  // Companies needing help float to the top, worst first. A list sorted by name is
  // fine at two tenants and useless at thirty — the whole reason to open this page
  // is to find the ones in trouble, so the page should not make you hunt for them.
  const list = [...raw].sort((a, b) => {
    const wa = warningsFor(a)
    const wb = warningsFor(b)
    const sev = (w) => w.filter((x) => x.tone === 'danger').length * 10 + w.length
    return sev(wb) - sev(wa) || a.name.localeCompare(b.name)
  })

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />
      {/* lg:ml-60 is required, not decorative: Sidebar renders `fixed ... w-60`, so
          without the margin the content sits underneath it and the first column is
          unreadable. Every other page does the same. */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Platform</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Every company on BYOND, which ones need help, and who can administer
              them. No staff lists, salaries, attendance or KPI — only the people who
              hold an admin role at each company.
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              {error}
              <button onClick={reload} className="shrink-0 font-semibold hover:underline">Retry</button>
            </div>
          )}

          {!(error && rows === null) && <NewCompany onCreated={reload} />}

          {rows !== null && list.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <Stat label="Companies" value={list.length} />
              <Stat label="Employees" value={totalEmployees} hint="across all tenants" />
              <Stat label="Can sign in" value={totalLogins} hint={`of ${totalEmployees} records`} />
              <Stat label="Need help" value={needsAttention}
                    tone={needsAttention > 0 ? 'text-[#FF8C42]' : undefined}
                    hint={needsAttention === 0 ? 'all clear' : 'listed first below'} />
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
            ) : list.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <div className="w-14 h-14 rounded-full bg-[#F5F5F0] dark:bg-[#252525] flex items-center justify-center">
                  <Building2 size={24} className="text-[#AAAAAA] dark:text-[#555555]" />
                </div>
                <p className="text-sm font-medium text-[#1A1A1A] dark:text-white">No companies yet</p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Create the first one above</p>
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
                      const isOpen = expanded === c.company_id
                      return (
                        // Keyed on the Fragment, not on the rows inside it. A bare
                        // <> cannot take a key, so React would warn about a list
                        // child missing one and lose row identity across re-sorts.
                        <Fragment key={c.company_id}>
                          <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A] align-top">
                            <td className="py-4 px-5">
                              <button
                                onClick={() => setExpanded(isOpen ? null : c.company_id)}
                                className="flex items-start gap-1.5 text-left group"
                                aria-expanded={isOpen}
                              >
                                {isOpen
                                  ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-[#666666] dark:text-[#A0A0A0]" />
                                  : <ChevronRight size={15} className="mt-0.5 shrink-0 text-[#666666] dark:text-[#A0A0A0]" />}
                                <span>
                                  <span className="block text-sm font-semibold text-[#1A1A1A] dark:text-white group-hover:text-[#00A57D] dark:group-hover:text-[#00D4A0]">
                                    {c.name}
                                  </span>
                                  <span className="block text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                                    {c.country ?? '—'} · {c.currency ?? '—'}
                                    {c.created_via ? ` · via ${c.created_via}` : ''}
                                  </span>
                                </span>
                              </button>

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
                              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${PLAN_BADGE[c.plan] ?? PLAN_BADGE.cancelled}`}>
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

                          {isOpen && (
                            <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                              <td colSpan={6} className="p-0">
                                <AccessPanel companyId={c.company_id} onChanged={reload} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          <p className="mt-4 text-xs text-[#666666] dark:text-[#A0A0A0]">
            Suspending or removing a company is not done from here — deleting a tenant
            cascades through every employee, punch and payslip it owns, which is not a
            thing to have one tap away from a list.
          </p>
        </main>
      </div>
    </div>
  )
}
