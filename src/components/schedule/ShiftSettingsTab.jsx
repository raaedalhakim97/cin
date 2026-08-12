import { useEffect, useState, lazy, Suspense } from 'react'
import { CalendarClock, Save, Loader2, MapPin, Plus, Trash2, Crosshair } from 'lucide-react'
import supabase from '../../services/supabase'

// Lazy, because Leaflet and its stylesheet are about 150 KB that nobody needs
// unless they are on this tab adding a site — and the main bundle is already over
// the 500 KB warning.
const WorkLocationMap = lazy(() => import('./WorkLocationMap'))

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

// Approved work locations — the thing require_gps_clock_in never had to
// measure against. Each row is a point plus a radius; the attendance_guard
// trigger takes the nearest active one and either records the distance
// (enforce_geofence off) or refuses the punch (on).
function WorkLocations({ companyId, showToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [locating, setLocating] = useState(false)
  const [draft, setDraft] = useState({ name: '', latitude: '', longitude: '', radius_metres: 200 })
  // Bumped by the mutation handlers to re-run the fetch below. Keeps the
  // query inside the effect, matching how the settings form above loads.
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    if (!companyId) return undefined
    let cancelled = false
    async function load() {
      const { data, error } = await supabase
        .from('work_locations')
        .select('id, name, latitude, longitude, radius_metres, active')
        .eq('company_id', companyId)
        .order('name')
      if (cancelled) return
      if (error) console.error('[WorkLocations] load failed', error)
      setRows(data ?? [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [companyId, reloadKey])

  // Typing coordinates by hand is how you end up fencing the wrong building.
  function useMyPosition() {
    if (!navigator.geolocation) {
      showToast('error', 'This browser cannot report your location.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((d) => ({
          ...d,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
        setLocating(false)
      },
      (err) => {
        console.error('[WorkLocations] geolocation failed', err)
        showToast('error', 'Could not read your location. Allow location access and try again.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  async function add() {
    const lat = Number(draft.latitude)
    const lng = Number(draft.longitude)
    if (!draft.name.trim()) { showToast('error', 'Give the location a name.'); return }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { showToast('error', 'Enter valid coordinates.'); return }

    setAdding(true)
    const { error } = await supabase.from('work_locations').insert({
      company_id: companyId,
      name: draft.name.trim(),
      latitude: lat,
      longitude: lng,
      radius_metres: Number(draft.radius_metres) || 200,
    })
    setAdding(false)
    if (error) {
      console.error('[WorkLocations] insert failed', error)
      showToast('error', error.code === '23505'
        ? 'A location with this name already exists.'
        : 'Something went wrong saving this location. Please try again.')
      return
    }
    setDraft({ name: '', latitude: '', longitude: '', radius_metres: 200 })
    showToast('success', 'Work location added')
    reload()
  }

  async function toggleActive(row) {
    const { error } = await supabase.from('work_locations').update({ active: !row.active }).eq('id', row.id)
    if (error) { console.error('[WorkLocations] toggle failed', error); showToast('error', 'Something went wrong. Please try again.'); return }
    reload()
  }

  async function remove(row) {
    const { error } = await supabase.from('work_locations').delete().eq('id', row.id)
    if (error) { console.error('[WorkLocations] delete failed', error); showToast('error', 'Something went wrong. Please try again.'); return }
    showToast('success', 'Work location removed')
    reload()
  }

  return (
    <div className="max-w-xl p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center">
          <MapPin size={16} className="text-[#00D4A0]" />
        </div>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Approved Work Locations</h3>
      </div>

      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4 max-w-md">
        Where clocking in counts as being at work. With none defined, nothing is fenced — location is still
        recorded, but every punch is accepted wherever it happens.
      </p>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <p className="text-sm text-[#AAAAAA] dark:text-[#555555] py-3">No locations yet.</p>
      ) : (
        <div className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A] border-y border-[#E8E8E8] dark:border-[#2A2A2A] mb-4">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${r.active ? 'text-[#1A1A1A] dark:text-white' : 'text-[#AAAAAA] dark:text-[#555555]'}`}>
                  {r.name}
                  {!r.active && <span className="ml-2 text-xs font-normal">(inactive)</span>}
                </p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  {Number(r.latitude).toFixed(5)}, {Number(r.longitude).toFixed(5)} · within {r.radius_metres} m
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggleActive(r)}
                className="shrink-0 px-2.5 py-1 rounded-md text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 transition-colors"
              >
                {r.active ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                onClick={() => remove(r)}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-[#FF4D4D] hover:bg-[#FF4D4D]/10 transition-colors"
                aria-label={`Remove ${r.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* The map and the two coordinate fields are the same control. Clicking or
          dragging writes into the inputs, and typing moves the pin — so whichever
          one you reach for, the other stays correct. */}
      <div className="mb-3">
        <Suspense fallback={
          <div className="h-64 w-full rounded-xl border border-[#E8E8E8] dark:border-[#2A2A2A] flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
          </div>
        }>
          <WorkLocationMap
            latitude={draft.latitude}
            longitude={draft.longitude}
            radiusMetres={draft.radius_metres}
            existing={rows}
            onPick={(lat, lng) =>
              setDraft((d) => ({
                ...d,
                // Five decimals is a little over a metre. More digits than that
                // is noise from a click, and it makes the field unreadable.
                latitude: lat.toFixed(5),
                longitude: lng.toFixed(5),
              }))
            }
          />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Name</label>
          <input
            type="text" value={draft.name} maxLength={80}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Head Office"
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Latitude</label>
          <input type="text" value={draft.latitude} onChange={(e) => setDraft({ ...draft, latitude: e.target.value })} className={INPUT} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Longitude</label>
          <input type="text" value={draft.longitude} onChange={(e) => setDraft({ ...draft, longitude: e.target.value })} className={INPUT} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Radius (metres)</label>
          <input
            type="number" min={25} max={20000}
            value={draft.radius_metres}
            onChange={(e) => setDraft({ ...draft, radius_metres: e.target.value })}
            className={INPUT}
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={useMyPosition}
            disabled={locating}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 disabled:opacity-60 transition-colors"
          >
            {locating ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />}
            Use my position
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={add}
        disabled={adding}
        className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
      >
        {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Add Location
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
        enforce_geofence: form.enforce_geofence,
        early_checkout_grace_minutes: Number(form.early_checkout_grace_minutes),
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
    <div className="space-y-6">
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
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Early Checkout Grace (minutes)</label>
          <input
            type="number" min={0} max={120}
            value={form.early_checkout_grace_minutes}
            onChange={(e) => set('early_checkout_grace_minutes', e.target.value)}
            className={INPUT}
          />
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">
            Clocking out this many minutes before the scheduled end is treated as a normal finish. Beyond it, the
            employee is warned and asked to confirm.
          </p>
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
        <Toggle
          checked={form.enforce_geofence}
          onChange={(v) => set('enforce_geofence', v)}
          label="Only Allow Clock In at Approved Locations"
          hint="On: a clock-in or clock-out outside every approved location's radius is rejected, and location sharing becomes mandatory. Off (default): the distance to the nearest location is still measured and stored on the record, but nothing is blocked. Has no effect until at least one location is added below."
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

    <WorkLocations companyId={companyId} showToast={showToast} />
    </div>
  )
}
