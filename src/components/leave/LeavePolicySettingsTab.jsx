import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Pencil, Trash2, X, Loader2, AlertTriangle, Scale, Building2,
} from 'lucide-react'
import supabase from '../../services/supabase'
import useAuthStore from '../../store/authStore'

// Which leave this company offers, and how much of it.
//
// This tab exists because the Leave screen now reads company_leave_policies instead of a
// hardcoded list of nine types — so a UK company stops being offered Hajj Leave. Without
// somewhere to manage the policy that change would only ever remove things: the UAE pack
// carries the six entitlements with a citation in Federal Decree-Law 33/2021, and the
// three that a UAE employer commonly grants anyway — emergency, marriage, hajj — are
// company benefits rather than statute, so they are not in the pack and HR needs to be
// able to add them.
//
// Two levels, as migration 31 set them up:
//   country_leave_rules     what the country's law entitles people to. Reference data.
//   company_leave_policies  what THIS company grants. Seeded from the country, then owned
//                           by the company. The law is the floor, not the value.

// Mirrors the company_leave_type CHECK constraint exactly. The database rejects anything
// else, so offering more here would only produce a failed insert.
const LEAVE_TYPES = [
  { value: 'annual',      label: 'Annual Leave' },
  { value: 'sick',        label: 'Sick Leave' },
  { value: 'emergency',   label: 'Emergency Leave' },
  { value: 'marriage',    label: 'Marriage Leave' },
  { value: 'paternity',   label: 'Paternity Leave' },
  { value: 'maternity',   label: 'Maternity Leave' },
  { value: 'hajj',        label: 'Hajj Leave' },
  { value: 'bereavement', label: 'Bereavement Leave' },
  { value: 'study',       label: 'Study Leave' },
]

const TYPE_LABEL = Object.fromEntries(LEAVE_TYPES.map(t => [t.value, t.label]))

// Mirrors company_leave_accrual.
const ACCRUALS = [
  { value: 'annual',    label: 'Full entitlement each year',
    hint: 'The whole allowance exists from the eligibility date.' },
  { value: 'monthly',   label: 'Accrues monthly',
    hint: 'Builds up with each month of service.' },
  { value: 'per_event', label: 'Granted per event',
    hint: 'Given when the event happens, not held as a running balance.' },
]

const ACCRUAL_LABEL = Object.fromEntries(ACCRUALS.map(a => [a.value, a.label]))

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Add / Edit modal ───────────────────────────────────────────────────────

