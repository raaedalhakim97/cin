import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Archive, Check, ChevronRight, FileText, Loader2, Lock, Plus, RotateCcw,
  Send, ShieldCheck, Trash2,
} from 'lucide-react'
import supabase from '../../../services/supabase'
import { weightVerdict } from './levels'

// A scorecard template: which criteria a role is measured on, and at what weight.
//
// The template is the unit of approval, not the employee. Raaed asked for weights to be
// signed off by the owner, HR and the manager — applied per person that is forty people
// times six criteria every quarter, and the feature would be dead inside a month. Approve
// six templates instead and every assignment that follows inherits the approval. Only a
// DEPARTURE from one needs signing off again, which is exactly where the risk is: a manager
// quietly re-weighting one person.

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const STATUS_META = {
  draft:         { label: 'Draft',            cls: 'bg-[#A0A0A0]/15 text-[#666666] dark:text-[#A0A0A0]' },
  pending_hr:    { label: 'Waiting for HR',   cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  pending_owner: { label: 'Waiting for owner', cls: 'bg-[#9B5DE5]/10 text-[#9B5DE5]' },
  approved:      { label: 'Approved',         cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  archived:      { label: 'Archived',         cls: 'bg-[#A0A0A0]/15 text-[#666666] dark:text-[#A0A0A0]' },
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${meta.cls}`}>{meta.label}</span>
}

// What this person can do to this template right now. Mirrors
// validate_kpi_template_transition — the database is the authority, and a button the
// database would refuse is worse than no button.
function actionsFor(status, role) {
  const isOwner = role === 'super_admin'
  const isHr = role === 'hr_manager'
  const canPropose = isOwner || isHr || role === 'department_manager'
  const out = []
  if (status === 'draft' && canPropose) {
    out.push({ to: 'pending_hr', label: 'Submit for approval', icon: Send, primary: true })
  }
  if (status === 'pending_hr' && isHr) {
    out.push({ to: 'pending_owner', label: 'Approve as HR', icon: ShieldCheck, primary: true })
  }
  if ((status === 'pending_hr' || status === 'pending_owner') && isOwner) {
    // The owner may sign straight from pending_hr: in a small company the owner is also
    // the HR manager, and making one person approve twice is theatre.
    out.push({ to: 'approved', label: 'Approve and publish', icon: ShieldCheck, primary: true })
  }
  if (status !== 'draft' && status !== 'archived' && canPropose) {
    out.push({ to: 'draft', label: 'Reopen as draft', icon: RotateCcw })
  }
  if (status !== 'archived' && (isOwner || isHr)) {
    out.push({ to: 'archived', label: 'Archive', icon: Archive })
  }
  return out
}

// ─── One template, expanded ───────────────────────────────────────────────────

function TemplateDetail({ template, definitions, onChanged, showToast }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [pick, setPick] = useState('')
  const [pickWeight, setPickWeight] = useState('')
  const [busy, setBusy] = useState(false)

  const editable = template.status === 'draft'

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('kpi_template_lines')
      .select('*, kpi_definitions!kpi_template_lines_definition_id_fkey(name, source, active)')
      .eq('template_id', template.id)
    setLines(data ?? [])
    setLoading(false)
  }, [template.id])

  useEffect(() => { load() }, [load])

  const total = lines.reduce((sum, l) => sum + Number(l.weight), 0)
  const verdict = weightVerdict(total)
  const used = new Set(lines.map((l) => l.definition_id))
  const available = definitions.filter((d) => d.active && !used.has(d.id))

  async function addLine(e) {
    e.preventDefault()
    const weight = Number(pickWeight)
    if (!pick || !Number.isFinite(weight) || weight <= 0 || weight > 100) {
      showToast('error', 'Pick a criterion and give it a weight between 1 and 100.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('kpi_template_lines').insert({
      template_id: template.id, definition_id: pick, weight,
    })
    setBusy(false)
    if (error) {
      console.error('[TemplateBuilder] add line failed', error)
      showToast('error', error.message)
      return
    }
    setPick(''); setPickWeight('')
    load(); onChanged()
  }

  async function setWeight(line, value) {
    const weight = Number(value)
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) return
    if (weight === Number(line.weight)) return
    const { error } = await supabase.from('kpi_template_lines').update({ weight }).eq('id', line.id)
    if (error) {
      console.error('[TemplateBuilder] weight update failed', error)
      showToast('error', error.message)
    }
    load(); onChanged()
  }

  async function removeLine(line) {
    const { error } = await supabase.from('kpi_template_lines').delete().eq('id', line.id)
    if (error) {
      console.error('[TemplateBuilder] remove line failed', error)
      showToast('error', error.message)
      return
    }
    load(); onChanged()
  }

  if (loading) {
    return <div className="px-5 py-6 flex justify-center"><Loader2 size={16} className="animate-spin text-[#00D4A0]" /></div>
  }

  return (
    <div className="px-5 pb-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A] pt-4 space-y-4">
      {lines.length === 0 ? (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          No criteria on this scorecard yet.
        </p>
      ) : (
        <div className="space-y-2">
          {lines.map((l) => {
            const share = total > 0 ? (Number(l.weight) / total) * 100 : 0
            return (
              <div key={l.id} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm text-[#1A1A1A] dark:text-white truncate">
                      {l.kpi_definitions?.name ?? 'Removed criterion'}
                      {l.kpi_definitions?.active === false && (
                        <span className="ml-2 text-[11px] text-[#FF8C42]">retired criterion</span>
                      )}
                    </p>
                    <span className="text-xs text-[#666666] dark:text-[#A0A0A0] shrink-0">{Number(l.weight)}%</span>
                  </div>
                  <div className="h-1.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
                    <div className="h-full bg-[#00D4A0] rounded-full transition-all" style={{ width: `${share}%` }} />
                  </div>
                </div>
                {editable && (
                  <>
                    <input
                      type="number" min={1} max={100} defaultValue={Number(l.weight)}
                      onBlur={(e) => setWeight(l, e.target.value)}
                      className="w-20 px-2.5 py-1.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] shrink-0"
                    />
                    <button
                      type="button" onClick={() => removeLine(l)}
                      className="shrink-0 text-[#AAAAAA] hover:text-[#FF4D4D] transition-colors"
                      aria-label="Remove"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-semibold ${
        verdict.ok ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#FF8C42]/10 text-[#FF8C42]'
      }`}>
        {verdict.ok ? <Check size={13} /> : <AlertTriangle size={13} />}
        {total}% assigned — {verdict.text}
      </div>

      {editable ? (
        available.length > 0 ? (
          <form onSubmit={addLine} className="flex flex-wrap gap-2">
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={`${INPUT} flex-1 min-w-[12rem]`}>
              <option value="">Add a criterion…</option>
              {available.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input
              type="number" min={1} max={100} value={pickWeight}
              onChange={(e) => setPickWeight(e.target.value)}
              placeholder="Weight %" className={`${INPUT} w-32`}
            />
            <button
              type="submit" disabled={busy}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
            </button>
          </form>
        ) : (
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            Every active criterion is already on this scorecard. Add more in the Criteria tab.
          </p>
        )
      ) : (
        <p className="flex items-center gap-2 text-xs text-[#666666] dark:text-[#A0A0A0]">
          <Lock size={12} />
          {template.status === 'approved'
            ? 'Approved, so the weights are fixed. Reopen it as a draft to change them — that clears both signatures and sends it back round.'
            : 'Waiting for approval. Reopen it as a draft to make changes.'}
        </p>
      )}
    </div>
  )
}

// ─── The list ─────────────────────────────────────────────────────────────────

export default function TemplateBuilder({ companyId, role, showToast }) {
  const [templates, setTemplates] = useState([])
  const [definitions, setDefinitions] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    const [{ data: t, error }, { data: d }] = await Promise.all([
      supabase.from('kpi_templates')
        .select('*, kpi_template_lines(weight), hr:employees!kpi_templates_hr_approved_by_fkey(full_name), owner:employees!kpi_templates_owner_approved_by_fkey(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('kpi_definitions').select('id, name, active, source').order('name'),
    ])
    if (error) {
      console.error('[TemplateBuilder] load failed', error)
      showToast('error', 'Could not load scorecards.')
    }
    setTemplates(t ?? [])
    setDefinitions(d ?? [])
    setLoading(false)
  }, [showToast])

  useEffect(() => { load() }, [load])

  async function create(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    const { data, error } = await supabase.from('kpi_templates')
      .insert({ company_id: companyId, name: trimmed })
      .select('id').single()
    setCreating(false)
    if (error) {
      console.error('[TemplateBuilder] create failed', error)
      showToast('error', error.message)
      return
    }
    setName('')
    setOpenId(data.id)
    load()
  }

  async function move(template, to) {
    setBusyId(template.id)
    const { error } = await supabase.from('kpi_templates').update({ status: to }).eq('id', template.id)
    setBusyId(null)
    if (error) {
      console.error('[TemplateBuilder] transition failed', error)
      // The database's messages are already written for a person — "Weights must add up
      // to 100%. This scorecard totals 80%." needs no translation.
      showToast('error', error.message)
      return
    }
    showToast('success', to === 'approved' ? 'Approved. It can now be assigned to people.' : 'Saved.')
    load()
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] max-w-xl">
        A scorecard is a set of criteria and their weights, usually one per role or
        department. It has to be approved before anyone can be assigned to it, and once
        approved the weights are fixed — that is what makes the approval mean something.
      </p>

      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="New scorecard — e.g. Sales Executive"
          className={`${INPUT} flex-1 min-w-[14rem]`}
        />
        <button
          type="submit" disabled={creating || !name.trim()}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-40 transition-colors"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create draft
        </button>
      </form>

      {templates.length === 0 ? (
        <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
          <FileText size={20} className="mx-auto text-[#AAAAAA] dark:text-[#555555] mb-2" />
          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">No scorecards yet</p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">
            Create one above, add criteria and weights, then send it for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const total = (t.kpi_template_lines ?? []).reduce((s, l) => s + Number(l.weight), 0)
            const open = openId === t.id
            const actions = actionsFor(t.status, role)
            return (
              <div key={t.id} className={`rounded-xl bg-white dark:bg-[#1E1E1E] border transition-colors ${
                open ? 'border-[#00D4A0]/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
              }`}>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button" onClick={() => setOpenId(open ? null : t.id)}
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                    >
                      <ChevronRight size={15} className={`text-[#666666] dark:text-[#A0A0A0] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{t.name}</p>
                          <StatusBadge status={t.status} />
                        </div>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                          {(t.kpi_template_lines ?? []).length} criteria · {total}% assigned
                          {t.owner_approved_at && t.owner?.full_name ? ` · approved by ${t.owner.full_name}` : ''}
                        </p>
                      </div>
                    </button>
                  </div>

                  {actions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3 pl-8">
                      {actions.map((a) => (
                        <button
                          key={a.to} type="button" onClick={() => move(t, a.to)} disabled={busyId === t.id}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
                            a.primary
                              ? 'text-white bg-[#00D4A0] hover:bg-[#00B589]'
                              : 'text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white'
                          }`}
                        >
                          {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <a.icon size={12} />}
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {t.status === 'pending_hr' && role === 'department_manager' && (
                    <p className="flex items-center gap-1.5 text-xs text-[#666666] dark:text-[#A0A0A0] mt-3 pl-8">
                      <Lock size={11} /> With HR now. You will see it here when it comes back.
                    </p>
                  )}
                </div>

                {open && (
                  <TemplateDetail
                    template={t} definitions={definitions} onChanged={load} showToast={showToast}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
