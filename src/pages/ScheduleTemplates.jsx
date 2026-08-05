import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, X, Check, Loader2, Palette } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import EmptyState from '../components/EmptyState'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const DEFAULT_COLORS = ['#00D4A0', '#FF8C42', '#FF4D4D', '#4D9FFF', '#A78BFA', '#F15BB5', '#00BBF9']

function toHM(t) { return (t || '').slice(0, 5) }

function TemplateModal({ existing, onClose, onSaved, showToast, companyId }) {
  const isEdit = !!existing
  const [name, setName] = useState(existing?.name ?? '')
  const [startTime, setStartTime] = useState(toHM(existing?.start_time) || '08:00')
  const [endTime, setEndTime] = useState(toHM(existing?.end_time) || '16:00')
  const [breakMinutes, setBreakMinutes] = useState(existing?.break_minutes ?? 60)
  const [color, setColor] = useState(existing?.color ?? DEFAULT_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    if (!name.trim()) { setFormError('Name is required'); return }
    // end_time <= start_time is a valid overnight pattern (e.g. 22:00–06:00)
    // — shift_templates has no ordering CHECK, and shifts instantiated from
    // it roll the end instant to the next calendar day (see ShiftModal.jsx).
    // Only reject the genuinely ambiguous case: identical start/end.
    if (startTime === endTime) { setFormError('Start and end time cannot be the same'); return }

    setSaving(true)
    const payload = {
      name: name.trim(),
      start_time: startTime,
      end_time: endTime,
      break_minutes: Number(breakMinutes) || 0,
      color,
    }
    const { error } = isEdit
      ? await supabase.from('shift_templates').update(payload).eq('id', existing.id)
      : await supabase.from('shift_templates').insert({ ...payload, company_id: companyId, active: true })
    setSaving(false)
    if (error) {
      console.error('[ScheduleTemplates] save failed', error)
      setFormError(error.code === '23505' ? 'A template with this name already exists.' : 'Something went wrong saving this template. Please try again.')
      return
    }
    showToast('success', isEdit ? 'Template updated' : 'Template added')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">{isEdit ? 'Edit' : 'Add'} Shift Template</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Shift" className={INPUT} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Start Time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={INPUT} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                End Time {endTime && startTime && endTime < startTime && <span className="font-normal text-[#00D4A0]">(overnight)</span>}
              </label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={INPUT} required />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Break Minutes</label>
            <input type="number" min={0} max={240} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} className={INPUT} />
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
              <Palette size={12} /> Color
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              {DEFAULT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-[#1E1E1E] ring-[#1A1A1A] dark:ring-white scale-110' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-7 h-7 rounded-full border-0 cursor-pointer" />
            </div>
          </div>

          {formError && <p className="text-xs text-[#FF4D4D]">{formError}</p>}

          <button
            type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Template'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function ScheduleTemplates() {
  const companyId = useAuthStore((s) => s.companyId)
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const { toast, showToast } = useToast()

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('shift_templates').select('*').order('name')
    setTemplates(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  async function toggleActive(t) {
    const { error } = await supabase.from('shift_templates').update({ active: !t.active }).eq('id', t.id)
    if (error) {
      console.error('[ScheduleTemplates] toggleActive failed', error)
      showToast('error', 'Something went wrong updating this template. Please try again.')
      return
    }
    fetchTemplates()
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div className="flex items-center gap-4">
              <Link
                to="/schedule"
                className="w-9 h-9 rounded-lg flex items-center justify-center bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors shrink-0"
              >
                <ArrowLeft size={16} />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Shift Templates</h1>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">Reusable shift patterns for scheduling</p>
              </div>
            </div>
            <button
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#00D4A0] hover:bg-[#00B589] text-white text-sm font-semibold transition-colors w-fit"
            >
              <Plus size={16} />
              Add Template
            </button>
          </div>

          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-3 animate-pulse">
                {[0, 1, 2].map((i) => <SkeletonRow key={i} className="h-12" />)}
              </div>
            ) : templates.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={Palette}
                  title="No shift templates yet"
                  hint="Add a template to speed up scheduling — e.g. Morning, Evening, Night shifts."
                  action={{ label: 'Add Template', onClick: () => { setEditing(null); setModalOpen(true) } }}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                      {['Name', 'Hours', 'Break', 'Status', ''].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                    {templates.map((t) => (
                      <tr key={t.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color || '#00D4A0' }} />
                            <span className="font-semibold text-[#1A1A1A] dark:text-white">{t.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{toHM(t.start_time)}–{toHM(t.end_time)}</td>
                        <td className="px-5 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{t.break_minutes}m</td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => toggleActive(t)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${t.active ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'}`}
                          >
                            {t.active ? 'Active' : 'Inactive'}
                          </button>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => { setEditing(t); setModalOpen(true) }}
                            className="text-[#666666] dark:text-[#A0A0A0] hover:text-[#00D4A0] transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {modalOpen && (
        <TemplateModal
          existing={editing}
          companyId={companyId}
          onClose={() => setModalOpen(false)}
          onSaved={fetchTemplates}
          showToast={showToast}
        />
      )}

      <ToastComp toast={toast} />
    </div>
  )
}
