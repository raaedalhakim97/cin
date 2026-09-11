import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, Send } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import Toast, { useToast } from '../components/Toast'
import DocumentTypeGrid from '../components/documents/DocumentTypeGrid'
import ChangePasswordCard from '../components/ChangePasswordCard'
import IdentityBand from '../components/profile/IdentityBand'

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// Returns local YYYY-MM-DD — avoids UTC-shift bugs, same helper every other
// page in this codebase defines locally rather than sharing.
function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtConsentDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Whole months, counted the way a person counts them: the anniversary has to have passed.
// Someone hired on the 20th is not "1 month" on the 5th of the following month.
//
// Returns null rather than a zero for a missing hire date, and for a hire date in the
// future — which HR can legitimately enter for someone who has signed but not started. A
// tenure of "0 mo" on a profile would read as a statement about the person rather than
// about the absence of a date.
function tenureFrom(hireDate) {
  if (!hireDate) return null
  const start = new Date(`${hireDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return null

  const now = new Date()
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) months -= 1
  if (months < 0) return null

  const years = Math.floor(months / 12)
  const rest = months % 12
  const label =
    months === 0 ? 'Under a month'
      : years === 0 ? `${rest} mo`
        : rest === 0 ? `${years} yr`
          : `${years} yr ${rest} mo`

  return {
    label,
    since: `since ${start.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
  }
}

const CLASSIFICATION_LABEL = {
  full_time_permanent: 'Full-Time Permanent',
  full_time_contract:  'Full-Time Contract',
  part_time:           'Part-Time',
  intern:              'Intern',
  contractor:          'Contractor',
}

const POLICY_VERSION = '1.0'

const CONSENT_TYPES = [
  { value: 'employee_handbook',  label: 'Employee Handbook' },
  { value: 'privacy_policy',     label: 'Privacy Policy' },
  { value: 'data_processing',    label: 'Data Processing' },
  { value: 'application_terms',  label: 'Application Terms' },
  { value: 'gps_tracking',       label: 'GPS Tracking' },
  { value: 'biometric_data',     label: 'Biometric Data' },
]

// Matches Settings.jsx's DataRequestsTab REQUEST_TYPES minus 'access' —
// Download My Data already covers Access (PDPL Art. 13), so it's not
// offered again here, same as the pre-session-42 form.
const REQUEST_TYPES = [
  { value: 'rectification',  label: 'Rectification' },
  { value: 'erasure',        label: 'Erasure' },
  { value: 'portability',    label: 'Portability' },
  { value: 'restriction',    label: 'Restriction' },
  { value: 'objection',      label: 'Objection' },
]
const RT = Object.fromEntries(REQUEST_TYPES.map(t => [t.value, t]))

const REQUEST_STATUS = {
  pending:     { label: 'Pending',     cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  in_progress: { label: 'In Progress', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  completed:   { label: 'Completed',   cls: 'bg-[#00D4A0]/10 text-[#00806A] dark:text-[#00D4A0]' },
  rejected:    { label: 'Rejected',    cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}

const card = 'p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]'

// One fact, label over value. Replaces the icon-chip InfoRow this page used to use.
//
// Eleven mint icon chips down a single column stopped meaning anything — an accent that
// marks everything marks nothing, and the chips took the horizontal room the values
// needed. The label carries the meaning here, which is what a label is for.
function Pair({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#666666] dark:text-[#A0A0A0]">
        {label}
      </p>
      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white mt-1 wrap-break-word">
        {value || '—'}
      </p>
    </div>
  )
}

// The section rule that separates "your record" from "your rights".
//
// Privacy and Data used to be three more full-width white cards, identical to the ones
// above them, which gave the legal region more visual weight than the employee's own
// employment record. A titled rule costs no height and says "different kind of thing".
function RegionHeading({ title, aside }) {
  return (
    <div className="flex items-baseline gap-4 mb-4">
      <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white shrink-0">{title}</h2>
      <div className="flex-1 h-px bg-[#E8E8E8] dark:bg-[#2A2A2A]" />
      {aside && (
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0] shrink-0">{aside}</span>
      )}
    </div>
  )
}

// One consent, one control.
//
// The row used to carry a status pill reading "Given" and, immediately beside it, a button
// reading "Withdraw" — two elements for one piece of information, inside a flex-wrap
// container that dropped the button onto its own line at narrow widths. Worse, "Not
// decided" rendered in the same grey as "Withdrawn", so a decision never made looked
// exactly like a decision to refuse. They are not the same thing: one is a gap in the
// record, the other is a right the person exercised.
//
// Now the state is the second line, in words, with its date; the row has exactly one
// control; and "no decision recorded yet" is amber because it is the only state the
// employee is being asked to do something about. Withdraw is a quiet outline rather than a
// red alarm — withdrawing consent is a right, not a mistake, and styling it as damage
// discourages people from exercising it.
function ConsentRow({ label, row, busy, canWrite, onToggle }) {
  const given = row?.consented === true

  const state = busy
    ? { text: 'Saving your decision…', tone: 'muted' }
    : !row
      ? { text: 'No decision recorded yet', tone: 'attention' }
      : given
        ? { text: `Consented on ${fmtConsentDate(row.consented_at)}`, tone: 'muted' }
        : { text: `Withdrawn on ${fmtConsentDate(row.withdrawn_at)}`, tone: 'muted' }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-4 border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{label}</p>
        <p
          className={`text-xs mt-0.5 ${
            state.tone === 'attention'
              ? 'text-[#FF8C42]'
              : 'text-[#666666] dark:text-[#A0A0A0]'
          }`}
        >
          {state.text}
        </p>
      </div>

      {canWrite && (
        <button
          onClick={() => onToggle(!given)}
          disabled={busy}
          // min-w so the label swap during save cannot change the row's height or make the
          // control jump under a finger that is already moving towards it.
          className={`shrink-0 min-w-[124px] min-h-[44px] sm:min-h-0 px-4 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60 ${
            given
              ? 'border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white hover:border-[#00D4A0]/50'
              : 'text-white bg-[#00D4A0] hover:bg-[#00B589]'
          }`}
        >
          {busy ? 'Saving…' : given ? 'Withdraw' : 'Give consent'}
        </button>
      )}
    </div>
  )
}

// Privacy & Data — session 42, DSR form restored + real contact email in a
// follow-up fix (migration 45). Ported from Settings.jsx's old "My Privacy &
// Data" tab, which became unreachable for role 'employee' once Settings
// itself was gated off for that role. /profile is the single canonical home
// for this for EVERY role — Settings' own copy was removed rather than kept
// as a duplicate. "Submit a Data Request" reinserts into `data_subject_requests`
// with the exact same shape the old tab used, so HR's existing "Data
// Requests" queue in Settings.jsx needs no changes to pick these back up.
function PrivacyDataSection({ employee, companyId, company, role, showToast, onConsentSummary }) {
  // Confirmation audit (2026-07-19): consent_records/data_subject_requests
  // INSERT policies were never given a read_only exclusion by migration 46
  // (only feed_comments/feed_reactions/kpi_scores self-eval/leave self-cancel/
  // pdp_actions were) — so this is a frontend-only gate, same treatment as
  // Attendance.jsx/Leave.jsx/KPI.jsx/NewsFeed.jsx/PDPTab.jsx give the other
  // read_only self-service writes. Hide rather than let it fail silently.
  const canWrite = role !== 'read_only'
  const [exporting, setExporting] = useState(false)
  const [consents, setConsents] = useState({})
  const [consentLoading, setConsentLoading] = useState(true)
  const [togglingType, setTogglingType] = useState(null)

  const [reqType, setReqType] = useState('rectification')
  const [reqNotes, setReqNotes] = useState('')
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const [myRequests, setMyRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(true)

  const fetchConsents = useCallback(async () => {
    if (!employee?.id) { setConsentLoading(false); return }
    setConsentLoading(true)
    const { data } = await supabase
      .from('consent_records')
      .select('*')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
    const latest = {}
    ;(data ?? []).forEach(row => {
      if (!latest[row.consent_type]) latest[row.consent_type] = row
    })
    setConsents(latest)
    setConsentLoading(false)
  }, [employee?.id])

  useEffect(() => { fetchConsents() }, [fetchConsents])

  // The identity band's CONSENT fact is this number. Reported up rather than counted
  // again there, so the strip and the rows can never disagree about how many are open.
  useEffect(() => {
    if (consentLoading) return
    onConsentSummary?.({
      total: CONSENT_TYPES.length,
      undecided: CONSENT_TYPES.filter(t => !consents[t.value]).length,
    })
  }, [consents, consentLoading, onConsentSummary])

  const fetchMyRequests = useCallback(async () => {
    if (!employee?.id) { setRequestsLoading(false); return }
    setRequestsLoading(true)
    const { data } = await supabase
      .from('data_subject_requests')
      .select('*')
      .eq('employee_id', employee.id)
      .order('requested_at', { ascending: false })
    setMyRequests(data ?? [])
    setRequestsLoading(false)
  }, [employee?.id])

  useEffect(() => { fetchMyRequests() }, [fetchMyRequests])

  async function submitRequest(e) {
    e.preventDefault()
    if (!employee?.id) return
    setReqSubmitting(true)
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    const { error } = await supabase.from('data_subject_requests').insert({
      company_id:   companyId,
      employee_id:  employee.id,
      request_type: reqType,
      status:       'pending',
      due_date:     dueDate.toISOString(),
      notes:        reqNotes.trim() || null,
    })
    setReqSubmitting(false)
    if (error) {
      console.error('[Profile] submitRequest failed', error)
      showToast('error', 'Something went wrong submitting your request. Please try again.')
      return
    }
    setReqNotes('')
    showToast('success', "Request submitted — we'll respond within 30 days")
    fetchMyRequests()
  }

  async function downloadMyData() {
    if (!employee?.id) return
    setExporting(true)
    const { data, error } = await supabase.rpc('export_employee_data', { p_employee_id: employee.id })
    setExporting(false)
    if (error) {
      console.error('[Profile] downloadMyData failed', error)
      showToast('error', 'Something went wrong preparing your data export. Please try again.')
      return
    }

    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-data-export-${localDateStr(new Date())}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    showToast('success', 'Your data export has downloaded')
  }

  async function toggleConsent(type, give) {
    if (!employee?.id) return
    setTogglingType(type)
    const now = new Date().toISOString()
    const { error } = await supabase.from('consent_records').insert({
      company_id:     companyId,
      employee_id:    employee.id,
      consent_type:   type,
      policy_version: POLICY_VERSION,
      consented:      give,
      consented_at:   give ? now : null,
      withdrawn_at:   give ? null : now,
    })
    setTogglingType(null)
    if (error) {
      console.error('[Profile] toggleConsent failed', error)
      showToast('error', 'Something went wrong updating your consent. Please try again.')
      return
    }
    showToast('success', give ? 'Consent given' : 'Consent withdrawn')
    fetchConsents()
  }

  // Migration 45 — company.privacy_contact_email, nullable, set by
  // super_admin/hr_manager in Settings → Company Settings. NULL until a
  // tenant fills it in; the contact line below is omitted entirely rather
  // than guessing an address, since the in-app form above is the primary
  // path either way.
  const privacyEmail = company?.privacy_contact_email || null
  const undecided = CONSENT_TYPES.filter(t => !consents[t.value]).length

  return (
    <section>
      <RegionHeading title="Privacy and data" aside="Your rights under the PDPL" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left — what you have decided, and what you have asked for */}
        <div className="space-y-6">
          <div className={card}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Consent</h3>
              {!consentLoading && undecided > 0 && (
                <span className="text-xs font-semibold text-[#FF8C42] shrink-0">
                  {undecided} not decided
                </span>
              )}
            </div>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Every change is recorded permanently. Nothing is overwritten.
            </p>

            {consentLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
              </div>
            ) : (
              <div className="mt-4">
                {CONSENT_TYPES.map(({ value, label }) => (
                  <ConsentRow
                    key={value}
                    label={label}
                    row={consents[value]}
                    busy={togglingType === value}
                    canWrite={canWrite}
                    onToggle={(give) => toggleConsent(value, give)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Own submitted requests — makes the 30-day SLA visible to the requester */}
          {requestsLoading ? (
            <div className={`${card} flex justify-center`}>
              <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
            </div>
          ) : myRequests.length > 0 && (
            <div className={card}>
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Your requests</h3>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 mb-4">
                We respond within 30 days of the request date.
              </p>
              <div className="space-y-2">
                {myRequests.map(r => {
                  const meta = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending
                  const overdue = r.due_date && new Date(r.due_date) < new Date() && !['completed', 'rejected'].includes(r.status)
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] flex-wrap"
                    >
                      <div className="flex-1 min-w-35">
                        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                          {RT[r.request_type]?.label ?? r.request_type}
                        </p>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                          Requested {fmtConsentDate(r.requested_at)}
                          {r.due_date && <> · due {fmtConsentDate(r.due_date)}</>}
                          {overdue && <span className="ml-1 font-bold uppercase text-[#FF4D4D]">Overdue</span>}
                        </p>
                      </div>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right — the two things you can start from here */}
        <div className="space-y-6">
          <div className={card}>
            <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Download my data</h3>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">
              Everything BYOND HR holds on you, as a JSON file. Your Right to Access under PDPL Art. 13.
            </p>
            <button
              onClick={downloadMyData}
              disabled={exporting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              {exporting ? 'Preparing export…' : 'Download my data'}
            </button>
          </div>

          {canWrite && (
            <div className={card}>
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Submit a request</h3>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">
                Rectification, erasure, portability, restriction, or an objection to how your data is used.
              </p>
              <form onSubmit={submitRequest} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#666666] dark:text-[#A0A0A0] mb-1.5">
                    Request type
                  </label>
                  <select
                    value={reqType}
                    onChange={e => setReqType(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
                  >
                    {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#666666] dark:text-[#A0A0A0] mb-1.5">
                    Details <span className="normal-case tracking-normal font-normal">(optional)</span>
                  </label>
                  <textarea
                    rows={3}
                    value={reqNotes}
                    onChange={e => setReqNotes(e.target.value)}
                    placeholder="Any additional detail about your request…"
                    className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] focus:outline-none focus:border-[#00D4A0] transition-colors resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={reqSubmitting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
                >
                  {reqSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {reqSubmitting ? 'Submitting…' : 'Submit request'}
                </button>
              </form>
            </div>
          )}

          {/* Contact line — only shown once a tenant has actually configured a
              privacy contact (migration 45); the in-app form above is the
              primary path regardless, so this is never load-bearing. */}
          {privacyEmail && (
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              Or contact{' '}
              <a href={`mailto:${privacyEmail}`} className="text-[#00806A] dark:text-[#00D4A0] hover:underline">
                {privacyEmail}
              </a>{' '}
              directly, per the employee handbook.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// The only hard failure this page has: a login with no employee record.
//
// It used to render as a lone orange box on an otherwise empty page, which reads like a
// crash rather than a setup step. The page header stays, the box says what is actually
// true, and the last line answers the question the person is about to ask — whether their
// data rights are affected. They are not; those need an employee id to attach to, which is
// exactly what is missing.
//
// No buttons. An unlinked login has no company_id, so there is no HR address to reach and
// nothing to link to — and a control that looks clickable and goes nowhere turns "HR has
// a field to fill in" into "the app is broken too".
function NotLinked() {
  return (
    <div className="max-w-2xl">
      <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20">
        <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-[#FF8C42]">
            Your login is not linked to an employee record yet
          </p>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1.5">
            Until HR links it, this page has nothing to show, and your attendance, leave and
            payslips will not appear either. Nothing is lost — the link is a one-field change
            on their side.
          </p>
        </div>
      </div>
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-3">
        Your data rights do not depend on this link. Download my data and Submit a request
        become available once the record exists — they need an employee id to attach to,
        which is what is missing.
      </p>
    </div>
  )
}

// My Profile (/profile, all authenticated roles) — read-only own-details
// page, added migration 42 alongside 'employee' losing Employees-list and
// Settings access. Profile photo upload was explicitly not built this
// round; the identity band uses the initial, and the camera affordance was
// removed rather than left disabled — a button that has never worked is
// worse than its absence.
export default function Profile() {
  const employee  = useAuthStore(s => s.employee)
  const companyId = useAuthStore(s => s.companyId)
  const company   = useAuthStore(s => s.company)
  const role      = useAuthStore(s => s.role)
  const { toast, showToast } = useToast()

  const [manager, setManager] = useState(null)
  const [rating, setRating] = useState(null)
  const [docSummary, setDocSummary] = useState(null)
  const [consentSummary, setConsentSummary] = useState(null)

  // Who this person reports to. emp_select gives role 'employee' exactly one readable row —
  // their own — so the manager's name cannot be selected directly; my_manager() (migration
  // 58) answers that one question about the caller and nothing else. Returns no row when HR
  // has set neither a named manager nor a department head, and the sub-line is then absent.
  // No reset on the way out: when employee goes away the page renders NotLinked and the
  // band is unmounted, so there is nothing left to read a stale name.
  useEffect(() => {
    if (!employee?.id) return
    let cancelled = false
    supabase.rpc('my_manager').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.error('[Profile] my_manager failed', error)
        setManager(null)
        return
      }
      setManager(Array.isArray(data) ? data[0] ?? null : data ?? null)
    })
    return () => { cancelled = true }
  }, [employee?.id])

  // The performance chip. Their real rating from the most recent PUBLISHED review, and
  // nothing at all when they have none — which today is every employee, because no cycle
  // has closed with enough coverage to earn one. kpi_rating_label withholds a rating below
  // 50% coverage on purpose; showing a flattering chip to everybody regardless would undo
  // the one guarantee the performance system makes.
  useEffect(() => {
    if (!employee?.id) return
    let cancelled = false
    supabase
      .from('kpi_reviews')
      .select('rating, kpi_review_cycles!kpi_reviews_cycle_id_fkey(status, period_year, period_quarter)')
      .eq('employee_id', employee.id)
      .not('rating', 'is', null)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('[Profile] rating fetch failed', error)
          setRating(null)
          return
        }
        const published = (data ?? [])
          .filter(r => r.kpi_review_cycles?.status === 'published')
          .sort((a, b) =>
            (b.kpi_review_cycles.period_year - a.kpi_review_cycles.period_year) ||
            (b.kpi_review_cycles.period_quarter - a.kpi_review_cycles.period_quarter))
        setRating(published[0]?.rating ?? null)
      })
    return () => { cancelled = true }
  }, [employee?.id])

  const handleDocSummary = useCallback((s) => setDocSummary(s), [])
  const handleConsentSummary = useCallback((s) => setConsentSummary(s), [])

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {/* Was max-w-4xl. 896px beside a 240px sidebar is what forced a consent row to
              fit a label, a date, a status pill and a button onto one wrapping line. The
              page uses the width it has. */}
          <div className="max-w-6xl">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">My Profile</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                Your own employment details, documents and data rights
              </p>
            </div>

            {!employee ? (
              <NotLinked />
            ) : (
              <div className="space-y-8">
                <IdentityBand
                  employee={employee}
                  manager={manager}
                  tenure={tenureFrom(employee.hire_date)}
                  documents={docSummary}
                  consent={consentSummary}
                  rating={rating}
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  <div className={card}>
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-5">
                      Employment
                    </h3>
                    {/* Employee code is deliberately not here. It is on the identity band
                        above, and printing it twice on one page was one of the things
                        that made this screen feel padded. */}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                      <Pair label="Job title" value={employee.job_title} />
                      <Pair label="Department" value={employee.departments?.name} />
                      <Pair label="Hire date" value={formatDate(employee.hire_date)} />
                      <Pair
                        label="Classification"
                        value={CLASSIFICATION_LABEL[employee.classification]}
                      />
                    </div>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-6 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                      HR keeps these fields. If something here is wrong, use Rectification below.
                    </p>
                  </div>

                  <div className={card}>
                    <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-3">
                      Job description
                    </h3>
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] whitespace-pre-wrap">
                      {employee.job_description?.trim() || 'No job description set yet — ask HR to add one.'}
                    </p>
                  </div>
                </div>

                <section>
                  <RegionHeading
                    title="My documents"
                    aside="HR uploads these. You can view and download."
                  />
                  <DocumentTypeGrid
                    scope="employee"
                    employeeId={employee.id}
                    companyId={companyId}
                    currentEmployeeId={employee.id}
                    canManage={false}
                    variant="compact"
                    onSummary={handleDocSummary}
                    showToast={showToast}
                  />
                </section>

                <PrivacyDataSection
                  employee={employee}
                  companyId={companyId}
                  company={company}
                  role={role}
                  showToast={showToast}
                  onConsentSummary={handleConsentSummary}
                />
              </div>
            )}

            {/* Outside the employee check on purpose — an account with no linked
                employee record still has a password, and is the likeliest one to
                need changing it. */}
            <div className="mt-8">
              <ChangePasswordCard showToast={showToast} />
            </div>
          </div>
        </main>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
