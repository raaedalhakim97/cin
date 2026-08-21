import { useCallback, useEffect, useState } from 'react'
import { Globe2, Plus, Scale, ShieldCheck, AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonRow } from '../components/Skeleton'

// Country packs — the reference data a new workspace inherits.
//
// This is BYOND's data about the world, not a tenant's data about itself, which is why
// it lives on /platform and why RLS lets every signed-in user read it but only a
// platform owner write it. A company that could edit the law it is measured against
// could quietly lower its own floor.
//
// The whole feature has one rule, and this page exists mostly to enforce it in the one
// place a human types: a country pack must never guess. Two things follow from that and
// are deliberately not "improved" away:
//
//   1. `legal_reference` is required on every leave rule. Not "recommended" — the form
//      will not submit without it. A number with a citation can be checked by whoever
//      reads it next; a number without one gets believed.
//
//   2. `verified` defaults to false and seeds nothing. An unverified country is not a
//      broken country — it is an honest one, and its companies are told to set their own
//      policy rather than handed an entitlement nobody sourced.

const LEAVE_TYPES = [
  'annual', 'sick', 'emergency', 'marriage',
  'paternity', 'maternity', 'hajj', 'bereavement', 'study',
]

const ACCRUALS = [
  { value: 'annual',    label: 'Annual — full entitlement once eligible' },
  { value: 'monthly',   label: 'Monthly — accrues with service' },
  { value: 'per_event', label: 'Per event — granted when it happens, no balance' },
]

const PAYMENT_FILES = [
  { value: 'none',        label: 'Generic CSV — no regulated format' },
  { value: 'uae_wps_sif', label: 'UAE WPS SIF' },
]

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const input =
  'w-full px-3 py-2 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white ' +
  'border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0]'

