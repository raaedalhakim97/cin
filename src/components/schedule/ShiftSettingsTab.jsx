import { useEffect, useState } from 'react'
import { CalendarClock, Save, Loader2 } from 'lucide-react'
import supabase from '../../services/supabase'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT = INPUT

const PERIOD_OPTIONS = [
  { value: 'daily',    label: 'Daily' },
  { value: 'weekly',   label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly',  label: 'Monthly' },
]

const WEEK_START_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{label}</p>
        {hint && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 max-w-md">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`shrink-0 w-11 h-6 rounded-full relative transition-colors ${checked ? 'bg-[#00D4A0]' : 'bg-[#E8E8E8] dark:bg-[#2A2A2A]'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  )
}

// Settings → Shift Settings tab. shift_settings is one row per company
// (UNIQUE company_id) — always an update against the existing row, never
// an insert (the row is provisioned by the DB session's migration, not
// this frontend). hr_manager/super_admin only, per shift_settings_write RLS.
export default function ShiftSettingsTab({ companyId, showToast }) {
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function load() {
      if (!companyId) { setLoading(false); return }
      setLoading(true)
      const { data, error } = await supabase
        .from('shift_settings')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle()
      if (error) console.error('[ShiftSettingsTab] load failed', error)
      setForm(data)
      setLoading(false)
    }
    load()
  }, [companyId])

  function set(field, val) {
    setForm((prev) => ({ ...prev, [field]: val }))
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('shift_settings')
      .update({
        scheduling_period:    form.scheduling_period,
        week_starts_on:       Number(form.week_starts_on),
        min_rest_hours:       Number(form.min_rest_hours),
        enforce_rest:         form.enforce_rest,
        allow_double_booking: form.allow_double_booking,
        late_grace_minutes:   Number(form.late_grace_minutes),
        require_shift_to_clock_in: form.require_shift_to_clock_in,
        require_gps_clock_in: form.require_gps_clock_in,
      })
      .eq('company_id', companyId)
    setSaving(false)
    if (error) {
      console.error('[ShiftSettingsTab] submit failed', error)
      showToast('error', 'Something went wrong saving shift settings. Please try again.')
      return
    }
    showToast('success', 'Shift settings saved')
  }

  if (loading) return <Spinner />
  if (!form) {
    return (
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] max-w-md">
        No shift settings row exists yet for this company — this row is provisioned by the database, not created from this page.
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="max-w-xl p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-1">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center">
          <CalendarClock size={16} className="text-[#00D4A0]" />
        </div>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Shift Settings</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Scheduling Period</label>
          <select value={form.scheduling_period} onChange={(e) => set('scheduling_period', e.target.value)} className={SELECT}>
            {PERIOD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Week Starts On</label>
          <select value={form.week_starts_on} onChange={(e) => set('week_starts_on', e.target.value)} className={SELECT}>
            {WEEK_START_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Minimum Rest Hours</label>
          <input
            type="number" min={0} max={24} step={0.5}
            value={form.min_rest_hours}
            onChange={(e) => set('min_rest_hours', e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Late Grace Period (minutes)</label>
          <input
            type="number" min={0} max={60}
            value={form.late_grace_minutes}
            onChange={(e) => set('late_grace_minutes', e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A] border-t border-[#E8E8E8] dark:border-[#2A2A2A] mt-2">
        <Toggle
          checked={form.enforce_rest}
          onChange={(v) => set('enforce_rest', v)}
          label="Enforce Rest Period"
          hint="On: a shift that violates the minimum rest period is blocked outright. Off: schedulers see a warning but can still save it."
        />
        <Toggle
          checked={form.allow_double_booking}
          onChange={(v) => set('allow_double_booking', v)}
          label="Allow Double-Booking"
          hint="On: an employee can be scheduled for two overlapping shifts. Off (default): overlapping shifts are always blocked."
        />
        <Toggle
          checked={form.require_shift_to_clock_in}
          onChange={(v) => set('require_shift_to_clock_in', v)}
          label="Require Shift to Clock In"
          hint="On: employees can only clock in when they have a published work shift scheduled today. Off (default): clock-in is always allowed, falling back to the company's fixed work hours when no shift is linked."
        />
        <Toggle
          checked={form.require_gps_clock_in}
          onChange={(v) => set('require_gps_clock_in', v)}
          label="Require GPS to Clock In"
          hint="On (default): employees must grant location access to clock in or out — denied/unavailable location blocks the action. Off: location is still captured when available, but clock-in/out proceeds without it."
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="mt-5 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  )
}
