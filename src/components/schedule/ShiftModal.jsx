import { useEffect, useState } from 'react'
import { X, Loader2, Save, Send, AlertTriangle } from 'lucide-react'
import supabase from '../../services/supabase'

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT = INPUT

// Exact-message prefixes raised by the `aa_validate_shift` DB trigger —
// these are shown to the user verbatim (they're already user-friendly, per
// the task's explicit instruction). Anything else falls back to the
// site-wide "friendly fixed string + console.error" convention.
const KNOWN_DB_ERROR_PREFIXES = [
  'Shift overlaps existing shift',
  'Employee has approved leave on',
  'Rest period violation',
]

function isKnownValidationError(message) {
  return KNOWN_DB_ERROR_PREFIXES.some((p) => message?.startsWith(p))
}

// Turn a check-constraint violation into a sentence.
//
// "Add Day Off" failed for every user with "Something went wrong saving this
// shift. Please try again." — advice that could not possibly work, because the
// database was refusing the row on shifts_duration_sane and would refuse it
// again forever. The real cause only surfaced by replaying the insert by hand.
//
// A constraint name is not a user-facing string, but it is a fact, and mapping
// the ones we own to plain language means the next one of these is diagnosed
// from the screenshot rather than from a database session.
const CONSTRAINT_MESSAGES = {
  shifts_duration_sane:
    'A work shift cannot be longer than 16 hours. Check the start and end times — an end time earlier than the start becomes an overnight shift.',
  shifts_off_within_one_day:
    'A day off has to sit inside a single day. Add one per day rather than a range.',
  shifts_end_after_start:
    'End time must be after start time.',
  shifts_notes_len:
    'Notes are limited to 1000 characters.',
  shifts_shift_type_check:
    'A shift must be either a work shift or a day off.',
}

function constraintMessage(error) {
  const haystack = `${error?.message ?? ''} ${error?.details ?? ''}`
  const hit = Object.keys(CONSTRAINT_MESSAGES).find((name) => haystack.includes(name))
  return hit ? CONSTRAINT_MESSAGES[hit] : null
}

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return localDateStr(d)
}

// Combines a YYYY-MM-DD date with an HH:MM time into an ISO instant, in the
// browser's local timezone (shifts are timestamptz — same convention the
// rest of this codebase uses for datetime-local inputs).
function combine(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).toISOString()
}

function toHM(timeStr) {
  // shift_templates.start_time/end_time come back as "HH:MM:SS"
  return (timeStr || '').slice(0, 5)
}

