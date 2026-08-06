import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Hash, Briefcase, Building2, CalendarDays, AlignLeft, Camera,
  Shield, Download, Loader2, BookOpen, Database, MapPin, Fingerprint, Mail,
  Send,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import Toast, { useToast } from '../components/Toast'
import DocumentTypeGrid from '../components/documents/DocumentTypeGrid'

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

const POLICY_VERSION = '1.0'

const CONSENT_TYPES = [
  { value: 'employee_handbook',  label: 'Employee Handbook',  icon: BookOpen },
  { value: 'privacy_policy',     label: 'Privacy Policy',     icon: Shield },
  { value: 'data_processing',    label: 'Data Processing',    icon: Database },
  { value: 'application_terms',  label: 'Application Terms',  icon: AlignLeft },
  { value: 'gps_tracking',       label: 'GPS Tracking',       icon: MapPin },
  { value: 'biometric_data',     label: 'Biometric Data',     icon: Fingerprint },
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
  completed:   { label: 'Completed',   cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  rejected:    { label: 'Rejected',    cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}

// Privacy & Data — session 42, DSR form restored + real contact email in a
// follow-up fix (migration 45). Ported from Settings.jsx's old "My Privacy &
// Data" tab, which became unreachable for role 'employee' once Settings
// itself was gated off for that role. /profile is the single canonical home
// for this for EVERY role — Settings' own copy was removed rather than kept
// as a duplicate. "Submit a Data Request" reinserts into `data_subject_requests`
// with the exact same shape the old tab used, so HR's existing "Data
// Requests" queue in Settings.jsx needs no changes to pick these back up.
function PrivacyDataSection({ employee, companyId, company, role, showToast }) {
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

  return (
    <div className="space-y-6">
      <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Privacy & Data</h2>

      {/* Download My Data */}
      <section className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Download My Data</h3>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 max-w-md">
              Export everything BYOND HR holds on you as a JSON file — your Right to Access under PDPL Art. 13.
            </p>
          </div>
          <button
            onClick={downloadMyData}
            disabled={exporting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors shrink-0"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {exporting ? 'Preparing export…' : 'Download My Data'}
          </button>
        </div>
      </section>

      {/* Consent Management */}
      <section className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">Consent Management</h3>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
          Control what you've consented to. Every change is recorded permanently — nothing is overwritten.
        </p>
        {consentLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[#00D4A0]" />
          </div>
        ) : (
          <div className="space-y-2">
            {CONSENT_TYPES.map(({ value, label, icon: Icon }) => {
              const row   = consents[value]
              const given = row?.consented === true
              const busy  = togglingType === value
              return (
                <div
                  key={value}
                  className="flex items-center gap-4 p-4 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] flex-wrap"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
                    <Icon size={15} className="text-[#00D4A0]" />
                  </div>
                  <div className="flex-1 min-w-45">
                    <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{label}</p>
                    <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                      {row
                        ? given
                          ? `Consented on ${fmtConsentDate(row.consented_at)}`
                          : `Withdrawn on ${fmtConsentDate(row.withdrawn_at)}`
                        : 'No decision recorded yet'}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                    given
                      ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                      : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
                  }`}>
                    {given ? 'Given' : row ? 'Withdrawn' : 'Not decided'}
                  </span>
                  {canWrite && (
                    <button
                      onClick={() => toggleConsent(value, !given)}
                      disabled={busy}
                      className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 disabled:opacity-60 ${
                        given
                          ? 'text-[#FF4D4D] border border-[#FF4D4D]/30 hover:bg-[#FF4D4D]/10'
                          : 'text-white bg-[#00D4A0] hover:bg-[#00B589]'
                      }`}
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : given ? 'Withdraw' : 'Give Consent'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Submit a Data Request — restored session 42-follow-up, same insert
          shape as the old Settings.jsx MyPrivacyTab so HR's existing Data
          Requests queue picks these up with no changes on that end. */}
      <section className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">Submit a Data Request</h3>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
          Request rectification, erasure, portability, restriction, or an objection to how your data is used. We respond within 30 days.
        </p>
        {canWrite && (
        <form onSubmit={submitRequest} className="space-y-4 max-w-md mb-6">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Request Type</label>
            <select
              value={reqType}
              onChange={e => setReqType(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
            >
              {REQUEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
              Details <span className="text-[#666666] dark:text-[#A0A0A0] font-normal">(optional)</span>
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
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {reqSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {reqSubmitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
        )}

        {/* Own submitted requests — makes the 30-day SLA visible to the requester */}
        {requestsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
          </div>
        ) : myRequests.length > 0 && (
          <div className="border-t border-[#E8E8E8] dark:border-[#2A2A2A] pt-5">
            <h4 className="text-sm font-semibold text-[#1A1A1A] dark:text-white mb-3">Your Requests</h4>
            <div className="space-y-2">
              {myRequests.map(r => {
                const meta = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending
                const overdue = r.due_date && new Date(r.due_date) < new Date() && !['completed', 'rejected'].includes(r.status)
                return (
                  <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#A78BFA]/10 text-[#A78BFA] whitespace-nowrap">
                      {RT[r.request_type]?.label ?? r.request_type}
                    </span>
                    <span className="text-xs text-[#666666] dark:text-[#A0A0A0] flex-1 min-w-35">
                      Requested {fmtConsentDate(r.requested_at)}
                      {r.due_date && <> · Due {fmtConsentDate(r.due_date)}{overdue && <span className="ml-1 font-bold uppercase text-[#FF4D4D]">Overdue</span>}</>}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold shrink-0 ${meta.cls}`}>{meta.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* Contact line — only shown once a tenant has actually configured a
          privacy contact (migration 45); the in-app form above is the
          primary path regardless, so this is never load-bearing. */}
      {privacyEmail && (
        <p className="flex items-center gap-2 text-xs text-[#666666] dark:text-[#A0A0A0]">
          <Mail size={13} className="shrink-0" />
          Or contact{' '}
          <a href={`mailto:${privacyEmail}`} className="text-[#00D4A0] hover:underline">{privacyEmail}</a>{' '}
          directly, per the employee handbook.
        </p>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-b-0">
      <div className="w-8 h-8 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={14} className="text-[#00D4A0]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0]">{label}</p>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white mt-0.5 wrap-break-word">{value || '—'}</p>
      </div>
    </div>
  )
}

// My Profile (/profile, all authenticated roles) — read-only own-details
// page, added migration 42 alongside 'employee' losing Employees-list and
// Settings access. Profile photo upload was explicitly not built this
// round ("use initials avatar for now and flag it") — the camera badge
// below is disabled and just links to Known Gaps in spirit, not function.
export default function Profile() {
  const employee  = useAuthStore(s => s.employee)
  const companyId = useAuthStore(s => s.companyId)
  const company   = useAuthStore(s => s.company)
  const role      = useAuthStore(s => s.role)
  const [photoNotice, setPhotoNotice] = useState(false)
  const { toast, showToast } = useToast()

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="max-w-4xl">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">My Profile</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">Your own employment details and documents</p>
            </div>

            {!employee ? (
              <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
                <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
                  <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                    Your login is not linked to an employee record. Contact HR to complete setup.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Identity card */}
                  <div className="lg:col-span-1">
                    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative">
                          <div className="w-20 h-20 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-2xl font-bold">
                            {employee.full_name?.[0]?.toUpperCase()}
                          </div>
                          <button
                            onClick={() => setPhotoNotice(true)}
                            title="Photo upload isn't available yet"
                            className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] cursor-not-allowed"
                          >
                            <Camera size={12} />
                          </button>
                        </div>
                        <div className="text-center">
                          <h2 className="text-lg font-bold text-[#1A1A1A] dark:text-white">{employee.full_name}</h2>
                          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-0.5">{employee.job_title || 'No title set'}</p>
                          {employee.emp_code && (
                            <span className="inline-flex items-center gap-1 mt-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#00D4A0]/10 text-[#00D4A0]">
                              <Hash size={11} />{employee.emp_code}
                            </span>
                          )}
                        </div>
                        {photoNotice && (
                          <p className="text-xs text-[#AAAAAA] dark:text-[#555555] text-center">
                            Photo uploads aren't available yet — using your initials for now.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="lg:col-span-2 space-y-6">
                    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                      <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">Employment</h3>
                      <InfoRow icon={Hash} label="Employee Code" value={employee.emp_code} />
                      <InfoRow icon={Briefcase} label="Job Title" value={employee.job_title} />
                      <InfoRow icon={Building2} label="Department" value={employee.departments?.name} />
                      <InfoRow icon={CalendarDays} label="Hire Date" value={formatDate(employee.hire_date)} />
                    </div>

                    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                      <div className="flex items-center gap-2.5 mb-3">
                        <AlignLeft size={15} className="text-[#00D4A0]" />
                        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Job Description</h3>
                      </div>
                      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] whitespace-pre-wrap">
                        {employee.job_description?.trim() || 'No job description set yet — ask HR to add one.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* My Documents */}
                <div>
                  <h2 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">My Documents</h2>
                  <DocumentTypeGrid
                    scope="employee"
                    employeeId={employee.id}
                    companyId={companyId}
                    currentEmployeeId={employee.id}
                    canManage={false}
                    showToast={showToast}
                  />
                </div>

                <PrivacyDataSection
                  employee={employee}
                  companyId={companyId}
                  company={company}
                  role={role}
                  showToast={showToast}
                />
              </div>
            )}
          </div>
        </main>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
