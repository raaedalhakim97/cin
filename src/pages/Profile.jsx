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
import RegionHeading from '../components/profile/RegionHeading'

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

function fmtShortDate(iso) {
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
  rejected:    { label: 'Rejected',    cls: 'bg-danger/10 text-danger' },
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

// Privacy & Data — session 42, DSR form restored + real contact email in a
// follow-up fix (migration 45). Ported from Settings.jsx's old "My Privacy &
// Data" tab, which became unreachable for role 'employee' once Settings
// itself was gated off for that role. /profile is the single canonical home
// for this for EVERY role — Settings' own copy was removed rather than kept
// as a duplicate. "Submit a Data Request" reinserts into `data_subject_requests`
// with the exact same shape the old tab used, so HR's existing "Data
// Requests" queue in Settings.jsx needs no changes to pick these back up.
function PrivacyDataSection({ employee, companyId, company, role, showToast }) {
  // Confirmation audit (2026-07-19): the data_subject_requests
  // INSERT policies were never given a read_only exclusion by migration 46
  // (only feed_comments/feed_reactions/kpi_scores self-eval/leave self-cancel/
  // pdp_actions were) — so this is a frontend-only gate, same treatment as
  // Attendance.jsx/Leave.jsx/KPI.jsx/NewsFeed.jsx/PDPTab.jsx give the other
  // read_only self-service writes. Hide rather than let it fail silently.
  const canWrite = role !== 'read_only'
  const [exporting, setExporting] = useState(false)

  const [reqType, setReqType] = useState('rectification')
  const [reqNotes, setReqNotes] = useState('')
  const [reqSubmitting, setReqSubmitting] = useState(false)
  const [myRequests, setMyRequests] = useState([])
  const [requestsLoading, setRequestsLoading] = useState(true)

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

  // Migration 45 — company.privacy_contact_email, nullable, set by
  // super_admin/hr_manager in Settings → Company Settings. NULL until a
  // tenant fills it in; the contact line below is omitted entirely rather
  // than guessing an address, since the in-app form above is the primary
  // path either way.
  const privacyEmail = company?.privacy_contact_email || null

  return (
    <section>
      <RegionHeading title="Privacy and data" aside="Your rights under the PDPL" />

      {/* Two actions side by side, then the record of what you asked for underneath.
          This was a left column of consent rows against a right column of actions until
          consent came out; leaving the grid as it was would have put one card opposite an
          empty half. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <div className={card}>
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Download my data</h3>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1 mb-5">
            Everything BYOND HR holds on you, as a JSON file. Your Right to Access under PDPL Art. 13.
          </p>
          <button
            onClick={downloadMyData}
            disabled={exporting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
              >
                {reqSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {reqSubmitting ? 'Submitting…' : 'Submit request'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* What you have asked for, full width under the two actions. */}
      {requestsLoading ? (
        <div className={`${card} flex justify-center mt-6`}>
          <Loader2 size={18} className="animate-spin text-[#00D4A0]" />
        </div>
      ) : myRequests.length > 0 && (
        <div className={`${card} mt-6`}>
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
                      Requested {fmtShortDate(r.requested_at)}
                      {r.due_date && <> · due {fmtShortDate(r.due_date)}</>}
                      {overdue && <span className="ml-1 font-bold uppercase text-danger">Overdue</span>}
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

      {/* Contact line — only shown once a tenant has actually configured a
          privacy contact (migration 45); the in-app form above is the
          primary path regardless, so this is never load-bearing. */}
      {privacyEmail && (
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-6">
          Or contact{' '}
          <a href={`mailto:${privacyEmail}`} className="text-[#00806A] dark:text-[#00D4A0] hover:underline">
            {privacyEmail}
          </a>{' '}
          directly, per the employee handbook.
        </p>
      )}
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
  const [docSummary, setDocSummary] = useState(null)

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

  // No rating is fetched here, deliberately. The band states no performance verdict — the
  // intro puts the person inside the O and the ring stays, which is the whole of it. That
  // also means this page makes one fewer query and holds no opinion it would have to
  // defend: /kpi is where a review is read, in the context that explains it.

  // Who may write hr_documents, matching the policy rather than guessing: super_admin,
  // hr_manager and admin. This page used to pass false unconditionally, which meant the
  // owner of the company could not add her own passport on her own profile while being
  // able to add it from the employee's record two screens away. EmployeeDetail has always
  // passed exactly this expression; /profile was the odd one out.
  //
  // An ordinary employee is still false, and that is a database rule, not a UI choice —
  // hr_documents_write does not list them. See the note in Documents.jsx before widening
  // it: this catalogue includes Warning Letter and Resignation Letter.
  const canManageDocs = role === 'super_admin' || role === 'hr_manager' || role === 'admin'

  const handleDocSummary = useCallback((s) => setDocSummary(s), [])

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
                  companyId={companyId}
                  showToast={showToast}
                  manager={manager}
                  tenure={tenureFrom(employee.hire_date)}
                  documents={docSummary}
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
                    aside={canManageDocs
                      ? 'You can upload, replace and download these.'
                      : 'HR uploads these. You can view and download.'}
                  />
                  <DocumentTypeGrid
                    scope="employee"
                    employeeId={employee.id}
                    companyId={companyId}
                    currentEmployeeId={employee.id}
                    canManage={canManageDocs}
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