export default function ShiftModal({
  shift,             // existing shift row to edit, or null to create
  initialDate,        // YYYY-MM-DD, used only when creating
  initialEmployeeId,  // used only when creating
  companyId,
  currentEmployeeId,
  onClose,
  onSaved,
  showToast,
}) {
  const isNew = !shift
  const isDraft = isNew || shift.status === 'scheduled'

  const [employees, setEmployees] = useState([])
  const [templates, setTemplates] = useState([])
  const [shiftSettings, setShiftSettings] = useState(null)
  const [loadingRefs, setLoadingRefs] = useState(true)

  const [employeeId, setEmployeeId] = useState(shift?.employee_id ?? initialEmployeeId ?? '')
  const [shiftType, setShiftType] = useState(shift?.shift_type ?? 'work')
  const [templateId, setTemplateId] = useState(shift?.template_id ?? '')
  const [useCustom, setUseCustom] = useState(isNew ? false : !shift.template_id)
  const [shiftDate, setShiftDate] = useState(shift?.shift_date ?? initialDate ?? localDateStr(new Date()))
  const [startTime, setStartTime] = useState(shift ? toHM(new Date(shift.start_at).toTimeString()) : '09:00')
  const [endTime, setEndTime] = useState(shift ? toHM(new Date(shift.end_at).toTimeString()) : '17:00')
  const [breakMinutes, setBreakMinutes] = useState(shift?.break_minutes ?? 60)
  const [notes, setNotes] = useState(shift?.notes ?? '')

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [restWarning, setRestWarning] = useState('')

  useEffect(() => {
    async function loadRefs() {
      setLoadingRefs(true)
      const [{ data: emps }, { data: tmpls }, { data: settings }] = await Promise.all([
        supabase.from('employees').select('id, full_name, job_title').eq('status', 'active').order('full_name'),
        supabase.from('shift_templates').select('*').eq('active', true).order('name'),
        supabase.from('shift_settings').select('*').eq('company_id', companyId).maybeSingle(),
      ])
      setEmployees(emps ?? [])
      setTemplates(tmpls ?? [])
      setShiftSettings(settings ?? null)
      setLoadingRefs(false)
    }
    loadRefs()
  }, [companyId])

  // Selecting a template inherits its hours/break; switching to custom keeps
  // whatever is currently in the fields so nothing is silently discarded.
  function handleTemplateChange(id) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) {
      setStartTime(toHM(t.start_time))
      setEndTime(toHM(t.end_time))
      setBreakMinutes(t.break_minutes)
    }
  }

  // An end time at or before the start time means the shift crosses
  // midnight — shifts store full timestamps (not just times), so this is
  // fully supported (confirmed migration 38); roll the end instant to the
  // next calendar day rather than treating it as invalid. Applies whether
  // the hours came from a template (shift_templates.start_time/end_time
  // have no ordering constraint — a template can represent an overnight
  // pattern like 22:00–06:00) or were typed in directly under Custom Hours.
  const isOff = shiftType === 'off'
  const overnight = !isOff && !!(startTime && endTime && endTime <= startTime)
  const startAt = isOff ? (shiftDate ? combine(shiftDate, '00:00') : null) : (shiftDate && startTime ? combine(shiftDate, startTime) : null)
  const endAt = isOff ? (shiftDate ? combine(shiftDate, '23:59') : null) : (shiftDate && endTime ? combine(overnight ? addDays(shiftDate, 1) : shiftDate, endTime) : null)
  const timesValid = isOff ? !!(startAt && endAt) : !!(startAt && endAt && new Date(endAt) > new Date(startAt) && startTime !== endTime)

  // Client-side rest-period check — only meaningful (and only shown) when
  // shift_settings.enforce_rest is OFF, since when it's ON the DB trigger
  // already blocks the save outright and its own exact message is surfaced.
  // Never runs for a Day Off entry — the DB trigger itself skips the rest
  // check entirely for shift_type='off' (it returns right after the
  // overlap check), so there's nothing to warn about here either.
  useEffect(() => {
    setRestWarning('')
    if (isOff || !employeeId || !timesValid || !shiftSettings || shiftSettings.enforce_rest) return
    const minRest = Number(shiftSettings.min_rest_hours)
    if (!minRest) return

    let cancelled = false
    async function checkRest() {
      const windowStart = localDateStr(new Date(new Date(shiftDate + 'T00:00:00').getTime() - 2 * 86400000))
      const windowEnd = localDateStr(new Date(new Date(shiftDate + 'T00:00:00').getTime() + 2 * 86400000))
      // Only 'work' shifts count toward the rest gap — mirrors
      // aa_validate_shift's own prior/next lookups, which filter the same
      // way since migration 39 (a full-day OFF entry shouldn't manufacture
      // a fake "0 hours rest" warning against an adjacent work shift).
      const { data: nearby } = await supabase
        .from('shifts')
        .select('id, start_at, end_at')
        .eq('employee_id', employeeId)
        .eq('shift_type', 'work')
        .neq('status', 'cancelled')
        .gte('shift_date', windowStart)
        .lte('shift_date', windowEnd)
      if (cancelled) return

      const others = (nearby ?? []).filter((s) => s.id !== shift?.id)
      const priorEnds = others.map((s) => new Date(s.end_at)).filter((d) => d <= new Date(startAt))
      const nextStarts = others.map((s) => new Date(s.start_at)).filter((d) => d >= new Date(endAt))

      const gaps = []
      if (priorEnds.length) {
        const latestPriorEnd = new Date(Math.max(...priorEnds))
        gaps.push((new Date(startAt) - latestPriorEnd) / 3600000)
      }
      if (nextStarts.length) {
        const earliestNextStart = new Date(Math.min(...nextStarts))
        gaps.push((earliestNextStart - new Date(endAt)) / 3600000)
      }
      const violated = gaps.find((g) => g < minRest)
      if (violated !== undefined) {
        setRestWarning(`Only ${violated.toFixed(1)} hours of rest around this shift (company minimum: ${minRest}h). Rest enforcement is currently off, so this can still be saved.`)
      }
    }
    checkRest()
    return () => { cancelled = true }
  }, [isOff, employeeId, shiftDate, startAt, endAt, timesValid, shiftSettings, shift?.id])

  async function save(publish) {
    setFormError('')
    if (!employeeId) { setFormError('Select an employee'); return }
    if (!timesValid) {
      setFormError(startTime === endTime ? 'Start and end time cannot be the same' : 'End time must be after start time')
      return
    }

    setSaving(true)
    const payload = {
      company_id: companyId,
      employee_id: employeeId,
      shift_type: shiftType,
      template_id: isOff || useCustom ? null : (templateId || null),
      shift_date: shiftDate,
      start_at: startAt,
      end_at: endAt,
      break_minutes: isOff ? 0 : (Number(breakMinutes) || 0),
      notes: notes.trim() || null,
      status: publish ? 'published' : (isNew ? 'scheduled' : shift.status),
      ...(publish ? { published_at: new Date().toISOString() } : {}),
    }

    const { error } = isNew
      ? await supabase.from('shifts').insert({ ...payload, created_by: currentEmployeeId })
      : await supabase.from('shifts').update(payload).eq('id', shift.id)

    setSaving(false)
    if (error) {
      // Always log the unmapped original — the friendly text is for the user,
      // the console entry is for whoever has to explain it.
      console.error('[ShiftModal] save failed', error)
      if (isKnownValidationError(error.message)) {
        setFormError(error.message)
      } else {
        // "Try again" is the wrong advice for a constraint violation: the same
        // row will be refused every time.
        setFormError(
          constraintMessage(error) ??
          'Something went wrong saving this shift. Please try again.'
        )
      }
      return
    }
    showToast('success', publish ? 'Shift published' : isNew ? 'Shift saved as draft' : 'Shift updated')
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">
            {isNew ? (isOff ? 'Add Day Off' : 'Add Shift') : (isOff ? 'Edit Day Off' : 'Edit Shift')}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        </div>

        {loadingRefs ? (
          <div className="flex justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Employee</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={SELECT}>
                <option value="" disabled>Select an employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}{e.job_title ? ` — ${e.job_title}` : ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Date</label>
              <input type="date" value={shiftDate} onChange={(e) => setShiftDate(e.target.value)} className={INPUT} />
            </div>

            <div className="flex gap-1 p-1 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
              <button
                type="button"
                onClick={() => setShiftType('work')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${!isOff ? 'bg-white dark:bg-[#1E1E1E] text-[#00D4A0] shadow-sm' : 'text-[#666666] dark:text-[#A0A0A0]'}`}
              >
                Work Shift
              </button>
              <button
                type="button"
                onClick={() => setShiftType('off')}
                className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${isOff ? 'bg-white dark:bg-[#1E1E1E] text-[#00D4A0] shadow-sm' : 'text-[#666666] dark:text-[#A0A0A0]'}`}
              >
                Day Off
              </button>
            </div>

            {isOff ? (
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                Marks this employee's entire day as scheduled rest. If a work shift already exists that day, saving will fail with an overlap error.
              </p>
            ) : (
              <>
                <div className="flex gap-1 p-1 rounded-lg bg-[#F5F5F0] dark:bg-[#252525]">
                  <button
                    type="button"
                    onClick={() => setUseCustom(false)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${!useCustom ? 'bg-white dark:bg-[#1E1E1E] text-[#00D4A0] shadow-sm' : 'text-[#666666] dark:text-[#A0A0A0]'}`}
                  >
                    Use Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseCustom(true)}
                    className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors ${useCustom ? 'bg-white dark:bg-[#1E1E1E] text-[#00D4A0] shadow-sm' : 'text-[#666666] dark:text-[#A0A0A0]'}`}
                  >
                    Custom Hours
                  </button>
                </div>

                {!useCustom && (
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Template</label>
                    <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className={SELECT}>
                      <option value="" disabled>Select a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} ({toHM(t.start_time)}–{toHM(t.end_time)})</option>
                      ))}
                    </select>
                    {templates.length === 0 && (
                      <p className="text-xs text-[#AAAAAA] dark:text-[#555555] mt-1">No shift templates yet — use Custom Hours, or add one under Shift Templates.</p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Start Time</label>
                    <input type="time" value={startTime} disabled={!useCustom} onChange={(e) => setStartTime(e.target.value)} className={`${INPUT} disabled:opacity-60`} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">
                      End Time {overnight && startTime !== endTime && <span className="font-normal text-[#00D4A0]">(next day)</span>}
                    </label>
                    <input type="time" value={endTime} disabled={!useCustom} onChange={(e) => setEndTime(e.target.value)} className={`${INPUT} disabled:opacity-60`} />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Break Minutes</label>
                  <input
                    type="number" min={0} max={240}
                    value={breakMinutes}
                    disabled={!useCustom}
                    onChange={(e) => setBreakMinutes(e.target.value)}
                    className={`${INPUT} disabled:opacity-60`}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={1000}
                className={`${INPUT} resize-none`}
              />
            </div>

            {restWarning && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FF8C42]/10 border border-[#FF8C42]/20 text-sm text-[#FF8C42]">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {restWarning}
              </div>
            )}

            {formError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {formError}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              {isDraft ? (
                <>
                  <button
                    type="button"
                    onClick={() => save(false)}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:border-[#00D4A0]/40 disabled:opacity-60 transition-colors"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    onClick={() => save(true)}
                    disabled={saving}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                  >
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Save & Publish
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => save(false)}
                  disabled={saving}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Changes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