function PolicyModal({ existing, takenTypes, countryRule, companyId, onClose, onSaved, showToast }) {
  const isEdit = !!existing

  const available = LEAVE_TYPES.filter(t => !takenTypes.has(t.value))
  const [leaveType, setLeaveType] = useState(existing?.leave_type ?? available[0]?.value ?? 'annual')
  const [days, setDays]           = useState(existing?.days_per_year ?? '')
  const [accrual, setAccrual]     = useState(existing?.accrual ?? 'annual')
  const [minMonths, setMinMonths] = useState(existing?.min_service_months ?? 0)
  const [saving, setSaving]       = useState(false)
  const [formError, setFormError] = useState('')

  // The statutory rule for whichever type is selected, if the country has a verified pack.
  const statutory = countryRule?.[leaveType] ?? null
  const belowStatutory =
    statutory?.days_per_year != null &&
    days !== '' &&
    Number(days) < Number(statutory.days_per_year)

  async function submit(e) {
    e.preventDefault()
    setFormError('')

    const d = days === '' ? null : Number(days)
    if (d !== null && (!Number.isFinite(d) || d < 0 || d > 365)) {
      setFormError('Days per year must be between 0 and 365, or left blank.')
      return
    }
    const m = Number(minMonths)
    if (!Number.isFinite(m) || m < 0 || m > 600) {
      setFormError('Minimum service must be a number of months between 0 and 600.')
      return
    }

    setSaving(true)
    const payload = {
      days_per_year: d,
      accrual,
      min_service_months: m,
    }

    let error
    if (isEdit) {
      // leave_type is not editable — it is half of the unique key and existing leave
      // requests reference it. Delete and re-add to change it.
      ;({ error } = await supabase
        .from('company_leave_policies')
        .update(payload)
        .eq('id', existing.id))
    } else {
      // source 'company' — this row was a human decision, not inherited from the pack,
      // and seed_company_leave_policies must never overwrite it.
      ;({ error } = await supabase
        .from('company_leave_policies')
        .insert({ ...payload, company_id: companyId, leave_type: leaveType, source: 'company' }))
    }
    setSaving(false)

    if (error) {
      console.error('[LeavePolicySettingsTab] save failed', error)
      setFormError(error.message || 'Could not save this leave policy.')
      return
    }
    showToast('success', isEdit ? 'Leave policy updated' : `${TYPE_LABEL[leaveType]} added`)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            {isEdit ? `Edit ${TYPE_LABEL[existing.leave_type]}` : 'Add leave type'}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Leave type</label>
            {isEdit ? (
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
                {TYPE_LABEL[existing.leave_type]} — the type itself cannot be changed, because leave
                already requested refers to it. Remove it and add another instead.
              </p>
            ) : (
              <select value={leaveType} onChange={e => setLeaveType(e.target.value)} className={INPUT}>
                {available.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Days per year</label>
            <input
              type="number" min="0" max="365" value={days}
              onChange={e => setDays(e.target.value)}
              placeholder="Leave blank for no fixed allowance"
              className={INPUT}
            />
            {statutory && (
              <p className="flex items-start gap-1.5 text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">
                <Scale size={12} className="shrink-0 mt-0.5" />
                The law here allows {statutory.days_per_year} days — {statutory.legal_reference}
              </p>
            )}
            {belowStatutory && (
              <p className="flex items-start gap-1.5 text-xs text-[#FF8C42] mt-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                This is below the statutory allowance. BYOND will save it — you may have a lawful
                reason — but check it against {statutory.legal_reference} first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">How it is earned</label>
            <select value={accrual} onChange={e => setAccrual(e.target.value)} className={INPUT}>
              {ACCRUALS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">
              {ACCRUALS.find(a => a.value === accrual)?.hint}
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
              Minimum service before it applies
            </label>
            <input
              type="number" min="0" max="600" value={minMonths}
              onChange={e => setMinMonths(e.target.value)}
              className={INPUT}
            />
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">
              Months. Zero means it applies from the first day.
            </p>
          </div>

          {formError && <p className="text-xs text-[#FF4D4D]">{formError}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export default function LeavePolicySettingsTab({ companyId, showToast }) {
  const countryRules = useAuthStore(s => s.countryRules)
  // Hoisted so the fetch depends on the code alone. Depending on the whole object would
  // re-run the query every time the store hands back a new reference for the same country.
  const countryCode = countryRules?.code ?? null

  const [policies, setPolicies] = useState([])
  const [rules, setRules]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState(null)   // { existing } | { existing: null }
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [{ data: pol, error: polErr }, { data: rul, error: rulErr }] = await Promise.all([
      supabase
        .from('company_leave_policies')
        .select('id, leave_type, days_per_year, accrual, min_service_months, source, notes')
        .eq('company_id', companyId),
      // The country's statutory rules, so an edit can be checked against the law rather
      // than against nothing. Readable by any signed-in user.
      countryCode
        ? supabase
            .from('country_leave_rules')
            .select('leave_type, days_per_year, legal_reference')
            .eq('country_code', countryCode)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (polErr) console.error('[LeavePolicySettingsTab] policies fetch failed', polErr)
    if (rulErr) console.error('[LeavePolicySettingsTab] country rules fetch failed', rulErr)
    setPolicies(pol ?? [])
    setRules(rul ?? [])
    setLoading(false)
  }, [companyId, countryCode])

  useEffect(() => { load() }, [load])

  const ruleByType = useMemo(
    () => Object.fromEntries((rules ?? []).map(r => [r.leave_type, r])),
    [rules],
  )

  // LEAVE_TYPES order, not whatever order Postgres returned.
  const ordered = useMemo(() => {
    const byType = Object.fromEntries(policies.map(p => [p.leave_type, p]))
    return LEAVE_TYPES.map(t => byType[t.value]).filter(Boolean)
  }, [policies])

  const takenTypes = useMemo(() => new Set(policies.map(p => p.leave_type)), [policies])

  async function remove(policy) {
    setDeletingId(policy.id)
    const { error } = await supabase.from('company_leave_policies').delete().eq('id', policy.id)
    setDeletingId(null)
    if (error) {
      console.error('[LeavePolicySettingsTab] delete failed', error)
      showToast('error', 'Could not remove this leave type.')
      return
    }
    showToast('success', `${TYPE_LABEL[policy.leave_type]} removed`)
    load()
  }

  return (
    <div className="space-y-6 max-w-3xl">

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Leave policy</h3>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            The leave your company offers. Only these types can be requested.
            {countryRules?.name && ` Seeded from ${countryRules.name}, and yours to change.`}
          </p>
        </div>
        <button
          onClick={() => setModal({ existing: null })}
          disabled={takenTypes.size >= LEAVE_TYPES.length}
          title={takenTypes.size >= LEAVE_TYPES.length ? 'Every leave type is already in your policy' : undefined}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <Plus size={15} />
          Add leave type
        </button>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-20 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]" />
          ))}
        </div>
      ) : ordered.length === 0 ? (
        <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20">
          <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#FF8C42]">No leave types yet</p>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              {countryRules && !countryRules.verified
                ? `BYOND has no verified labour code on file for ${countryRules.name} yet, so nothing was seeded — deliberately, rather than guessing at entitlements nobody could source. Add the leave your company offers and it becomes available immediately.`
                : 'Nobody can request leave until at least one type exists here.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {ordered.map(p => {
            const rule = ruleByType[p.leave_type]
            const below = rule?.days_per_year != null && p.days_per_year != null
              && Number(p.days_per_year) < Number(rule.days_per_year)
            return (
              <div key={p.id} className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                        {TYPE_LABEL[p.leave_type] ?? p.leave_type}
                      </p>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        p.source === 'country_pack'
                          ? 'bg-[#4D9FFF]/10 text-[#4D9FFF]'
                          : 'bg-[#A78BFA]/10 text-[#A78BFA]'
                      }`}>
                        {p.source === 'country_pack' ? <Scale size={10} /> : <Building2 size={10} />}
                        {p.source === 'country_pack' ? 'From the law' : 'Company policy'}
                      </span>
                    </div>
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                      {p.days_per_year == null ? 'No fixed allowance' : `${p.days_per_year} days a year`}
                      {' · '}{ACCRUAL_LABEL[p.accrual] ?? p.accrual}
                      {p.min_service_months > 0 && ` · after ${p.min_service_months} months`}
                    </p>
                    {p.notes && (
                      <p className="text-xs text-[#AAAAAA] dark:text-[#555555] mt-1.5">{p.notes}</p>
                    )}
                    {below && (
                      <p className="flex items-start gap-1.5 text-xs text-[#FF8C42] mt-2">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        Below the {rule.days_per_year} days the law allows — {rule.legal_reference}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setModal({ existing: p })}
                      aria-label={`Edit ${TYPE_LABEL[p.leave_type]}`}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] hover:bg-[#00D4A0]/10 transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(p)}
                      disabled={deletingId === p.id}
                      aria-label={`Remove ${TYPE_LABEL[p.leave_type]}`}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:text-[#FF4D4D] hover:bg-[#FF4D4D]/10 disabled:opacity-50 transition-colors"
                    >
                      {deletingId === p.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <PolicyModal
          existing={modal.existing}
          takenTypes={takenTypes}
          countryRule={ruleByType}
          companyId={companyId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}