function Section({ icon: Icon, title, subtitle, action, children }) {
  return (
    <section className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-start gap-2.5 min-w-0">
          <Icon size={16} className="text-[#00A57D] dark:text-[#00D4A0] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#1A1A1A] dark:text-white">{title}</h2>
            {subtitle && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function PlatformCountries() {
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [openCode, setOpenCode] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('country_rules').select('*').order('name'),
      supabase.from('country_leave_rules').select('*').order('country_code').order('leave_type'),
      supabase.from('company').select('id, name, country'),
    ]).then(([countries, rules, companies]) => {
      if (cancelled) return
      const firstError = [countries, rules, companies].find((r) => r.error)
      if (firstError) {
        console.error('[PlatformCountries] load failed', firstError.error)
        setError('Could not load country packs. Please try again.')
        return
      }
      setState({
        countries: countries.data ?? [],
        rules: rules.data ?? [],
        companies: companies.data ?? [],
      })
      setError('')
    })
    return () => { cancelled = true }
  }, [reloadKey])

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Country packs</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-2xl">
              What a workspace inherits from the country it operates in. A company is seeded
              from its country when it is created, and then owns its policy — the law is the
              floor, not the value.
            </p>
          </div>

          {error && (
            <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg text-sm text-[#FF4D4D] bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              {error}
              <button onClick={reload} className="shrink-0 font-semibold hover:underline">Retry</button>
            </div>
          )}

          {state === null && !error ? (
            <div className="space-y-3">
              <SkeletonRow className="h-6 w-1/3" />
              <SkeletonRow className="h-3 w-1/4" />
            </div>
          ) : state ? (
            <div className="space-y-5">
              <Section
                icon={Globe2}
                title="Countries on file"
                subtitle="Only a verified pack seeds anything. An unverified country is honest, not broken — its companies set their own policy."
                action={
                  <button
                    onClick={() => setAdding((a) => !a)}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline"
                  >
                    <Plus size={13} /> {adding ? 'Cancel' : 'Add country'}
                  </button>
                }
              >
                {adding && <NewCountry onDone={() => { setAdding(false); reload() }} />}
                <CountryTable
                  countries={state.countries}
                  rules={state.rules}
                  companies={state.companies}
                  openCode={openCode}
                  onToggle={(code) => setOpenCode((c) => (c === code ? null : code))}
                  onChanged={reload}
                />
              </Section>

              {openCode && (
                <LeaveRules
                  country={state.countries.find((c) => c.code === openCode)}
                  rules={state.rules.filter((r) => r.country_code === openCode)}
                  onChanged={reload}
                />
              )}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}

function CountryTable({ countries, rules, companies, openCode, onToggle, onChanged }) {
  if (countries.length === 0) {
    return (
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
        No countries yet. Until one exists and is verified, every new company starts with no
        leave policy and HR sets it by hand.
      </p>
    )
  }

  async function toggleVerified(c) {
    const { error } = await supabase.from('country_rules')
      .update({ verified: !c.verified }).eq('code', c.code)
    if (error) console.error('[PlatformCountries] verify toggle failed', error)
    onChanged()
  }

  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-sm min-w-[46rem]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0] border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            <th className="py-2 pr-4 font-semibold">Country</th>
            <th className="py-2 pr-4 font-semibold">Money &amp; time</th>
            <th className="py-2 pr-4 font-semibold">Weekend</th>
            <th className="py-2 pr-4 font-semibold">Salary file</th>
            <th className="py-2 pr-4 font-semibold">Leave rules</th>
            <th className="py-2 pr-4 font-semibold">Companies</th>
            <th className="py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {countries.map((c) => {
            const ruleCount = rules.filter((r) => r.country_code === c.code).length
            const using = companies.filter(
              (co) => (co.country ?? '').toLowerCase() === c.name.toLowerCase()
                   || (co.country ?? '').toUpperCase() === c.code
                   || (c.code === 'AE' && /^(uae|u\.a\.e\.?|ae|united arab emirates)$/i.test(co.country ?? ''))
            ).length
            const isOpen = openCode === c.code
            return (
              <tr key={c.code}
                  className={`border-b border-[#E8E8E8] dark:border-[#2A2A2A] align-top ${
                    isOpen ? 'bg-[#00D4A0]/[0.06]' : ''}`}>
                <td className="py-3 pr-4">
                  <button
                    onClick={() => onToggle(c.code)}
                    aria-expanded={isOpen}
                    className={`text-left font-semibold hover:underline ${
                      isOpen
                        ? 'text-[#00A57D] dark:text-[#00D4A0]'
                        : 'text-[#1A1A1A] dark:text-white hover:text-[#00A57D] dark:hover:text-[#00D4A0]'}`}
                  >
                    {c.name}
                  </button>
                  <span className="block text-[11px] font-mono text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                    {c.code} · {c.identity_label} · {c.permit_label}
                  </span>
                </td>
                <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0]">
                  {c.currency}<br />
                  <span className="text-xs">{c.default_timezone}</span>
                </td>
                <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0] text-xs">
                  {(c.weekend_days ?? []).map((d) => DAY_NAMES[d]).join(' + ') || '—'}
                </td>
                <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0] text-xs">
                  {PAYMENT_FILES.find((p) => p.value === c.payment_file)?.label ?? c.payment_file}
                </td>
                <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0]">
                  {ruleCount === 0
                    ? <span className="text-[#FF8C42]">none</span>
                    : `${ruleCount} type${ruleCount === 1 ? '' : 's'}`}
                </td>
                <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0]">{using}</td>
                <td className="py-3">
                  <button
                    onClick={() => toggleVerified(c)}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold ${
                      c.verified
                        ? 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]'
                        : 'bg-[#FF8C42]/10 text-[#FF8C42]'
                    }`}
                    title={c.verified
                      ? 'Verified — new companies here inherit these rules'
                      : 'Unverified — new companies here inherit nothing'}
                  >
                    {c.verified ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
                    {c.verified ? 'Verified' : 'Unverified'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-4">
        Click a country to edit its leave rules. Marking one verified is what makes new
        companies inherit it — so mark it verified when someone has read the statute, not
        when the row looks full.
      </p>
    </div>
  )
}

function NewCountry({ onDone }) {
  const [f, setF] = useState({
    code: '', name: '', currency: '', default_timezone: '',
    payment_file: 'none', identity_label: 'National ID', permit_label: 'Work permit',
    weekend: '5,6', verified_note: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const weekend_days = f.weekend.split(',').map((d) => parseInt(d.trim(), 10)).filter((d) => d >= 0 && d <= 6)
    const { error } = await supabase.from('country_rules').insert({
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      currency: f.currency.trim().toUpperCase(),
      default_timezone: f.default_timezone.trim(),
      payment_file: f.payment_file,
      identity_label: f.identity_label.trim() || 'National ID',
      permit_label: f.permit_label.trim() || 'Work permit',
      weekend_days,
      // Always false on creation. Verifying is a separate, deliberate act — see the note
      // on the button. A country that arrives verified is a country nobody checked.
      verified: false,
      verified_note: f.verified_note.trim() || null,
    })
    setBusy(false)
    if (error) { console.error('[NewCountry] insert failed', error); setErr(error.message); return }
    onDone()
  }

  return (
    <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 mb-6 pb-6 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">ISO code</span>
        <input required maxLength={2} className={input} placeholder="SA" value={f.code} onChange={set('code')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Name</span>
        <input required className={input} placeholder="Saudi Arabia" value={f.name} onChange={set('name')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Currency</span>
        <input required maxLength={3} className={input} placeholder="SAR" value={f.currency} onChange={set('currency')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Default timezone</span>
        <input required className={input} placeholder="Asia/Riyadh" value={f.default_timezone} onChange={set('default_timezone')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Weekend days</span>
        <input className={input} placeholder="5,6" value={f.weekend} onChange={set('weekend')} />
        <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-1">0 = Sunday … 6 = Saturday. Leave arithmetic depends on this.</span>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Salary transfer file</span>
        <select className={input} value={f.payment_file} onChange={set('payment_file')}>
          {PAYMENT_FILES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Identity document is called</span>
        <input className={input} placeholder="National ID" value={f.identity_label} onChange={set('identity_label')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Work permit is called</span>
        <input className={input} placeholder="Work permit" value={f.permit_label} onChange={set('permit_label')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Which law this pack follows</span>
        <input className={input} placeholder="e.g. Saudi Labour Law, Royal Decree M/51" value={f.verified_note} onChange={set('verified_note')} />
      </label>

      {err && <p className="sm:col-span-2 text-xs text-[#FF4D4D]">{err}</p>}

      <div className="sm:col-span-2 flex items-center gap-3">
        <button disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#0F0F0F] bg-[#00D4A0] hover:bg-[#00C090] disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Add country
        </button>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          Added unverified. Add its leave rules, then mark it verified — that is what makes
          new companies inherit it.
        </span>
      </div>
    </form>
  )
}

function LeaveRules({ country, rules, onChanged }) {
  const [open, setOpen] = useState(false)
  if (!country) return null

  return (
    <Section
      icon={Scale}
      title={`${country.name} — leave the law entitles people to`}
      subtitle="Every rule needs a citation. A number with one can be checked by whoever reads it next; a number without one gets believed."
      action={
        <button
          onClick={() => setOpen((o) => !o)}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline"
        >
          <Plus size={13} /> {open ? 'Cancel' : 'Add leave rule'}
        </button>
      }
    >
      {open && <NewRule country={country} existing={rules} onDone={() => { setOpen(false); onChanged() }} />}

      {rules.length === 0 ? (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          No rules yet. A company in {country.name} will be created with no leave policy, and
          its HR will be asked to set one.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm min-w-[42rem]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0] border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold">Days</th>
                <th className="py-2 pr-4 font-semibold">How it accrues</th>
                <th className="py-2 pr-4 font-semibold">Eligible after</th>
                <th className="py-2 pr-4 font-semibold">Source</th>
                <th className="py-2 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-[#E8E8E8] dark:border-[#2A2A2A] align-top">
                  <td className="py-3 pr-4 font-semibold text-[#1A1A1A] dark:text-white capitalize">{r.leave_type}</td>
                  <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0]">{r.days_per_year ?? '—'}</td>
                  <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0] text-xs">
                    {ACCRUALS.find((a) => a.value === r.accrual)?.label ?? r.accrual}
                  </td>
                  <td className="py-3 pr-4 text-[#666666] dark:text-[#A0A0A0] text-xs">
                    {r.min_service_months > 0 ? `${r.min_service_months} months` : 'immediately'}
                  </td>
                  <td className="py-3 pr-4 text-xs text-[#666666] dark:text-[#A0A0A0] max-w-[22rem]">
                    <span className="font-medium text-[#1A1A1A] dark:text-white">{r.legal_reference}</span>
                    {r.notes && <span className="block mt-1">{r.notes}</span>}
                  </td>
                  <td className="py-3">
                    <button
                      onClick={async () => {
                        const { error } = await supabase.from('country_leave_rules').delete().eq('id', r.id)
                        if (error) console.error('[LeaveRules] delete failed', error)
                        onChanged()
                      }}
                      className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#FF4D4D]"
                      aria-label={`Remove the ${r.leave_type} rule`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-4">
            Changing a rule here does not change any company that has already been seeded —
            their policy is theirs once created. It changes what the next company inherits.
          </p>
        </div>
      )}
    </Section>
  )
}

function NewRule({ country, existing, onDone }) {
  const taken = new Set(existing.map((r) => r.leave_type))
  const available = LEAVE_TYPES.filter((t) => !taken.has(t))

  const [f, setF] = useState({
    leave_type: available[0] ?? '', days_per_year: '', accrual: 'annual',
    min_service_months: '0', legal_reference: '', notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  if (available.length === 0) {
    return (
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-6 pb-6 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
        Every leave type already has a rule for {country.name}. Remove one to replace it.
      </p>
    )
  }

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.from('country_leave_rules').insert({
      country_code: country.code,
      leave_type: f.leave_type,
      days_per_year: f.days_per_year === '' ? null : Number(f.days_per_year),
      accrual: f.accrual,
      min_service_months: Number(f.min_service_months) || 0,
      legal_reference: f.legal_reference.trim(),
      notes: f.notes.trim() || null,
    })
    setBusy(false)
    if (error) { console.error('[NewRule] insert failed', error); setErr(error.message); return }
    onDone()
  }

  return (
    <form onSubmit={save} className="grid sm:grid-cols-2 gap-3 mb-6 pb-6 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Leave type</span>
        <select className={input} value={f.leave_type} onChange={set('leave_type')}>
          {available.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Days per year</span>
        <input type="number" min="0" max="365" step="0.5" className={input}
               placeholder="30" value={f.days_per_year} onChange={set('days_per_year')} />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">How it accrues</span>
        <select className={input} value={f.accrual} onChange={set('accrual')}>
          {ACCRUALS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Eligible after (months of service)</span>
        <input type="number" min="0" max="120" className={input}
               value={f.min_service_months} onChange={set('min_service_months')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">
          Legal reference <span className="text-[#FF4D4D]">— required</span>
        </span>
        <input required className={input}
               placeholder="e.g. Federal Decree-Law 33/2021, Art. 29"
               value={f.legal_reference} onChange={set('legal_reference')} />
        <span className="block text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-1">
          The article this number comes from. If you cannot cite it, do not add it — an
          uncited entitlement is the one nobody checks.
        </span>
      </label>
      <label className="block sm:col-span-2">
        <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Notes</span>
        <input className={input}
               placeholder="Staging, conditions, what this figure does and does not cover"
               value={f.notes} onChange={set('notes')} />
      </label>

      {err && <p className="sm:col-span-2 text-xs text-[#FF4D4D]">{err}</p>}

      <div className="sm:col-span-2">
        <button disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#0F0F0F] bg-[#00D4A0] hover:bg-[#00C090] disabled:opacity-50">
          {busy && <Loader2 size={14} className="animate-spin" />} Add rule
        </button>
      </div>
    </form>
  )
}
