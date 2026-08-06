import { useEffect, useState, useCallback } from 'react'
import {
  FileText, Database, Mail,
  X, Loader2, AlertTriangle, Building2, ClipboardList, Save, Sliders, CalendarClock,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import KpiConfigTab from '../components/kpi/KpiConfigTab'
import DocumentTypesSettingsTab from '../components/documents/DocumentTypesSettingsTab'
import ShiftSettingsTab from '../components/schedule/ShiftSettingsTab'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REQUEST_TYPES = [
  { value: 'access',         label: 'Access' },
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
const STATUS_OPTIONS = ['pending', 'in_progress', 'completed', 'rejected']

const TABS = [
  { key: 'requests',  label: 'Data Requests',     icon: ClipboardList, roles: ['super_admin', 'hr_manager'] },
  { key: 'retention', label: 'Retention Policies', icon: Database,     roles: ['super_admin'] },
  { key: 'company',   label: 'Company Settings',  icon: Building2,     roles: ['super_admin'] },
  { key: 'kpi-config', label: 'KPI Configuration', icon: Sliders,      roles: ['super_admin'] },
  { key: 'document-types', label: 'Document Types', icon: FileText,   roles: ['super_admin', 'hr_manager'] },
  { key: 'shift-settings', label: 'Shift Settings', icon: CalendarClock, roles: ['super_admin', 'hr_manager'] },
]

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function RequestBadge({ type }) {
  const m = RT[type]
  return (
    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#A78BFA]/10 text-[#A78BFA] whitespace-nowrap">
      {m?.label ?? type}
    </span>
  )
}

function StatusBadge({ status }) {
  const m = REQUEST_STATUS[status]
  if (!m) return null
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${m.cls}`}>{m.label}</span>
}

function Spinner() {
  return (
    <div className="space-y-3 animate-pulse max-w-3xl">
      <SkeletonBlock className="h-14" />
      <SkeletonBlock className="h-14" />
      <SkeletonBlock className="h-14" />
    </div>
  )
}

// ─── Tab 2 — Data Requests ─────────────────────────────────────────────────────

function UpdateRequestModal({ request, onClose, onSave, saving }) {
  const [status, setStatus] = useState(request.status)
  const [notes, setNotes]   = useState(request.notes ?? '')

  async function submit(e) {
    e.preventDefault()
    await onSave(request, status, notes.trim() || null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Update Request</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">{request.employees?.full_name ?? 'Employee'}</span>
              <RequestBadge type={request.request_type} />
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={SELECT}>
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{REQUEST_STATUS[s].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Notes</label>
            <textarea
              rows={4}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Internal notes on how this request was handled…"
              className={`${INPUT} resize-none`}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] border border-[#E8E8E8] dark:border-[#2A2A2A] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DataRequestsTab({ employee, showToast }) {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [editTarget, setEditTarget] = useState(null)
  const [saving, setSaving]     = useState(false)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('data_subject_requests')
      .select('*, employees!data_subject_requests_employee_id_fkey(full_name)')
      .order('requested_at', { ascending: false })
    setRows(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function saveRequest(request, status, notes) {
    setSaving(true)
    const { error } = await supabase
      .from('data_subject_requests')
      .update({
        status,
        notes,
        handled_by:   employee?.id ?? null,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', request.id)
    setSaving(false)
    if (error) {
      console.error('[Settings] saveRequest failed', error)
      showToast('error', 'Something went wrong saving this request. Please try again.')
      return
    }
    setEditTarget(null)
    showToast('success', 'Request updated')
    fetchRows()
  }

  if (loading) return <Spinner />

  if (!rows.length) {
    return (
      <div className="flex flex-col items-center py-16 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center mb-3">
          <ClipboardList size={22} className="text-[#00D4A0]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">No data subject requests yet</p>
      </div>
    )
  }

  const now = new Date()

  return (
    <>
      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
              {['Employee', 'Type', 'Status', 'Requested', 'Due', ''].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {rows.map(r => {
              const overdue = r.due_date && new Date(r.due_date) < now && !['completed', 'rejected'].includes(r.status)
              return (
                <tr key={r.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-[#1A1A1A] dark:text-white whitespace-nowrap">
                    {r.employees?.full_name ?? 'Unknown'}
                  </td>
                  <td className="px-5 py-3.5"><RequestBadge type={r.request_type} /></td>
                  <td className="px-5 py-3.5"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{fmtDate(r.requested_at)}</td>
                  <td className={`px-5 py-3.5 whitespace-nowrap font-semibold ${overdue ? 'text-[#FF4D4D]' : 'text-[#1A1A1A] dark:text-white'}`}>
                    {fmtDate(r.due_date)}
                    {overdue && <span className="ml-1.5 text-[10px] font-bold uppercase">Overdue</span>}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => setEditTarget(r)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#00D4A0] border border-[#00D4A0]/30 hover:bg-[#00D4A0]/10 transition-colors"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <UpdateRequestModal
          request={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={saveRequest}
          saving={saving}
        />
      )}
    </>
  )
}

// ─── Tab 3 — Retention Policies ────────────────────────────────────────────────

function RetentionPoliciesTab() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('data_retention_policies')
        .select('*')
        .order('data_category')
      setRows(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <Spinner />

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
        Retention schedule per data category, per PDPL Art. 8 — informational, managed by the database, not editable here.
      </p>
      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
              {['Data Category', 'Retention', 'Legal Basis', 'Auto-Archive'].map(h => (
                <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                <td className="px-5 py-3.5 font-semibold text-[#1A1A1A] dark:text-white capitalize">
                  {r.data_category.replace(/_/g, ' ')}
                </td>
                <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{r.retention_months} months</td>
                <td className="px-5 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{r.legal_basis || '—'}</td>
                <td className="px-5 py-3.5">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    r.auto_archive
                      ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                      : 'bg-[#A0A0A0]/10 text-[#666666] dark:text-[#A0A0A0]'
                  }`}>
                    {r.auto_archive ? 'Yes' : 'No'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Tab 4 — Company Settings ──────────────────────────────────────────────────

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

function CompanySettingsTab({ companyId, showToast }) {
  const [form, setForm]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    async function load() {
      if (!companyId) { setLoading(false); return }
      setLoading(true)
      const { data } = await supabase.from('company').select('*').eq('id', companyId).single()
      setForm(data)
      setLoading(false)
    }
    load()
  }, [companyId])

  function set(field, val) {
    setForm(prev => ({ ...prev, [field]: val }))
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('company')
      .update({
        name:             form.name,
        country:          form.country,
        currency:         form.currency,
        timezone:         form.timezone,
        work_start_time:  form.work_start_time,
        work_end_time:    form.work_end_time,
        manager_salary_visibility: form.manager_salary_visibility,
        privacy_contact_email: form.privacy_contact_email?.trim() || null,
      })
      .eq('id', companyId)
    setSaving(false)
    if (error) {
      console.error('[Settings] CompanySettingsTab submit failed', error)
      showToast('error', 'Something went wrong saving company settings. Please try again.')
      return
    }
    showToast('success', 'Company settings saved')
  }

  if (loading) return <Spinner />
  if (!form) return <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">Company record not found.</p>

  return (
    <form onSubmit={submit} className="max-w-xl p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-xl bg-[#00D4A0]/10 flex items-center justify-center">
          <Building2 size={16} className="text-[#00D4A0]" />
        </div>
        <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Company Details</h3>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Company Name</label>
        <input type="text" value={form.name ?? ''} onChange={e => set('name', e.target.value)} className={INPUT} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Country</label>
          <input type="text" value={form.country ?? ''} onChange={e => set('country', e.target.value)} className={INPUT} />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Currency</label>
          <input type="text" value={form.currency ?? ''} onChange={e => set('currency', e.target.value)} className={INPUT} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Timezone</label>
        <input
          type="text"
          value={form.timezone ?? ''}
          onChange={e => set('timezone', e.target.value)}
          placeholder="e.g. Asia/Dubai"
          className={INPUT}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Work Start Time</label>
          <input
            type="time"
            value={form.work_start_time?.slice(0, 5) ?? ''}
            onChange={e => set('work_start_time', e.target.value)}
            className={INPUT}
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">Work End Time</label>
          <input
            type="time"
            value={form.work_end_time?.slice(0, 5) ?? ''}
            onChange={e => set('work_end_time', e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-sm font-semibold text-[#1A1A1A] dark:text-white mb-1.5">
          <Mail size={14} className="text-[#666666] dark:text-[#A0A0A0]" /> Privacy Contact Email
        </label>
        <input
          type="email"
          value={form.privacy_contact_email ?? ''}
          onChange={e => set('privacy_contact_email', e.target.value)}
          placeholder="privacy@yourcompany.com"
          className={INPUT}
        />
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-1.5">
          Shown on every employee's Privacy & Data page (/profile) as a contact for data requests. Leave blank to hide that line — the in-app request form stays available either way.
        </p>
      </div>

      <div className="border-t border-[#E8E8E8] dark:border-[#2A2A2A] pt-1">
        <Toggle
          checked={!!form.manager_salary_visibility}
          onChange={v => set('manager_salary_visibility', v)}
          label="Manager Salary Visibility"
          hint="When on, department managers can view their team's payroll runs (masked amounts still require the same reveal step as everyone else). Off by default — most companies keep compensation visibility to HR/super_admin only."
        />
        {form.manager_salary_visibility && (
          <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-lg bg-[#FF8C42]/10 border border-[#FF8C42]/20 text-xs text-[#FF8C42] mb-1">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            Every department manager in this company will be able to see their own team's payroll data once saved.
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Settings() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  const visibleTabs = TABS.filter(t => !t.roles || t.roles.includes(role))
  // No more role-agnostic tab (My Privacy & Data moved to /profile, session
  // 42) — default to whichever tab this role actually has.
  const [tab, setTab] = useState(() => visibleTabs[0]?.key ?? 'requests')

  const { toast, showToast } = useToast()

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Settings</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Data subject requests, retention, and company configuration
            </p>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit mb-8 overflow-x-auto">
            {visibleTabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === key
                    ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                    : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'requests' && (role === 'super_admin' || role === 'hr_manager') && (
            <DataRequestsTab employee={employee} showToast={showToast} />
          )}
          {tab === 'retention' && role === 'super_admin' && <RetentionPoliciesTab />}
          {tab === 'company' && role === 'super_admin' && (
            <CompanySettingsTab companyId={companyId} showToast={showToast} />
          )}
          {tab === 'kpi-config' && role === 'super_admin' && (
            <KpiConfigTab companyId={companyId} showToast={showToast} />
          )}
          {tab === 'document-types' && (role === 'super_admin' || role === 'hr_manager') && (
            <DocumentTypesSettingsTab companyId={companyId} showToast={showToast} />
          )}
          {tab === 'shift-settings' && (role === 'super_admin' || role === 'hr_manager') && (
            <ShiftSettingsTab companyId={companyId} showToast={showToast} />
          )}
        </main>
      </div>

      <ToastComp toast={toast} />
    </div>
  )
}
