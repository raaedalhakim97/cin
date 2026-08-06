import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  CalendarDays,
  Building2,
  Briefcase,
  Phone,
  Mail,
  CreditCard,
  Shield,
  ShieldAlert,
  CalendarCheck,
  CalendarOff,
  BarChart3,
  Loader2,
  AlertTriangle,
  Gift,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Trash2,
  Check,
  X,
  Newspaper,
  FileText,
  Hash,
  ClipboardList,
  CheckCircle2,
  XCircle,
  Copy,
  Send,
  AlignLeft,
  Target,
  MapPin,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { maskBankAccount, maskNationalId, maskSalary } from '../utils/security'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import { SkeletonBlock, SkeletonRow } from '../components/Skeleton'
import Toast, { useToast } from '../components/Toast'
import DocumentTypeGrid from '../components/documents/DocumentTypeGrid'
import { INVITE_ROLE_OPTIONS, generateEmployeeInvite, inviteLinkFor } from '../utils/invite'

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'profile',    label: 'Profile',    icon: User },
  { key: 'attendance', label: 'Attendance', icon: CalendarCheck },
  { key: 'leave',      label: 'Leave',      icon: CalendarOff },
  { key: 'kpi',        label: 'KPI',        icon: BarChart3 },
  { key: 'payroll',    label: 'Payroll',    icon: CreditCard },
  { key: 'documents',  label: 'Documents',  icon: FileText },
]

