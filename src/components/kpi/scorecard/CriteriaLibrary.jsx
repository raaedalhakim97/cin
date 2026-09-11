import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, ChevronRight, Gauge, Loader2, Plus, Sparkles, Trash2, X,
} from 'lucide-react'
import supabase from '../../../services/supabase'
import { LEVELS, CATEGORIES, METRICS } from './levels'

// HR's library of what this company measures, and what each level means.
//
// The anchors are the product here, not the criteria. A criterion called "Quality of Work"
// tells an employee nothing; a sentence saying "work is regularly returned for rework"
// tells them exactly what a 1 was for and what a 3 would look like instead. Nothing is
// seeded — a starter library would be this product guessing at somebody else's business,
// and these sentences have to be in the company's own words because they are what a person
// is told about their work.

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
}

function CategoryChip({ value }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0] capitalize">
      {value}
    </span>
  )
}

// ─── One criterion, expanded ──────────────────────────────────────────────────

function CriterionDetail({ definition, onChanged, showToast }) {
  const [anchors, setAnchors] = useState([])
  const [thresholds, setThresholds] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({})       // level -> in-progress anchor text
  const [saving, setSaving] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: a }, { data: t }] = await Promise.all([
      supabase.from('kpi_anchors').select('*').eq('definition_id', definition.id)
        .order('level').order('sort_order'),
      supabase.from('kpi_auto_thresholds').select('*').eq('definition_id', definition.id).order('level'),
    ])
    setAnchors(a ?? [])
    setThresholds(t ?? [])
    setLoading(false)
  }, [definition.id])

  useEffect(() => { load() }, [load])

  async function addAnchor(level) {
    const comment = (draft[level] ?? '').trim()
    if (!comment) return
    setSaving(`anchor-${level}`)
    const { error } = await supabase.from('kpi_anchors').insert({
      definition_id: definition.id, level, comment,
    })
    setSaving(null)
    if (error) {
      console.error('[CriteriaLibrary] anchor insert failed', error)
      showToast('error', error.message)
      return
    }
    setDraft((d) => ({ ...d, [level]: '' }))
    load()
    onChanged()
  }

  async function removeAnchor(anchor) {
    // Deleting rather than deactivating is safe: kpi_review_lines snapshots the sentence
    // it showed at the time (self_anchor_text / manager_anchor_text), so a past review
    // keeps reading the way it read then.
    const { error } = await supabase.from('kpi_anchors').delete().eq('id', anchor.id)
    if (error) {
      console.error('[CriteriaLibrary] anchor delete failed', error)
      showToast('error', error.message)
      return
    }
    load()
    onChanged()
  }

  async function saveThreshold(level, value) {
    const min = value === '' ? null : Number(value)
    if (min === null) {
      await supabase.from('kpi_auto_thresholds').delete()
        .eq('definition_id', definition.id).eq('level', level)
    } else {
      await supabase.from('kpi_auto_thresholds')
        .upsert({ definition_id: definition.id, level, min_value: min },
                { onConflict: 'definition_id,level' })
    }
    load()
  }

  if (loading) {
    return <div className="px-5 py-6 flex justify-center"><Loader2 size={16} className="animate-spin text-[#00D4A0]" /></div>
  }

  const isAuto = definition.source === 'automated'

  return (
    <div className="px-5 pb-5 space-y-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A] pt-5">
      {definition.description && (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{definition.description}</p>
      )}

      {isAuto && (
        <div className="p-4 rounded-xl bg-[#4D9FFF]/5 border border-[#4D9FFF]/20">
          <div className="flex items-center gap-2 mb-1">
            <Gauge size={14} className="text-[#4D9FFF]" />
            <p className="text-xs font-semibold text-[#4D9FFF]">
              Measured automatically from {METRICS.find((m) => m.id === definition.metric)?.label ?? definition.metric}
            </p>
          </div>
          <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mb-3">
            Give the lowest value that earns each level. A measurement below every value here
            stays unrated — the system will not invent a level it cannot justify.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {LEVELS.map((l) => {
              const row = thresholds.find((t) => t.level === l.level)
              return (
                <div key={l.level}>
                  <label className="block text-[11px] font-semibold mb-1" style={{ color: l.hex }}>{l.short}</label>
                  <input
                    type="number" step="any"
                    defaultValue={row?.min_value ?? ''}
                    onBlur={(e) => saveThreshold(l.level, e.target.value)}
                    placeholder="—"
                    className="w-full px-2.5 py-2 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#4D9FFF]"
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white">
          What each level means
          <span className="ml-2 font-normal text-[#666666] dark:text-[#A0A0A0]">
            — the rater picks one of these sentences, and the employee reads it
          </span>
        </p>

        {LEVELS.map((l) => {
          const mine = anchors.filter((a) => a.level === l.level)
          return (
            <div key={l.level} className="rounded-xl border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
              <div className="flex items-center gap-2 px-3.5 py-2" style={{ backgroundColor: `${l.hex}12` }}>
                <span className="w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                      style={{ backgroundColor: l.hex }}>{l.level}</span>
                <span className="text-xs font-semibold" style={{ color: l.hex }}>{l.label}</span>
                <span className="text-[11px] text-[#666666] dark:text-[#A0A0A0]">· {l.points} points</span>
              </div>

              <div className="p-3 space-y-2">
                {mine.length === 0 && (
                  <p className="text-[11px] text-[#AAAAAA] dark:text-[#555555] italic">
                    No sentence written yet. A rater choosing this level will have nothing to show for it.
                  </p>
                )}
                {mine.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 group">
                    <ChevronRight size={13} className="text-[#AAAAAA] dark:text-[#555555] shrink-0 mt-0.5" />
                    <p className="flex-1 text-xs text-[#1A1A1A] dark:text-white">{a.comment}</p>
                    <button
                      type="button" onClick={() => removeAnchor(a)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 text-[#AAAAAA] hover:text-[#FF4D4D] transition-all"
                      aria-label="Remove this sentence"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}

                <div className="flex gap-2 pt-1">
                  <input
                    value={draft[l.level] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [l.level]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAnchor(l.level) } }}
                    placeholder={`What does "${l.label}" look like in this company?`}
                    className="flex-1 px-3 py-2 text-xs rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0]"
                  />
                  <button
                    type="button" onClick={() => addAnchor(l.level)}
                    disabled={saving === `anchor-${l.level}` || !(draft[l.level] ?? '').trim()}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-40 transition-colors shrink-0"
                  >
                    {saving === `anchor-${l.level}` ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── The library ──────────────────────────────────────────────────────────────

export default function CriteriaLibrary({ companyId, canEdit, showToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({
    name: '', description: '', category: 'general', source: 'manual', metric: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('kpi_definitions')
      .select('*, kpi_anchors(count)')
      .order('active', { ascending: false })
      .order('sort_order')
      .order('name')
    if (error) {
      console.error('[CriteriaLibrary] load failed', error)
      showToast('error', 'Could not load the criteria library.')
      setRows([])
    } else {
      setRows(data ?? [])
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => { load() }, [load])

  async function create(e) {
    e.preventDefault()
    setErr('')
    const name = form.name.trim()
    if (!name) { setErr('Give the criterion a name.'); return }
    if (form.source === 'automated' && !form.metric) {
      setErr('An automated criterion needs a measurement to read.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('kpi_definitions').insert({
      company_id: companyId,
      code: slugify(name),
      name,
      description: form.description.trim() || null,
      category: form.category,
      source: form.source,
      metric: form.source === 'automated' ? form.metric : null,
    })
    setSaving(false)
    if (error) {
      console.error('[CriteriaLibrary] create failed', error)
      setErr(error.code === '23505'
        ? 'A criterion with that name already exists.'
        : error.message)
      return
    }
    setForm({ name: '', description: '', category: 'general', source: 'manual', metric: '' })
    setShowNew(false)
    showToast('success', `"${name}" added. Now write what each level means.`)
    load()
  }

  async function toggleActive(row) {
    const { error } = await supabase.from('kpi_definitions')
      .update({ active: !row.active }).eq('id', row.id)
    if (error) {
      console.error('[CriteriaLibrary] toggle failed', error)
      showToast('error', error.message)
      return
    }
    load()
  }

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-[#00D4A0]" /></div>
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] max-w-xl">
          Everything this company can measure someone on, and the sentence that goes with each
          level. Employees can read all of it — being able to see what "Exceeds" looks like
          before the review is what makes it fixable afterwards.
        </p>
        {canEdit && (
          <button
            type="button" onClick={() => setShowNew((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] transition-colors shrink-0"
          >
            {showNew ? <X size={14} /> : <Plus size={14} />}
            {showNew ? 'Cancel' : 'New criterion'}
          </button>
        )}
      </div>

      {showNew && canEdit && (
        <form onSubmit={create} className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Name</label>
              <input
                value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Quality of work" className={INPUT} required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Category</label>
              <select
                value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className={`${INPUT} capitalize`}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
              Description <span className="font-normal text-[#666666] dark:text-[#A0A0A0]">(optional)</span>
            </label>
            <input
              value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this is really asking about" className={INPUT}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-2">Who decides the level</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { id: 'manual', label: 'A person rates it', note: 'The manager picks a level and a sentence.' },
                { id: 'automated', label: 'The app measures it', note: 'Taken from attendance data. Nobody rates it by hand.' },
              ].map((o) => (
                <button
                  key={o.id} type="button"
                  onClick={() => setForm((f) => ({ ...f, source: o.id, metric: o.id === 'manual' ? '' : f.metric }))}
                  className={`px-3.5 py-3 rounded-lg text-left border transition-colors ${
                    form.source === o.id
                      ? 'border-[#00D4A0] bg-[#00D4A0]/5'
                      : 'border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40'
                  }`}
                >
                  <p className="text-xs font-semibold text-[#1A1A1A] dark:text-white">{o.label}</p>
                  <p className="text-[11px] text-[#666666] dark:text-[#A0A0A0] mt-0.5">{o.note}</p>
                </button>
              ))}
            </div>
          </div>

          {form.source === 'automated' && (
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Measurement</label>
              <select
                value={form.metric} onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}
                className={INPUT} required
              >
                <option value="">Choose a measurement…</option>
                {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}
              </select>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-xs text-[#FF4D4D]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />{err}
            </div>
          )}

          <button
            type="submit" disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Add criterion
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
          <Sparkles size={20} className="mx-auto text-[#AAAAAA] dark:text-[#555555] mb-2" />
          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Nothing measured yet</p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-md mx-auto">
            Nothing is pre-filled here deliberately. What a company measures, and the words it
            uses to describe good and bad work, have to be its own.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const anchorCount = row.kpi_anchors?.[0]?.count ?? 0
            const open = openId === row.id
            return (
              <div key={row.id} className={`rounded-xl bg-white dark:bg-[#1E1E1E] border transition-colors ${
                open ? 'border-[#00D4A0]/40' : 'border-[#E8E8E8] dark:border-[#2A2A2A]'
              } ${row.active ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-3 px-5 py-4">
                  <button
                    type="button" onClick={() => setOpenId(open ? null : row.id)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <ChevronRight size={15} className={`text-[#666666] dark:text-[#A0A0A0] shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{row.name}</p>
                        <CategoryChip value={row.category} />
                        {row.source === 'automated' && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF]">
                            <Gauge size={10} /> automatic
                          </span>
                        )}
                        {!row.active && (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#A0A0A0]/15 text-[#666666] dark:text-[#A0A0A0]">
                            retired
                          </span>
                        )}
                      </div>
                      <p className={`text-xs mt-0.5 ${anchorCount === 0 ? 'text-[#FF8C42]' : 'text-[#666666] dark:text-[#A0A0A0]'}`}>
                        {anchorCount === 0
                          ? 'No level descriptions yet'
                          : `${anchorCount} level description${anchorCount === 1 ? '' : 's'}`}
                      </p>
                    </div>
                  </button>

                  {canEdit && (
                    <button
                      type="button" onClick={() => toggleActive(row)}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                    >
                      {row.active ? 'Retire' : 'Bring back'}
                    </button>
                  )}
                </div>

                {open && (
                  <CriterionDetail definition={row} onChanged={load} showToast={showToast} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
