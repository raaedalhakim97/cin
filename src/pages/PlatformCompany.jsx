import { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Phone, Star, Trash2, Plus, FileText, Server, CreditCard,
  FileSignature, ListChecks, Headphones, ShieldCheck, Loader2, AlertTriangle,
  PauseCircle,
} from 'lucide-react'
import supabase from '../services/supabase'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonRow } from '../components/Skeleton'
import { countryNameFor } from '../utils/onboarding'

// BYOND's file on one customer.
//
// Two kinds of record live on this page and they have opposite audiences, which is
// worth knowing before adding anything to it:
//
//   The tenant's own       their company documents, who administers them. Read
//                          through platform_* functions because tenant RLS would
//                          otherwise hide them from an operator.
//
//   BYOND's about them     contacts, contract, invoices, action plans, support.
//                          Five tables whose only policy is is_platform_owner, so
//                          the customer cannot read them. An internal note saying
//                          "chasing payment, considering suspension" is not
//                          something they read over our shoulder.
//
// Those five are queried directly rather than through SECURITY DEFINER functions.
// They have no tenant-scoped policy to work around, so plain RLS is enough — and
// every definer function avoided is one less place where RLS does not apply.

const MONEY = (n, ccy) =>
  n === null || n === undefined
    ? '—'
    : `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${ccy ?? ''}`.trim()

const DATE = (d) => (d ? new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

const BYTES = (b) => {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

// Date comparisons live here rather than in a component body. Calling Date.now()
// during render is impure — react-hooks/purity flags it, correctly: the value
// changes between renders for reasons unrelated to props or state.
function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr + 'T00:00:00').getTime() - Date.now()) / 86400000)
}

function isPast(dateStr) {
  const d = daysUntil(dateStr)
  return d !== null && d < 0
}

const BADGE = {
  // contract
  draft: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]',
  sent: 'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  signed: 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]',
  expired: 'bg-[#FF8C42]/10 text-[#FF8C42]',
  terminated: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  // invoices
  paid: 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]',
  overdue: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  void: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]',
  refunded: 'bg-[#A78BFA]/10 text-[#A78BFA]',
  // actions + tickets
  open: 'bg-[#FF8C42]/10 text-[#FF8C42]',
  in_progress: 'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  blocked: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  done: 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]',
  cancelled: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]',
  waiting_on_customer: 'bg-[#A78BFA]/10 text-[#A78BFA]',
  resolved: 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]',
  closed: 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]',
  // access
  active: 'bg-[#00D4A0]/10 text-[#00A57D] dark:text-[#00D4A0]',
  pending: 'bg-[#FF8C42]/10 text-[#FF8C42]',
  unlinked: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  // plan — 'active' and 'cancelled' above are shared with the invoice and action
  // vocabularies, which is fine: they mean the same kind of thing in both.
  trial: 'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  suspended: 'bg-[#FF4D4D]/10 text-[#FF4D4D]',
}

const ROLE_LABEL = { super_admin: 'Owner', hr_manager: 'HR Manager', admin: 'Ops Coordinator' }

const input =
  'w-full px-3 py-2 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#0F0F0F] text-[#1A1A1A] dark:text-white ' +
  'border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0]'