const STATUS_STYLES = {
  invited:    'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  active:     'bg-[#00D4A0]/10 text-[#00D4A0]',
  on_leave:   'bg-[#FF8C42]/10 text-[#FF8C42]',
  suspended:  'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  terminated: 'bg-[#555555]/20 text-[#A0A0A0]',
}

const CLASSIFICATION_LABEL = {
  full_time_permanent: 'Full-Time Permanent',
  full_time_contract:  'Full-Time Contract',
  part_time:           'Part-Time',
  intern:              'Intern',
  contractor:          'Contractor',
}

const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Attendance — mirrors Attendance.jsx's STATUS_META
const ATT_STATUS_META = {
  present:             { label: 'Present',                dot: 'bg-[#00D4A0]', cell: 'bg-[#00D4A0]/10 dark:bg-[#00D4A0]/20' },
  late_minor:          { label: 'Late (≤30 min)',         dot: 'bg-[#FF8C42]', cell: 'bg-[#FF8C42]/10 dark:bg-[#FF8C42]/15' },
  late_moderate:       { label: 'Late (≤60 min)',         dot: 'bg-[#FF8C42]', cell: 'bg-[#FF8C42]/15 dark:bg-[#FF8C42]/20' },
  late_major:          { label: 'Late (>60 min)',         dot: 'bg-[#FF8C42]', cell: 'bg-[#FF8C42]/20 dark:bg-[#FF8C42]/25' },
  absent_approved:     { label: 'Absent (Approved)',      dot: 'bg-[#4D9FFF]', cell: 'bg-[#4D9FFF]/10 dark:bg-[#4D9FFF]/15' },
  absent_unauthorized: { label: 'Absent (Unauthorized)',  dot: 'bg-[#FF4D4D]', cell: 'bg-[#FF4D4D]/10 dark:bg-[#FF4D4D]/15' },
}

// Leave — mirrors Leave.jsx's LEAVE_TYPES / STATUS_META
const LEAVE_TYPES = [
  { value: 'annual',      label: 'Annual Leave',      cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  { value: 'sick',        label: 'Sick Leave',        cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  { value: 'emergency',   label: 'Emergency Leave',   cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  { value: 'marriage',    label: 'Marriage Leave',    cls: 'bg-[#9B5DE5]/10 text-[#9B5DE5]' },
  { value: 'paternity',   label: 'Paternity Leave',   cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  { value: 'maternity',   label: 'Maternity Leave',   cls: 'bg-[#F15BB5]/10 text-[#F15BB5]' },
  { value: 'hajj',        label: 'Hajj Leave',        cls: 'bg-[#FEE440]/15 text-[#A89200]' },
  { value: 'bereavement', label: 'Bereavement Leave', cls: 'bg-[#A0A0A0]/10 text-[#A0A0A0]' },
  { value: 'study',       label: 'Study Leave',       cls: 'bg-[#00BBF9]/10 text-[#00BBF9]' },
]
const LT = Object.fromEntries(LEAVE_TYPES.map(t => [t.value, t]))

const LEAVE_STATUS_META = {
  pending:   { label: 'Pending',   cls: 'bg-[#FEE440]/15 text-[#A89200] dark:text-[#FEE440]' },
  approved:  { label: 'Approved',  cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  rejected:  { label: 'Rejected',  cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  cancelled: { label: 'Cancelled', cls: 'bg-[#A0A0A0]/10 text-[#A0A0A0]' },
}

// KPI — mirrors KPI.jsx's COMPONENTS / RATING_META
const KPI_COMPONENTS = [
  { key: 'attendance_score',  label: 'Attendance',         weight: 30 },
  { key: 'behavior_score',    label: 'Behavior',           weight: 25 },
  { key: 'achievement_score', label: 'Achievement',        weight: 20 },
  { key: 'manager_score',     label: 'Manager Evaluation', weight: 15 },
  { key: 'self_score',        label: 'Self Evaluation',    weight: 10 },
]
const RATING_META = {
  'Exceptional':        { cls: 'bg-[#A78BFA]/10 text-[#A78BFA]', hex: '#A78BFA' },
  'High Performer':     { cls: 'bg-[#00D4A0]/10 text-[#00D4A0]', hex: '#00D4A0' },
  'Meets Expectations': { cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]', hex: '#4D9FFF' },
  'Needs Improvement':  { cls: 'bg-[#FF8C42]/10 text-[#FF8C42]', hex: '#FF8C42' },
  'Unsatisfactory':     { cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]', hex: '#FF4D4D' },
}
const NOT_RATED_META = { cls: 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]', hex: '#A0A0A0' }
function getRatingMeta(rating) {
  return RATING_META[rating] ?? NOT_RATED_META
}

// Payroll — mirrors Payroll.jsx's RUN_STATUS
const PAYROLL_STATUS = {
  draft:    { label: 'Draft',    cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  approved: { label: 'Approved', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  paid:     { label: 'Paid',     cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  })
}

function formatShortDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Returns local YYYY-MM-DD — avoids UTC-shift bugs
function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtHours(h) {
  if (h <= 0) return '0h'
  const hrs = Math.floor(h)
  const min = Math.round((h - hrs) * 60)
  return min === 0 ? `${hrs}h` : `${hrs}h ${min}m`
}

function periodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeGross(row) {
  return (
    Number(row.basic_salary || 0) +
    Number(row.housing_allowance || 0) +
    Number(row.transport_allowance || 0) +
    Number(row.other_allowance || 0) +
    Number(row.overtime_pay || 0) +
    Number(row.performance_bonus || 0)
  )
}

function computeNet(gross, deductions) {
  return gross - Number(deductions || 0)
}

// ─── Shared micro-components ──────────────────────────────────────────────────

function TabSpinner() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className="h-16" />)}
      </div>
      <SkeletonBlock className="h-56" />
    </div>
  )
}

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center py-14 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
        <Icon size={22} className="text-[#00D4A0]" />
      </div>
      <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{title}</p>
      {subtitle && <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">{subtitle}</p>}
    </div>
  )
}

function RevealButton({ revealed, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white hover:border-[#00D4A0]/40 transition-colors shrink-0"
    >
      {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
      {revealed ? 'Hide amounts' : 'Reveal amounts'}
    </button>
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
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white mt-0.5 wrap-break-word">
          {value || '—'}
        </p>
      </div>
    </div>
  )
}

function SalaryCard({ label, value }) {
  // Read from the store rather than threaded through four layers of props.
  // company.currency is the tenant's own currency; the AED fallback only
  // applies before the company row has loaded.
  const currency = useAuthStore(s => s.company?.currency) ?? 'AED'
  const hasSalary = value !== null && value !== undefined
  return (
    <div className="p-4 rounded-xl bg-[#F5F5F0] dark:bg-[#0F0F0F] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-1.5">{label}</p>
      <p className="text-base font-bold text-[#1A1A1A] dark:text-white tracking-widest">
        {hasSalary ? `•••,••• ${currency}` : '—'}
      </p>
    </div>
  )
}

// ─── Profile Completeness + Generate Invite Link card ─────────────────────────

// Only shown for employees who haven't logged in yet (!employee.user_id) —
// mirrors generate_employee_invite()'s own "already has a login" guard.
// The checklist can't reuse employee_compliance_status (that view filters to
// status='active' employees only, and a not-yet-invited/invited profile is
// never 'active' — see the Known Gaps note in the handover), so it replicates
// DocumentTypeGrid.jsx's own document_types + hr_documents_with_status query
// shape instead, which works for any employee status.
function ProfileCompletenessCard({ employee, onOpenDocuments, showToast }) {
  const [requiredTypes, setRequiredTypes] = useState([])
  const [uploadedTypeIds, setUploadedTypeIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('employee')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [{ data: typeRows }, { data: docRows }] = await Promise.all([
        supabase.from('document_types').select('id, label').eq('scope', 'employee').eq('active', true).eq('is_required', true).order('sort_order'),
        supabase.from('hr_documents_with_status').select('document_type_id').eq('scope', 'employee').eq('employee_id', employee.id),
      ])
      if (cancelled) return
      setRequiredTypes(typeRows ?? [])
      setUploadedTypeIds(new Set((docRows ?? []).map((d) => d.document_type_id)))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [employee.id])

  async function generate(e) {
    e.preventDefault()
    setGenError('')
    setGenerating(true)
    const { data, error } = await generateEmployeeInvite(supabase, employee.id, role)
    setGenerating(false)
    if (error) {
      // generate_employee_invite's exceptions are hand-written for the
      // caller ("This employee already has a login", "A pending invite
      // already exists for this employee", …) — shown verbatim, same
      // convention used by the old (now removed) one-step invite modal.
      console.error('[ProfileCompletenessCard] generate_employee_invite failed', error)
      setGenError(error.message)
      return
    }
    setResult(data)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLinkFor(result.token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[ProfileCompletenessCard] clipboard write failed', err)
      showToast('error', 'Could not copy the link — please select and copy it manually.')
    }
  }

  const checklist = [
    { key: 'job_description', label: 'Job description', ok: !!(employee.job_description && employee.job_description.trim()) },
    { key: 'interview_score', label: 'Interview score',  ok: employee.interview_score != null },
    { key: 'department',      label: 'Department',       ok: !!employee.department_id },
    ...requiredTypes.map((t) => ({ key: t.id, label: t.label, ok: uploadedTypeIds.has(t.id) })),
  ]

  return (
    <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-2.5 mb-1">
        <ClipboardList size={16} className="text-[#00D4A0]" />
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Profile Completeness</h3>
      </div>
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-4">
        None of this blocks inviting — it's just a heads-up on what's missing.
      </p>

      {loading ? (
        <div className="space-y-2.5 mb-5 animate-pulse">
          {[0, 1, 2, 3].map((i) => <SkeletonRow key={i} className="h-4 w-2/3" />)}
        </div>
      ) : (
        <div className="space-y-2 mb-5">
          {checklist.map((item) => (
            <div key={item.key} className="flex items-center gap-2.5 text-sm">
              {item.ok
                ? <CheckCircle2 size={15} className="text-[#00D4A0] shrink-0" />
                : <XCircle size={15} className="text-[#FF4D4D] shrink-0" />}
              <span className={item.ok ? 'text-[#1A1A1A] dark:text-white' : 'text-[#666666] dark:text-[#A0A0A0]'}>{item.label}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onOpenDocuments}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#00D4A0] hover:underline mb-5"
      >
        <FileText size={13} /> Upload documents
      </button>

      <div className="pt-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        {!result ? (
          <form onSubmit={generate} className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">Invite as</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
              >
                {INVITE_ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {generating ? 'Generating…' : 'Generate Invite Link'}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            {result.warnings?.length > 0 && (
              <div className="p-3.5 rounded-lg bg-[#FF8C42]/10 border border-[#FF8C42]/20">
                <p className="text-xs font-semibold text-[#FF8C42] mb-1.5">
                  You can still invite, but the profile is missing:
                </p>
                <ul className="text-xs text-[#FF8C42] space-y-0.5 list-disc list-inside">
                  {result.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A]">
              <code className="flex-1 text-xs text-[#1A1A1A] dark:text-white truncate">{inviteLinkFor(result.token)}</code>
              <button
                onClick={copyLink}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  copied ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#00D4A0] text-white hover:bg-[#00B589]'
                }`}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <p className="text-xs text-[#AAAAAA] dark:text-[#555555]">
              Valid for {result.expires_in_days} days, single-use. There's no email service yet — share this link with {result.email} yourself.
            </p>
          </div>
        )}

        {genError && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D] mt-3">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            {genError}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Profile tab ─────────────────────────────────────────────────────────────

function ProfileTab({ employee, canErase, onOpenAnonymize, canManageFeedAccess, onToggleCanPostFeed, togglingFeedAccess, onOpenDocuments, showToast }) {
  return (
    <div className="space-y-6">
      {!employee.user_id && (
        <ProfileCompletenessCard employee={employee} onOpenDocuments={onOpenDocuments} showToast={showToast} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: identity card */}
        <div className="lg:col-span-1">
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            {/* Avatar + name */}
            <div className="flex flex-col items-center gap-3 mb-5 pb-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
              <div className="w-20 h-20 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-2xl font-bold">
                {employee.full_name?.[0]?.toUpperCase()}
              </div>
              <div className="text-center">
                <h2 className="text-lg font-bold text-[#1A1A1A] dark:text-white">
                  {employee.full_name}
                </h2>
                <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  {employee.job_title || 'No title set'}
                </p>
                <span
                  className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold ${
                    STATUS_STYLES[employee.status] ??
                    'bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]'
                  }`}
                >
                  {employee.status?.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Contact + sensitive */}
            <InfoRow icon={Mail}    label="Email"       value={employee.email} />
            <InfoRow icon={Phone}   label="Phone"       value={employee.phone} />
            <InfoRow icon={Shield}  label="National ID" value={maskNationalId(employee.national_id)} />
            <InfoRow icon={CreditCard} label="Bank Account" value={maskBankAccount()} />
          </div>
        </div>

        {/* Right: details */}
        <div className="lg:col-span-2 space-y-6">

          {/* Employment details */}
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-1">
              Employment
            </h3>
            <InfoRow
              icon={Building2}
              label="Department"
              value={employee.departments?.name}
            />
            <InfoRow
              icon={Briefcase}
              label="Classification"
              value={CLASSIFICATION_LABEL[employee.classification]}
            />
            <InfoRow
              icon={CalendarDays}
              label="Hire Date"
              value={formatDate(employee.hire_date)}
            />
            <InfoRow
              icon={CalendarDays}
              label="Probation End"
              value={formatDate(employee.probation_end_date)}
            />
            <InfoRow
              icon={Briefcase}
              label="Contract Type"
              value={employee.contract_type === 'indefinite' ? 'Indefinite' : 'Fixed Term'}
            />
            {employee.contract_type === 'fixed_term' && (
              <InfoRow
                icon={CalendarDays}
                label="Contract End Date"
                value={formatDate(employee.contract_end_date)}
              />
            )}
            <InfoRow
              icon={Target}
              label="Interview Score"
              value={employee.interview_score != null ? `${employee.interview_score} / 100` : null}
            />
          </div>

          {/* Job description — role expectations */}
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <div className="flex items-center gap-2.5 mb-3">
              <AlignLeft size={15} className="text-[#00D4A0]" />
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Job Description</h3>
            </div>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] whitespace-pre-wrap">
              {employee.job_description?.trim() || 'No job description set yet.'}
            </p>
          </div>

          {/* Compensation — always masked */}
          <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">
                Compensation
              </h3>
              <span className="text-xs text-[#AAAAAA] dark:text-[#555555]">
                Masked for security
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SalaryCard label="Basic Salary"        value={employee.basic_salary} />
              <SalaryCard label="Housing Allowance"   value={employee.housing_allowance} />
              <SalaryCard label="Transport Allowance" value={employee.transport_allowance} />
              <SalaryCard label="Other Allowance"     value={employee.other_allowance} />
            </div>
          </div>
        </div>
      </div>

      {/* Feed posting permission — HR view only */}
      {canManageFeedAccess && (
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
                <Newspaper size={16} className="text-[#00D4A0]" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Can post on feed</h3>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5 max-w-md">
                  Lets this employee publish News Feed posts, even without an HR/manager role. Super admins, HR managers, and department managers can always post.
                </p>
              </div>
            </div>
            <button
              onClick={onToggleCanPostFeed}
              disabled={togglingFeedAccess}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-colors disabled:opacity-60 ${
                employee.can_post_feed ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
              }`}
            >
              {togglingFeedAccess ? <Loader2 size={12} className="animate-spin" /> : employee.can_post_feed ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </div>
      )}

      {/* Danger Zone — Right to Erasure, super_admin only */}
      {canErase && (
        <div className="p-6 rounded-xl bg-[#FF4D4D]/5 border-2 border-[#FF4D4D]/30">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF4D4D]/10 flex items-center justify-center shrink-0">
              <ShieldAlert size={16} className="text-[#FF4D4D]" />
            </div>
            <h3 className="text-base font-semibold text-[#FF4D4D]">Danger Zone — Right to Erasure (PDPL Art. 15)</h3>
          </div>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-4 max-w-2xl">
            Anonymizing this employee permanently scrubs all personal data (name, email, phone, national ID, bank account,
            and more). Payroll records are kept for UAE tax law but de-identified. <span className="font-semibold text-[#FF4D4D]">This cannot be undone.</span>
          </p>
          <button
            onClick={onOpenAnonymize}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] transition-colors"
          >
            <Trash2 size={15} />
            Anonymize This Employee
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Attendance tab ───────────────────────────────────────────────────────────

function AttendanceMiniCalendar({ records }) {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()

  const firstDay   = new Date(year, month, 1)
  const lastDayNum = new Date(year, month + 1, 0).getDate()
  const todayStr   = localDateStr(now)
  const startOffset = (firstDay.getDay() + 6) % 7

  const cells = Array.from({ length: 42 }, (_, i) => {
    const dayNum = i - startOffset + 1
    if (dayNum < 1 || dayNum > lastDayNum) return null
    const d       = new Date(year, month, dayNum)
    const dateStr = localDateStr(d)
    const record  = records.find(r => r.date === dateStr) ?? null
    return {
      dayNum,
      dateStr,
      isToday:   dateStr === todayStr,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      record,
    }
  })

  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6">
      <div className="grid grid-cols-7 mb-1">
        {DAYS_SHORT.map(d => (
          <div key={d} className="text-center py-2 text-xs font-semibold text-[#666666] dark:text-[#A0A0A0]">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`empty-${i}`} />
          const { dayNum, dateStr, isToday, isWeekend, record } = cell
          const meta = record?.status ? ATT_STATUS_META[record.status] : null

          return (
            <div
              key={dateStr}
              className={[
                'relative flex flex-col items-center justify-center rounded-xl min-h-12 py-2',
                meta ? meta.cell : '',
                isToday ? 'ring-2 ring-[#00D4A0] ring-offset-1 ring-offset-white dark:ring-offset-[#1E1E1E]' : '',
                !meta && !isToday ? 'bg-[#F5F5F0] dark:bg-[#252525]' : '',
                isWeekend && !meta ? 'opacity-40' : '',
              ].filter(Boolean).join(' ')}
            >
              <span className={`text-sm font-semibold ${
                isToday ? 'text-[#00D4A0]' : meta ? 'text-[#1A1A1A] dark:text-white' : 'text-[#666666] dark:text-[#A0A0A0]'
              }`}>
                {dayNum}
              </span>
              {meta && <div className={`w-1.5 h-1.5 rounded-full mt-1 ${meta.dot}`} />}
              {record?.clock_in_lat != null && (
                <span
                  title={`Clocked in near ${Number(record.clock_in_lat).toFixed(5)}, ${Number(record.clock_in_lng).toFixed(5)}`}
                  className="absolute bottom-1 right-1 text-[#4D9FFF]"
                >
                  <MapPin size={8} />
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-5 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
        {Object.entries(ATT_STATUS_META).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
            <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{meta.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AttendanceTab({ employeeId }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!employeeId) { setLoading(false); return }
      setLoading(true)
      const now   = new Date()
      const first = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
      const last  = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0))
      const { data } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', employeeId)
        .gte('date', first)
        .lte('date', last)
      setRecords(data ?? [])
      setLoading(false)
    }
    load()
  }, [employeeId])

  if (loading) return <TabSpinner />

  const daysPresent = records.filter(r => r.status === 'present').length
  const daysLate    = records.filter(r => r.status?.startsWith('late')).length
  const daysAbsent  = records.filter(r => r.status?.startsWith('absent')).length
  const otHours     = records.reduce((sum, r) => sum + Number(r.overtime_hours ?? 0), 0)

  return (
    <div className="space-y-6">
      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Days Present', value: daysPresent,        cls: 'text-[#00D4A0]' },
          { label: 'Days Late',    value: daysLate,            cls: 'text-[#FF8C42]' },
          { label: 'Days Absent',  value: daysAbsent,           cls: 'text-[#FF4D4D]' },
          { label: 'OT Hours',     value: fmtHours(otHours),    cls: 'text-[#1A1A1A] dark:text-white' },
        ].map(({ label, value, cls }) => (
          <div key={label} className="px-5 py-4 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <AttendanceMiniCalendar records={records} />
    </div>
  )
}

// ─── Leave tab ────────────────────────────────────────────────────────────────

function LeaveBadge({ type }) {
  const m = LT[type]
  if (!m) return <span className="text-xs text-[#666666]">{type}</span>
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

function LeaveStatusBadge({ status }) {
  const m = LEAVE_STATUS_META[status]
  if (!m) return null
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>{m.label}</span>
}

function LeaveBalanceCard({ type, balance }) {
  const meta      = LT[type]
  const entitled  = balance?.entitled_days ?? 0
  const used      = balance?.used_days ?? 0
  const remaining = entitled - used
  const pct       = entitled > 0 ? Math.min(100, Math.round((used / entitled) * 100)) : 0

  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta?.cls ?? 'bg-[#A0A0A0]/10 text-[#A0A0A0]'}`}>
          <CalendarDays size={15} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{meta?.label ?? type}</p>
          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
            {remaining >= 0 ? `${remaining}d remaining` : 'Exceeded'}
          </p>
        </div>
      </div>

      <div className="h-1.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-[#666666] dark:text-[#A0A0A0]">
          <span className="font-bold text-[#1A1A1A] dark:text-white">{used}</span> used
        </span>
        <span className="text-[#666666] dark:text-[#A0A0A0]">
          <span className="font-bold text-[#1A1A1A] dark:text-white">{entitled}</span> entitled
        </span>
      </div>
    </div>
  )
}

function LeaveTab({ employeeId }) {
  const [balances, setBalances] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading]   = useState(true)
  const year = new Date().getFullYear()

  useEffect(() => {
    async function load() {
      if (!employeeId) { setLoading(false); return }
      setLoading(true)
      const [{ data: bal }, { data: req }] = await Promise.all([
        supabase.from('leave_balances').select('*').eq('employee_id', employeeId).eq('year', year),
        supabase.from('leave_requests').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      ])
      setBalances(bal ?? [])
      setRequests(req ?? [])
      setLoading(false)
    }
    load()
  }, [employeeId, year])

  if (loading) return <TabSpinner />

  const balanceMap = Object.fromEntries(balances.map(b => [b.leave_type, b]))

  return (
    <div className="space-y-8">
      {/* Balance cards */}
      <section>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">
          Leave Balances — {year}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {LEAVE_TYPES.map(t => (
            <LeaveBalanceCard key={t.value} type={t.value} balance={balanceMap[t.value] ?? null} />
          ))}
        </div>
      </section>

      {/* Request history */}
      <section>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white mb-4">Request History</h3>
        {!requests.length ? (
          <EmptyState icon={CalendarOff} title="No leave requests on record" />
        ) : (
          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                  {['Type', 'From', 'To', 'Days', 'Status'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {requests.map(req => (
                  <tr key={req.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                    <td className="px-5 py-3.5"><LeaveBadge type={req.leave_type} /></td>
                    <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{formatShortDate(req.start_date)}</td>
                    <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{formatShortDate(req.end_date)}</td>
                    <td className="px-5 py-3.5 font-bold text-[#1A1A1A] dark:text-white">{req.days_requested}d</td>
                    <td className="px-5 py-3.5"><LeaveStatusBadge status={req.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// ─── KPI tab ──────────────────────────────────────────────────────────────────

function ScoreGauge({ score, color, size = 160 }) {
  const stroke = 13
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const offset = c * (1 - pct)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          strokeWidth={stroke} fill="none"
          className="stroke-[#E8E8E8] dark:stroke-[#2A2A2A]"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[#1A1A1A] dark:text-white">{Math.round(score)}</span>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">/ 100</span>
      </div>
    </div>
  )
}

function RatingBadge({ rating }) {
  const meta = getRatingMeta(rating)
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${meta.cls}`}>
      {rating ?? 'Not Yet Rated'}
    </span>
  )
}

function ComponentBar({ label, weight, value }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 text-sm">
        <span className="font-semibold text-[#1A1A1A] dark:text-white">{label}</span>
        <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
          {weight}% weight · <span className="font-semibold text-[#1A1A1A] dark:text-white">{pct.toFixed(0)}</span>/100
        </span>
      </div>
      <div className="h-2.5 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
        <div className="h-full bg-[#00D4A0] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function KpiTab({ employeeId }) {
  const [row, setRow]         = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!employeeId) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('kpi_scores')
        .select('*')
        .eq('employee_id', employeeId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(1)
        .maybeSingle()
      setRow(data ?? null)
      setLoading(false)
    }
    load()
  }, [employeeId])

  if (loading) return <TabSpinner />
  if (!row) return <EmptyState icon={BarChart3} title="No KPI data recorded yet" />

  const total = Number(row.total_score) || 0
  const meta  = getRatingMeta(row.rating)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6 items-stretch max-w-5xl">
      {/* Gauge card */}
      <div className="p-8 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] flex flex-col items-center justify-center gap-4">
        <p className="text-xs uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0] font-semibold">
          {periodLabel(row.period_year, row.period_month)}
        </p>
        <ScoreGauge score={total} color={meta.hex} />
        <RatingBadge rating={row.rating} />
        {row.bonus_eligible && (
          <span className="flex items-center gap-1.5 text-xs text-[#00D4A0] font-semibold">
            <Gift size={13} /> Bonus Eligible
          </span>
        )}
      </div>

      {/* Breakdown */}
      <div className="p-6 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-5">Score Breakdown</h3>
        <div className="space-y-5">
          {KPI_COMPONENTS.map(c => (
            <ComponentBar key={c.key} label={c.label} weight={c.weight} value={row[c.key]} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Payroll tab ──────────────────────────────────────────────────────────────

function PayrollTab({ employeeId }) {
  const currency = useAuthStore(s => s.company?.currency) ?? 'AED'
  const [runs, setRuns]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [revealedId, setRevealedId] = useState(null)

  useEffect(() => {
    async function load() {
      if (!employeeId) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase
        .from('payroll_runs')
        .select('*')
        .eq('employee_id', employeeId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(3)
      setRuns(data ?? [])
      setLoading(false)
    }
    load()
  }, [employeeId])

  if (loading) return <TabSpinner />
  if (!runs.length) return <EmptyState icon={CreditCard} title="No payslips on record" />

  return (
    <div className="space-y-4 max-w-3xl">
      {runs.map(run => {
        const gross     = computeGross(run)
        const net       = computeNet(gross, run.deductions)
        const meta      = PAYROLL_STATUS[run.status] ?? PAYROLL_STATUS.draft
        const expanded  = expandedId === run.id
        const revealed  = revealedId === run.id

        const earnings = [
          { label: 'Basic Salary',        value: run.basic_salary },
          { label: 'Housing Allowance',   value: run.housing_allowance },
          { label: 'Transport Allowance', value: run.transport_allowance },
          { label: 'Other Allowance',     value: run.other_allowance },
          { label: 'Overtime Pay',        value: run.overtime_pay },
          { label: 'Performance Bonus',   value: run.performance_bonus },
        ]

        return (
          <div key={run.id} className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {/* Card header — click to expand */}
            <button
              onClick={() => setExpandedId(expanded ? null : run.id)}
              className="w-full flex items-center justify-between p-5 text-left hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
            >
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                  {periodLabel(run.period_year, run.period_month)}
                </p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                  Net Salary: <span className="tracking-widest">{maskSalary()}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                {expanded
                  ? <ChevronUp size={16} className="text-[#666666] dark:text-[#A0A0A0]" />
                  : <ChevronDown size={16} className="text-[#666666] dark:text-[#A0A0A0]" />}
              </div>
            </button>

            {/* Expanded breakdown */}
            {expanded && (
              <div className="p-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                <div className="flex items-center justify-end mb-4">
                  <RevealButton
                    revealed={revealed}
                    onClick={() => setRevealedId(revealed ? null : run.id)}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Earnings */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#1A1A1A] dark:text-white mb-3">Earnings Breakdown</h4>
                    <div className="space-y-2.5">
                      {earnings.map(e => (
                        <div key={e.label} className="flex items-center justify-between text-sm">
                          <span className="text-[#666666] dark:text-[#A0A0A0]">{e.label}</span>
                          <span className="font-semibold text-[#1A1A1A] dark:text-white">
                            {revealed ? `${fmtMoney(e.value)} ${currency}` : maskSalary()}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-sm pt-2.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                        <span className="font-semibold text-[#1A1A1A] dark:text-white">Gross Total</span>
                        <span className="font-bold text-[#00D4A0]">
                          {revealed ? `${fmtMoney(gross)} ${currency}` : maskSalary()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Deductions / Net */}
                  <div>
                    <h4 className="text-sm font-semibold text-[#1A1A1A] dark:text-white mb-3">Deductions Breakdown</h4>
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-[#666666] dark:text-[#A0A0A0]">Statutory & Other Deductions</span>
                        <span className="font-semibold text-[#FF4D4D]">
                          {revealed ? `- ${fmtMoney(run.deductions)} ${currency}` : maskSalary()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm pt-2.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                        <span className="font-semibold text-[#1A1A1A] dark:text-white">Net Salary</span>
                        <span className="font-bold text-[#00D4A0]">
                          {revealed ? `${fmtMoney(net)} ${currency}` : maskSalary()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Anonymize (Right to Erasure) modal ───────────────────────────────────────

function AnonymizeModal({ employee, onClose, onConfirm, onSuccess }) {
  const [nameInput, setNameInput]   = useState('')
  const [understood, setUnderstood] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')
  const [result, setResult]         = useState(null)

  const nameMatches = nameInput.trim().length > 0 && nameInput.trim() === employee.full_name
  const canConfirm  = nameMatches && understood && !submitting

  async function handleConfirm() {
    if (!canConfirm) return
    setSubmitting(true)
    setError('')
    const { data, error: rpcError } = await onConfirm()
    setSubmitting(false)
    if (rpcError) {
      console.error('[AnonymizeModal] anonymize_employee failed', rpcError)
      setError('Something went wrong. Please try again.')
      return
    }
    setResult(data)
    onSuccess()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#FF4D4D]/30 shadow-2xl">
        <div className="flex items-start justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FF4D4D]/10 flex items-center justify-center shrink-0">
              <ShieldAlert size={18} className="text-[#FF4D4D]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Anonymize Employee</h2>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">This action is permanent</p>
            </div>
          </div>
          {!result && (
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="p-6">
          {result ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center">
                <Check size={24} className="text-[#00D4A0]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">Employee anonymized</p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1">
                  Anonymous ID: <span className="font-mono font-semibold text-[#1A1A1A] dark:text-white">{result.anonymous_id}</span>
                </p>
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-2">Redirecting to Employees…</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">
                Type <span className="font-semibold text-[#1A1A1A] dark:text-white">{employee.full_name}</span> to confirm.
              </p>
              <input
                type="text"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                placeholder="Full name"
                className="w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#FF4D4D] transition-colors"
              />
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={understood}
                  onChange={e => setUnderstood(e.target.checked)}
                  className="mt-0.5 accent-[#FF4D4D]"
                />
                <span className="text-sm text-[#1A1A1A] dark:text-white">I understand this is permanent</span>
              </label>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#FF4D4D]/10 border border-[#FF4D4D]/20 text-sm text-[#FF4D4D]">
                  <AlertTriangle size={13} className="shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#FF4D4D] hover:bg-[#E04040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {submitting ? 'Anonymizing…' : 'Anonymize'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EmployeeDetail() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const role        = useAuthStore(s => s.role)
  const companyId   = useAuthStore(s => s.companyId)
  const currentEmployee = useAuthStore(s => s.employee)
  const [tab,       setTab]      = useState('profile')
  const [employee,  setEmployee] = useState(null)
  const [loading,   setLoading]  = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [showAnonymize, setShowAnonymize] = useState(false)
  const [togglingFeedAccess, setTogglingFeedAccess] = useState(false)
  const { toast, showToast } = useToast()

  async function anonymizeEmployee() {
    return supabase.rpc('anonymize_employee', { p_employee_id: employee.id })
  }

  async function toggleCanPostFeed() {
    const next = !employee.can_post_feed
    setTogglingFeedAccess(true)
    const { error } = await supabase
      .from('employees')
      .update({ can_post_feed: next })
      .eq('id', employee.id)
    setTogglingFeedAccess(false)
    if (error) {
      console.error('[EmployeeDetail] toggleCanPostFeed failed', error)
      showToast('error', 'Could not update feed posting access. Please try again.')
      return
    }
    setEmployee(prev => ({ ...prev, can_post_feed: next }))
  }

  function handleAnonymizeSuccess() {
    setTimeout(() => navigate('/employees'), 3000)
  }

  async function loadEmployee() {
    setLoading(true)
    setFetchError('')
    const { data, error } = await supabase
      .from('employees')
      .select('*, departments!employees_department_id_fkey(name)')
      .eq('id', id)
      .single()

    if (error) {
      console.error('[EmployeeDetail] fetch failed', error)
      setFetchError(error.code === 'PGRST116' ? 'Employee not found' : 'load-failed')
    } else if (!data) {
      setFetchError('Employee not found')
    } else {
      setEmployee(data)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadEmployee()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {loading ? (
            <div className="space-y-6 animate-pulse">
              <div className="flex items-center gap-4">
                <SkeletonBlock className="w-9 h-9 shrink-0" />
                <div className="space-y-2">
                  <SkeletonRow className="h-5 w-48" />
                  <SkeletonRow className="h-3 w-32" />
                </div>
              </div>
              <SkeletonBlock className="h-10" />
              <SkeletonBlock className="h-56" />
            </div>
          ) : fetchError ? (
            <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF4D4D]/10 border border-[#FF4D4D]/20">
              <AlertTriangle size={18} className="text-[#FF4D4D] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#FF4D4D]">
                  {fetchError === 'load-failed' ? 'Something went wrong loading this employee.' : fetchError}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  {fetchError === 'load-failed' && (
                    <button onClick={loadEmployee} className="text-sm text-[#00D4A0] hover:underline">
                      Retry
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/employees')}
                    className="text-sm text-[#00D4A0] hover:underline"
                  >
                    Back to employees
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Page header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4 min-w-0">
                  <Link
                    to="/employees"
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors shrink-0"
                  >
                    <ArrowLeft size={16} />
                  </Link>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white truncate">
                        {employee.full_name}
                      </h1>
                      {employee.emp_code && (
                        <span className="flex items-center gap-1 shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#00D4A0]/10 text-[#00D4A0]">
                          <Hash size={11} />{employee.emp_code}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-0.5 truncate">
                      {[employee.job_title, employee.departments?.name]
                        .filter(Boolean)
                        .join(' · ') || 'No details set'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tab bar */}
              <div className="flex items-center gap-1 mb-6 border-b border-[#E8E8E8] dark:border-[#2A2A2A] overflow-x-auto whitespace-nowrap">
                {TABS.map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors shrink-0 ${
                      tab === key
                        ? 'border-[#00D4A0] text-[#00D4A0]'
                        : 'border-transparent text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                    }`}
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {tab === 'profile'    && (
                <ProfileTab
                  employee={employee}
                  canErase={role === 'super_admin'}
                  onOpenAnonymize={() => setShowAnonymize(true)}
                  canManageFeedAccess={role === 'super_admin' || role === 'hr_manager'}
                  onToggleCanPostFeed={toggleCanPostFeed}
                  togglingFeedAccess={togglingFeedAccess}
                  onOpenDocuments={() => setTab('documents')}
                  showToast={showToast}
                />
              )}
              {tab === 'attendance' && <AttendanceTab employeeId={employee.id} />}
              {tab === 'leave'      && <LeaveTab employeeId={employee.id} />}
              {tab === 'kpi'        && <KpiTab employeeId={employee.id} />}
              {tab === 'payroll'    && <PayrollTab employeeId={employee.id} />}
              {tab === 'documents'  && (
                <DocumentTypeGrid
                  scope="employee"
                  employeeId={employee.id}
                  companyId={companyId}
                  currentEmployeeId={currentEmployee?.id}
                  canManage={role === 'super_admin' || role === 'hr_manager' || role === 'admin'}
                  showToast={showToast}
                />
              )}
            </>
          )}
        </main>
      </div>

      {showAnonymize && (
        <AnonymizeModal
          employee={employee}
          onClose={() => setShowAnonymize(false)}
          onConfirm={anonymizeEmployee}
          onSuccess={handleAnonymizeSuccess}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