function Badge({ value }) {
  if (!value) return null
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${BADGE[value] ?? BADGE.draft}`}>
      {String(value).replace(/_/g, ' ')}
    </span>
  )
}

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

function Empty({ children }) {
  return <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{children}</p>
}

// A generic "reveal a small form" button, used by every section that can add a row.
function AddButton({ open, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline"
    >
      <Plus size={13} /> {open ? 'Cancel' : label}
    </button>
  )
}

export default function PlatformCompany() {
  const { companyId } = useParams()

  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const [state, setState] = useState(null) // null = never loaded
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    // One pass, everything the page needs. Promise.all rather than a waterfall
    // because none of these depend on each other and nine sequential round trips
    // is a page that feels broken on a phone connection.
    Promise.all([
      supabase.rpc('platform_company_overview'),
      supabase.rpc('platform_company_access', { p_company_id: companyId }),
      supabase.rpc('platform_company_documents', { p_company_id: companyId }),
      supabase.rpc('platform_company_footprint', { p_company_id: companyId }),
      supabase.from('company_contacts').select('*').eq('company_id', companyId).order('is_primary', { ascending: false }),
      supabase.from('company_contracts').select('*').eq('company_id', companyId).maybeSingle(),
      supabase.from('company_invoices').select('*').eq('company_id', companyId).order('issued_on', { ascending: false }),
      supabase.from('company_action_items').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('company_support_tickets').select('*').eq('company_id', companyId).order('opened_at', { ascending: false }),
      // Read straight from `company` rather than through platform_company_overview:
      // the overview deliberately returns counts and dates only, and plan_note is
      // neither. company_select_own already lets a platform owner read any company
      // row (`OR is_platform_owner(auth.uid())`), so there is nothing to add.
      supabase.from('company').select('plan, plan_note, plan_changed_at').eq('id', companyId).maybeSingle(),
    ]).then(([ov, ac, docs, fp, contacts, contract, invoices, actions, tickets, plan]) => {
      if (cancelled) return

      const firstError = [ov, ac, docs, fp, contacts, contract, invoices, actions, tickets, plan].find((r) => r.error)
      if (firstError) {
        console.error('[PlatformCompany] load failed', firstError.error?.code, firstError.error)
        setError(
          /platform owner/i.test(firstError.error?.message ?? '')
            ? 'This page is for BYOND platform owners only.'
            : 'Could not load this company. Please try again.'
        )
        return
      }

      setState({
        company: (ov.data ?? []).find((c) => c.company_id === companyId) ?? null,
        access: ac.data ?? [],
        documents: docs.data ?? [],
        footprint: fp.data ?? {},
        contacts: contacts.data ?? [],
        contract: contract.data ?? null,
        invoices: invoices.data ?? [],
        actions: actions.data ?? [],
        tickets: tickets.data ?? [],
        plan: plan.data ?? null,
      })
      setError('')
    })

    return () => { cancelled = true }
  }, [companyId, reloadKey])

  const c = state?.company
  const ccy = c?.currency ?? 'AED'

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Link to="/platform" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#00A57D] dark:hover:text-[#00D4A0] mb-4">
            <ArrowLeft size={14} /> All companies
          </Link>

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
          ) : state && !c ? (
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
              That company is not on the platform, or it has been removed.
            </p>
          ) : state ? (
            <>
              <div className="mb-6">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">{c.name}</h1>
                  <Badge value={c.plan} />
                </div>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                  {countryNameFor(c.country) ?? '—'} · {c.currency ?? '—'} · joined {DATE(c.created_at)}
                  {c.created_via ? ` · via ${c.created_via}` : ''}
                </p>
              </div>

              <div className="grid lg:grid-cols-2 gap-4 lg:gap-5">
                {/* First, and full width: it is the only control on this page that
                    changes what the customer can do rather than what BYOND knows
                    about them. */}
                <div className="lg:col-span-2">
                  {/* Keyed on the saved state so a successful change remounts the
                      control with the new plan and note as its defaults, instead of
                      leaving the form holding what was typed a moment ago. */}
                  <Plan
                    key={`${state.plan?.plan ?? ''}-${state.plan?.plan_changed_at ?? ''}`}
                    companyId={companyId} name={c.name} row={state.plan} onChanged={reload}
                  />
                </div>
                <Contacts companyId={companyId} rows={state.contacts} onChanged={reload} />
                <Access rows={state.access} onChanged={reload} />
                <Contract companyId={companyId} row={state.contract} defaultCurrency={ccy} onChanged={reload} />
                <Payments companyId={companyId} rows={state.invoices} defaultCurrency={ccy} onChanged={reload} />
                <Actions companyId={companyId} rows={state.actions} onChanged={reload} />
                <Support companyId={companyId} rows={state.tickets} onChanged={reload} />
                <Documents rows={state.documents} />
                <ServerStatus footprint={state.footprint} />
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  )
}

// ── Plan and access ──────────────────────────────────────────────────────────
// The one control on this page with a consequence outside BYOND: moving a company
// off 'trial'/'active' shuts the workspace at the next request its people make.
//
// Enforcement is entirely in the database — get_user_company_id returns NULL for a
// plan that does not grant access, and 100 RLS policies resolve tenant scope through
// it. This is only the handle.
const PLANS = [
  { value: 'trial',     label: 'Trial',     grants: true,  blurb: 'Full access. The three-month quarter self-signup starts on.' },
  { value: 'active',    label: 'Active',    grants: true,  blurb: 'Full access, paying customer.' },
  { value: 'suspended', label: 'Suspended', grants: false, blurb: 'Access stops. Nothing is deleted. Reversible from this page.' },
  { value: 'cancelled', label: 'Cancelled', grants: false, blurb: 'Access stops, subscription ended. Records retained.' },
]

function Plan({ companyId, name, row, onChanged }) {
  const current = row?.plan ?? 'trial'
  const [next, setNext] = useState(current)
  const [note, setNote] = useState(row?.plan_note ?? '')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const chosen = PLANS.find((p) => p.value === next) ?? PLANS[0]
  const nowGrants = PLANS.find((p) => p.value === current)?.grants !== false
  const dirty = next !== current || (note ?? '') !== (row?.plan_note ?? '')
  // Confirm only when access is being taken away. Restoring it is not the dangerous
  // direction, and a confirmation on every save trains people to click through it.
  const needsConfirm = !chosen.grants && nowGrants

  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('platform_set_plan', {
      p_company_id: companyId,
      p_plan: next,
      p_note: note.trim() || null,
    })
    setBusy(false)
    setConfirming(false)
    if (error) {
      console.error('[Plan] platform_set_plan failed', error)
      setErr(error.message)
      return
    }
    setErr('')
    onChanged()
  }

  return (
    <Section icon={PauseCircle} title="Plan and access"
      subtitle="What this company may do. Changing it takes effect on their next request.">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Badge value={current} />
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          {nowGrants ? 'Workspace is open' : 'Workspace is shut'}
          {row?.plan_changed_at ? ` · last changed ${DATE(row.plan_changed_at)}` : ''}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] mb-1.5">Plan</span>
          <select className={input} value={next} onChange={(e) => { setNext(e.target.value); setConfirming(false) }}>
            {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <span className="block text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">{chosen.blurb}</span>
        </label>

        <label className="block">
          {/* Labelled for what it is. The note is rendered on the customer's
              suspended screen, so an internal aside written here goes straight to
              the person it is about. */}
          <span className="block text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] mb-1.5">
            Message shown to the workspace
          </span>
          <input className={input} value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="Invoice 3 unpaid since 12 July — contact accounts@byondhr.com" />
          <span className="block text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">
            Optional. Their owner and HR see this; employees are told to ask them.
          </span>
        </label>
      </div>

      {err && <p className="text-xs text-[#FF4D4D] mt-3">{err}</p>}

      {confirming ? (
        <div className="mt-4 px-4 py-3 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
          <p className="text-sm text-[#1A1A1A] dark:text-white font-semibold flex items-start gap-2">
            <AlertTriangle size={15} className="text-[#FF4D4D] shrink-0 mt-0.5" />
            Shut the workspace at {name}?
          </p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5 ml-[23px]">
            Everyone there loses access — attendance, leave, payroll, documents — from
            their next click. Data is kept and this page can undo it.
          </p>
          <div className="flex gap-2 mt-3 ml-[23px]">
            <button onClick={save} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#FF4D4D] hover:bg-[#E63939] disabled:opacity-50">
              {busy && <Loader2 size={13} className="animate-spin" />} Yes, set to {chosen.label.toLowerCase()}
            </button>
            <button onClick={() => setConfirming(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] hover:underline">
              Keep it open
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => (needsConfirm ? setConfirming(true) : save())}
          disabled={busy || !dirty}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-[#0F0F0F] bg-[#00D4A0] hover:bg-[#00C090] disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {dirty ? 'Save plan' : 'Saved'}
        </button>
      )}
    </Section>
  )
}

// ── Contacts and numbers ─────────────────────────────────────────────────────
function Contacts({ companyId, rows, onChanged }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ full_name: '', position_title: '', phone: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    // First contact added becomes primary — the common case, and it saves a second
    // step. A partial unique index enforces one primary per company regardless.
    const { error } = await supabase.from('company_contacts')
      .insert({ ...f, company_id: companyId, is_primary: rows.length === 0 })
    setBusy(false)
    if (error) { console.error('[Contacts] insert failed', error); setErr(error.message); return }
    setF({ full_name: '', position_title: '', phone: '', email: '' })
    setOpen(false); setErr(''); onChanged()
  }

  async function makePrimary(id) {
    // Clear then set: the partial unique index rejects two primaries, so these
    // cannot be one statement.
    await supabase.from('company_contacts').update({ is_primary: false }).eq('company_id', companyId)
    const { error } = await supabase.from('company_contacts').update({ is_primary: true }).eq('id', id)
    if (error) console.error('[Contacts] makePrimary failed', error)
    onChanged()
  }

  async function remove(id) {
    const { error } = await supabase.from('company_contacts').delete().eq('id', id)
    if (error) console.error('[Contacts] delete failed', error)
    onChanged()
  }

  return (
    <Section icon={Phone} title="Contacts and numbers"
      subtitle="Who to call. Separate from staff — the person who signs or pays is often not an employee."
      action={<AddButton open={open} onClick={() => setOpen((o) => !o)} label="Add contact" />}>
      {open && (
        <form onSubmit={add} className="grid sm:grid-cols-2 gap-2 mb-4">
          <input required className={input} placeholder="Full name" value={f.full_name}
                 onChange={(e) => setF({ ...f, full_name: e.target.value })} />
          <input className={input} placeholder="Position (Managing Director)" value={f.position_title}
                 onChange={(e) => setF({ ...f, position_title: e.target.value })} />
          <input className={input} placeholder="+971 50 000 0000" value={f.phone}
                 onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <input className={input} type="email" placeholder="name@company.com" value={f.email}
                 onChange={(e) => setF({ ...f, email: e.target.value })} />
          {err && <p className="sm:col-span-2 text-xs text-[#FF4D4D]">{err}</p>}
          <button type="submit" disabled={busy}
                  className="sm:col-span-2 justify-self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save contact
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>No contact recorded. If this company needs help there is nobody to call.</Empty>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-xs">
              <button onClick={() => makePrimary(r.id)} title={r.is_primary ? 'Primary contact' : 'Make primary'}
                      className="shrink-0 mt-0.5">
                <Star size={13} className={r.is_primary ? 'text-[#FF8C42] fill-[#FF8C42]' : 'text-[#AAAAAA] dark:text-[#555555]'} />
              </button>
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[#1A1A1A] dark:text-white">{r.full_name}</span>
                {r.position_title && <span className="text-[#666666] dark:text-[#A0A0A0]"> · {r.position_title}</span>}
                <span className="block text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  {r.phone ? <a href={`tel:${r.phone}`} className="hover:underline">{r.phone}</a> : null}
                  {r.phone && r.email ? ' · ' : null}
                  {r.email ? <a href={`mailto:${r.email}`} className="hover:underline">{r.email}</a> : null}
                  {!r.phone && !r.email ? 'no number or email' : null}
                </span>
              </span>
              <button onClick={() => remove(r.id)} className="shrink-0 text-[#FF4D4D] hover:underline" aria-label="Remove contact">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Access and positions ─────────────────────────────────────────────────────
function Access({ rows, onChanged }) {
  const [busy, setBusy] = useState(null)
  const active = rows.filter((r) => r.kind === 'active')
  const owners = active.filter((r) => r.role === 'super_admin' || r.role === 'hr_manager').length

  async function revoke(id) {
    setBusy(id)
    const { error } = await supabase.rpc('platform_revoke_invite', { p_invite_id: id })
    setBusy(null)
    if (error) console.error('[Access] revoke failed', error)
    onChanged()
  }

  return (
    <Section icon={ShieldCheck} title="Access and positions"
      // Spelled out because the list and the Owners column on the previous page
      // count different things: that column is owners plus HR, this list includes
      // ops coordinators too. Without saying so, the two numbers look like a
      // contradiction.
      subtitle={`${active.length} can administer this company — ${owners} owner/HR, ${active.length - owners} ops.`}>
      {rows.length === 0 ? (
        <Empty>Nobody. This company cannot be administered until someone is invited as its owner.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={(r.invite_id ?? 'a') + r.email} className="flex items-start gap-2 flex-wrap text-xs">
              <Badge value={r.kind === 'pending' ? 'pending' : r.status === 'unlinked' ? 'unlinked' : 'active'} />
              <span className="font-semibold text-[#1A1A1A] dark:text-white">{ROLE_LABEL[r.role] ?? r.role}</span>
              <span className="min-w-0 text-[#666666] dark:text-[#A0A0A0]">
                {r.full_name}
                {r.position_title ? ` · ${r.position_title}` : ''} · {r.email}
              </span>
              {r.status === 'unlinked' && (
                <span className="text-[11px] text-[#FF4D4D]">
                  signs in but has no employee record — they will hit “account not linked”
                </span>
              )}
              {r.invite_id && (
                <button onClick={() => revoke(r.invite_id)} disabled={busy === r.invite_id}
                        className="ml-auto font-semibold text-[#FF4D4D] hover:underline disabled:opacity-50">
                  {busy === r.invite_id ? 'Revoking…' : 'Revoke invite'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Contract ─────────────────────────────────────────────────────────────────
function Contract({ companyId, row, defaultCurrency, onChanged }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({
    status: row?.status ?? 'draft',
    signed_at: row?.signed_at ?? '',
    starts_on: row?.starts_on ?? '',
    ends_on: row?.ends_on ?? '',
    notice_days: row?.notice_days ?? '',
    monthly_fee: row?.monthly_fee ?? '',
    seats_included: row?.seats_included ?? '',
    auto_renew: row?.auto_renew ?? false,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    // Empty strings become NULL rather than being sent as '' — a date column
    // rejects '' outright, and a numeric one would coerce it to 0, which reads as
    // "they pay nothing" instead of "we have not recorded it".
    const nz = (v) => (v === '' || v === null ? null : v)
    const { error } = await supabase.from('company_contracts').upsert({
      company_id: companyId,
      status: f.status,
      signed_at: nz(f.signed_at),
      starts_on: nz(f.starts_on),
      ends_on: nz(f.ends_on),
      notice_days: nz(f.notice_days) === null ? null : Number(f.notice_days),
      monthly_fee: nz(f.monthly_fee) === null ? null : Number(f.monthly_fee),
      seats_included: nz(f.seats_included) === null ? null : Number(f.seats_included),
      auto_renew: !!f.auto_renew,
      currency: defaultCurrency,
    }, { onConflict: 'company_id' })
    setBusy(false)
    if (error) { console.error('[Contract] upsert failed', error); setErr(error.message); return }
    setErr(''); setOpen(false); onChanged()
  }

  const endsIn = daysUntil(row?.ends_on)
  const expiringSoon = endsIn !== null && endsIn <= 60

  return (
    <Section icon={FileSignature} title="Contract status"
      subtitle="The agreement between BYOND and this company. Figures are recorded, never calculated."
      action={<AddButton open={open} onClick={() => setOpen((o) => !o)} label={row ? 'Edit' : 'Set contract'} />}>
      {open ? (
        <form onSubmit={save} className="grid sm:grid-cols-2 gap-2">
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Status
            <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {['draft', 'sent', 'signed', 'expired', 'terminated'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Signed on
            <input type="date" className={input} value={f.signed_at ?? ''} onChange={(e) => setF({ ...f, signed_at: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Starts
            <input type="date" className={input} value={f.starts_on ?? ''} onChange={(e) => setF({ ...f, starts_on: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Ends
            <input type="date" className={input} value={f.ends_on ?? ''} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Monthly fee ({defaultCurrency})
            <input type="number" step="0.01" min="0" className={input} value={f.monthly_fee ?? ''}
                   onChange={(e) => setF({ ...f, monthly_fee: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Seats included
            <input type="number" min="0" className={input} value={f.seats_included ?? ''}
                   onChange={(e) => setF({ ...f, seats_included: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Notice (days)
            <input type="number" min="0" className={input} value={f.notice_days ?? ''}
                   onChange={(e) => setF({ ...f, notice_days: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-xs text-[#1A1A1A] dark:text-white self-end pb-2">
            <input type="checkbox" checked={!!f.auto_renew} onChange={(e) => setF({ ...f, auto_renew: e.target.checked })} />
            Auto-renews
          </label>
          {err && <p className="sm:col-span-2 text-xs text-[#FF4D4D]">{err}</p>}
          <button type="submit" disabled={busy}
                  className="sm:col-span-2 justify-self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save contract
          </button>
        </form>
      ) : !row ? (
        <Empty>No contract recorded. Nothing here says what this customer agreed to.</Empty>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2"><Badge value={row.status} />
            {row.auto_renew && <span className="text-[#666666] dark:text-[#A0A0A0]">auto-renews</span>}
          </div>
          <dl className="grid grid-cols-2 gap-y-1.5 gap-x-3 text-[#666666] dark:text-[#A0A0A0]">
            <div><dt className="inline">Term: </dt><dd className="inline text-[#1A1A1A] dark:text-white">{DATE(row.starts_on)} → {DATE(row.ends_on)}</dd></div>
            <div><dt className="inline">Signed: </dt><dd className="inline text-[#1A1A1A] dark:text-white">{DATE(row.signed_at)}</dd></div>
            <div><dt className="inline">Fee: </dt><dd className="inline text-[#1A1A1A] dark:text-white">{MONEY(row.monthly_fee, row.currency)}/mo</dd></div>
            <div><dt className="inline">Seats: </dt><dd className="inline text-[#1A1A1A] dark:text-white">{row.seats_included ?? '—'}</dd></div>
            <div><dt className="inline">Notice: </dt><dd className="inline text-[#1A1A1A] dark:text-white">{row.notice_days ? `${row.notice_days} days` : '—'}</dd></div>
          </dl>
          {expiringSoon && (
            <p className="flex items-center gap-1.5 text-[11px] text-[#FF8C42]">
              <AlertTriangle size={12} /> Ends {DATE(row.ends_on)} — inside the renewal window
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

// ── Payments ─────────────────────────────────────────────────────────────────
function Payments({ companyId, rows, defaultCurrency, onChanged }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ reference: '', amount: '', due_on: '', status: 'sent' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const outstanding = rows
    .filter((r) => r.status === 'sent' || r.status === 'overdue')
    .reduce((n, r) => n + Number(r.amount || 0), 0)

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('company_invoices').insert({
      company_id: companyId,
      reference: f.reference || null,
      amount: Number(f.amount),
      currency: defaultCurrency,
      due_on: f.due_on || null,
      status: f.status,
      // A CHECK constraint ties status='paid' to paid_on being set, so the date has
      // to travel with the status rather than being filled in later.
      paid_on: f.status === 'paid' ? new Date().toISOString().slice(0, 10) : null,
    })
    setBusy(false)
    if (error) { console.error('[Payments] insert failed', error); setErr(error.message); return }
    setF({ reference: '', amount: '', due_on: '', status: 'sent' })
    setErr(''); setOpen(false); onChanged()
  }

  async function markPaid(id) {
    const { error } = await supabase.from('company_invoices')
      .update({ status: 'paid', paid_on: new Date().toISOString().slice(0, 10) }).eq('id', id)
    if (error) console.error('[Payments] markPaid failed', error)
    onChanged()
  }

  return (
    <Section icon={CreditCard} title="Payment status"
      subtitle={outstanding > 0 ? `${MONEY(outstanding, defaultCurrency)} outstanding` : 'Nothing outstanding'}
      action={<AddButton open={open} onClick={() => setOpen((o) => !o)} label="Add invoice" />}>
      {open && (
        <form onSubmit={add} className="grid sm:grid-cols-2 gap-2 mb-4">
          <input className={input} placeholder="Reference (INV-001)" value={f.reference}
                 onChange={(e) => setF({ ...f, reference: e.target.value })} />
          <input required type="number" step="0.01" min="0" className={input} placeholder={`Amount (${defaultCurrency})`}
                 value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Due
            <input type="date" className={input} value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} />
          </label>
          <label className="text-xs text-[#666666] dark:text-[#A0A0A0]">Status
            <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {['draft', 'sent', 'paid', 'overdue', 'void'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {err && <p className="sm:col-span-2 text-xs text-[#FF4D4D]">{err}</p>}
          <button type="submit" disabled={busy}
                  className="sm:col-span-2 justify-self-start inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save invoice
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>No invoices recorded.</Empty>
      ) : (
        <ul className="space-y-2 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 flex-wrap">
              <Badge value={r.status} />
              <span className="font-semibold text-[#1A1A1A] dark:text-white">{MONEY(r.amount, r.currency)}</span>
              <span className="text-[#666666] dark:text-[#A0A0A0]">
                {r.reference ? `${r.reference} · ` : ''}
                {r.status === 'paid' ? `paid ${DATE(r.paid_on)}` : r.due_on ? `due ${DATE(r.due_on)}` : `issued ${DATE(r.issued_on)}`}
              </span>
              {r.status !== 'paid' && r.status !== 'void' && (
                <button onClick={() => markPaid(r.id)} className="ml-auto font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline">
                  Mark paid
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Action plans ─────────────────────────────────────────────────────────────
function Actions({ companyId, rows, onChanged }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ title: '', detail: '', priority: 'normal', due_on: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const openCount = rows.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('company_action_items').insert({
      company_id: companyId, title: f.title, detail: f.detail || null,
      priority: f.priority, due_on: f.due_on || null,
    })
    setBusy(false)
    if (error) { console.error('[Actions] insert failed', error); setErr(error.message); return }
    setF({ title: '', detail: '', priority: 'normal', due_on: '' })
    setErr(''); setOpen(false); onChanged()
  }

  async function setStatus(id, status) {
    // done_at is tied to status='done' by a CHECK constraint, so it moves with it.
    const { error } = await supabase.from('company_action_items')
      .update({ status, done_at: status === 'done' ? new Date().toISOString() : null }).eq('id', id)
    if (error) console.error('[Actions] setStatus failed', error)
    onChanged()
  }

  return (
    <Section icon={ListChecks} title="Action plans"
      subtitle={openCount > 0 ? `${openCount} open` : 'Nothing outstanding'}
      action={<AddButton open={open} onClick={() => setOpen((o) => !o)} label="Add action" />}>
      {open && (
        <form onSubmit={add} className="space-y-2 mb-4">
          <input required className={input} placeholder="Walk their HR through adding a work location"
                 value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <textarea className={input} rows={2} placeholder="Detail (optional)"
                    value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
          <div className="grid sm:grid-cols-2 gap-2">
            <select className={input} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" className={input} value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} />
          </div>
          {err && <p className="text-xs text-[#FF4D4D]">{err}</p>}
          <button type="submit" disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save action
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>Nothing planned. The company list flags problems; this is where what you intend to do about them lives.</Empty>
      ) : (
        <ul className="space-y-2.5 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <Badge value={r.status} />
              <span className="min-w-0 flex-1">
                <span className={`font-semibold ${r.status === 'done' ? 'text-[#666666] dark:text-[#A0A0A0] line-through' : 'text-[#1A1A1A] dark:text-white'}`}>
                  {r.title}
                </span>
                {r.priority !== 'normal' && <span className="text-[#FF8C42]"> · {r.priority}</span>}
                {r.due_on && <span className="text-[#666666] dark:text-[#A0A0A0]"> · due {DATE(r.due_on)}</span>}
                {r.detail && <span className="block text-[#666666] dark:text-[#A0A0A0] mt-0.5">{r.detail}</span>}
              </span>
              {r.status !== 'done' && (
                <button onClick={() => setStatus(r.id, 'done')} className="shrink-0 font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline">
                  Done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Customer support ─────────────────────────────────────────────────────────
function Support({ companyId, rows, onChanged }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ subject: '', detail: '', channel: 'whatsapp', priority: 'normal', raised_by: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const openCount = rows.filter((r) => r.status === 'open' || r.status === 'waiting_on_customer').length

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('company_support_tickets').insert({
      company_id: companyId, subject: f.subject, detail: f.detail || null,
      channel: f.channel, priority: f.priority, raised_by: f.raised_by || null,
    })
    setBusy(false)
    if (error) { console.error('[Support] insert failed', error); setErr(error.message); return }
    setF({ subject: '', detail: '', channel: 'whatsapp', priority: 'normal', raised_by: '' })
    setErr(''); setOpen(false); onChanged()
  }

  async function resolve(id) {
    const { error } = await supabase.from('company_support_tickets')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', id)
    if (error) console.error('[Support] resolve failed', error)
    onChanged()
  }

  return (
    <Section icon={Headphones} title="Customer support"
      subtitle={openCount > 0 ? `${openCount} open` : 'No open tickets'}
      action={<AddButton open={open} onClick={() => setOpen((o) => !o)} label="Log a ticket" />}>
      {open && (
        <form onSubmit={add} className="space-y-2 mb-4">
          <input required className={input} placeholder="Cannot clock in on the phone"
                 value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <textarea className={input} rows={2} placeholder="What they said, and what you tried"
                    value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
          <div className="grid sm:grid-cols-3 gap-2">
            <select className={input} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {['whatsapp', 'phone', 'email', 'in_person', 'other'].map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <select className={input} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={input} placeholder="Raised by" value={f.raised_by}
                   onChange={(e) => setF({ ...f, raised_by: e.target.value })} />
          </div>
          {err && <p className="text-xs text-[#FF4D4D]">{err}</p>}
          <button type="submit" disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60">
            {busy && <Loader2 size={12} className="animate-spin" />} Save ticket
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>No tickets logged. Recording them here is what turns “they messaged me once” into a history.</Empty>
      ) : (
        <ul className="space-y-2.5 text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-2">
              <Badge value={r.status} />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[#1A1A1A] dark:text-white">{r.subject}</span>
                <span className="block text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  {r.channel.replace('_', ' ')}
                  {r.raised_by ? ` · ${r.raised_by}` : ''} · {DATE(r.opened_at)}
                  {r.priority !== 'normal' ? ` · ${r.priority}` : ''}
                </span>
                {r.detail && <span className="block text-[#666666] dark:text-[#A0A0A0] mt-0.5">{r.detail}</span>}
              </span>
              {(r.status === 'open' || r.status === 'waiting_on_customer') && (
                <button onClick={() => resolve(r.id)} className="shrink-0 font-semibold text-[#00A57D] dark:text-[#00D4A0] hover:underline">
                  Resolve
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// ── Documents ────────────────────────────────────────────────────────────────
function Documents({ rows }) {
  return (
    <Section icon={FileText} title="Company documents"
      subtitle="Trade licence, VAT certificate, the signed contract. Uploaded by the company, in their own app.">
      {rows.length === 0 ? (
        <Empty>No company-level documents on file.</Empty>
      ) : (
        <ul className="space-y-2 text-xs">
          {rows.map((d) => {
            const expired = isPast(d.expiry_date)
            return (
              <li key={d.id} className="flex items-start gap-2">
                <FileText size={13} className="shrink-0 mt-0.5 text-[#666666] dark:text-[#A0A0A0]" />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-[#1A1A1A] dark:text-white">{d.label ?? d.file_name}</span>
                  <span className="block text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                    {d.file_name} · {BYTES(d.size_bytes)}
                    {d.expiry_date ? ` · expires ${DATE(d.expiry_date)}` : ''}
                  </span>
                </span>
                {expired && <span className="shrink-0 text-[#FF4D4D] font-semibold">expired</span>}
              </li>
            )
          })}
        </ul>
      )}
      {/* Metadata only, deliberately. platform_company_documents never returns the
          storage path: knowing a document exists and being able to open it are
          different permissions, and BYOND does not need the second one. */}
      <p className="mt-3 text-[11px] text-[#666666] dark:text-[#A0A0A0]">
        Names and dates only — this page cannot open a customer's files.
      </p>
    </Section>
  )
}

// ── Server status ────────────────────────────────────────────────────────────
function ServerStatus({ footprint }) {
  const f = footprint ?? {}
  const rowsTotal = ['employees', 'attendance', 'leave', 'payroll', 'kpi_scores', 'shifts', 'audit_rows']
    .reduce((n, k) => n + Number(f[k] ?? 0), 0)

  return (
    <Section icon={Server} title="Server status"
      subtitle="Every company shares one database, so there is no per-company server. What varies is footprint.">
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-3 text-xs">
        {[
          ['Employees', f.employees], ['Attendance', f.attendance], ['Leave', f.leave],
          ['Payroll', f.payroll], ['KPI scores', f.kpi_scores], ['Shifts', f.shifts],
          ['Documents', f.documents], ['Audit rows', f.audit_rows],
        ].map(([label, v]) => (
          <div key={label}>
            <dt className="text-[#666666] dark:text-[#A0A0A0]">{label}</dt>
            <dd className="font-semibold text-[#1A1A1A] dark:text-white tabular-nums">{Number(v ?? 0).toLocaleString()}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[#666666] dark:text-[#A0A0A0]">Files</dt>
          <dd className="font-semibold text-[#1A1A1A] dark:text-white tabular-nums">{BYTES(Number(f.storage_bytes ?? 0))}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-[#666666] dark:text-[#A0A0A0]">
        {rowsTotal.toLocaleString()} rows in total. Database and API health are one
        shared number for the whole platform — Supabase reports those, not this page,
        and a per-company gauge would repeat the same value down the list while
        implying otherwise.
      </p>
    </Section>
  )
}
