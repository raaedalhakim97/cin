import { useEffect, useState, useCallback } from 'react'
import { pdf } from '@react-pdf/renderer'
import {
  Eye, EyeOff, Download, Play, Check, X, Pencil, Loader2, AlertTriangle,
  Wallet, BarChart3, Building2, Users, TrendingUp, TrendingDown, Calendar,
  ChevronRight, Banknote, ClipboardCheck, CheckCircle2, CircleDollarSign,
  FileSpreadsheet, Clock,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { maskSalary } from '../utils/security'
import { exportToExcel } from '../utils/exportHelpers'
import PayslipPDF from '../components/PayslipPDF'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonBlock } from '../components/Skeleton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function localDateStr(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPaidDate(ts) {
  if (!ts) return null
  // Route through localDateStr first so the displayed calendar day never shifts across timezones
  const str = localDateStr(new Date(ts))
  return new Date(str + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function periodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
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

// ─── Constants ────────────────────────────────────────────────────────────────

const RUN_ROLES     = new Set(['super_admin', 'hr_manager'])
const SUMMARY_ROLES = new Set(['super_admin', 'hr_manager', 'read_only'])

const RUN_STATUS = {
  draft:    { label: 'Draft',    cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  approved: { label: 'Approved', cls: 'bg-[#4D9FFF]/10 text-[#4D9FFF]' },
  paid:     { label: 'Paid',     cls: 'bg-[#00D4A0]/10 text-[#00D4A0]' },
  not_run:  { label: 'Not Run',  cls: 'bg-[#A0A0A0]/10 text-[#A0A0A0]' },
}

const INPUT =
  'w-full px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

const SELECT =
  'px-3.5 py-2.5 text-sm rounded-lg bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors'

// ─── Micro-components ─────────────────────────────────────────────────────────

function MoneyText({ value, revealed, currency = 'AED', prefix = '' }) {
  if (!revealed) return <>{maskSalary()}</>
  return <>{prefix}{fmtMoney(value)}{currency ? ` ${currency}` : ''}</>
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

function StatCard({ icon: Icon, label, value, iconBg, iconColor, valueColor }) {
  return (
    <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
        <Icon size={16} className={iconColor} />
      </div>
      <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{label}</p>
    </div>
  )
}

// ─── Payslip Card ─────────────────────────────────────────────────────────────

function PayslipCard({ run, revealed, onToggleReveal, onDownload, downloading, title, subtitle, onClose }) {
  if (!run) {
    return (
      <div className="relative p-8 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] flex flex-col items-center text-center gap-3">
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
            <X size={16} />
          </button>
        )}
        <div className="w-14 h-14 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center">
          <Wallet size={22} className="text-[#00D4A0]" />
        </div>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">No payslip yet for this period</p>
        <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">Your payslip will appear here once payroll has been run.</p>
      </div>
    )
  }

  const gross = computeGross(run)
  const net   = computeNet(gross, run.deductions)
  const meta  = RUN_STATUS[run.status] ?? RUN_STATUS.draft
  const paidOn = run.status === 'paid' ? fmtPaidDate(run.paid_at) : null

  const earnings = [
    { label: 'Basic Salary',        value: run.basic_salary },
    { label: 'Housing Allowance',   value: run.housing_allowance },
    { label: 'Transport Allowance', value: run.transport_allowance },
    { label: 'Other Allowance',     value: run.other_allowance },
    { label: 'Overtime Pay',        value: run.overtime_pay },
    { label: 'Performance Bonus',   value: run.performance_bonus },
  ]

  return (
    <div className="relative rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden shadow-sm">
      {onClose && (
        <button onClick={onClose} className="absolute top-5 right-5 z-10 w-8 h-8 flex items-center justify-center rounded-lg bg-white/70 dark:bg-black/20 text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white transition-colors">
          <X size={16} />
        </button>
      )}

      {/* Header band */}
      <div className="p-6 pb-8 bg-gradient-to-br from-[#00D4A0]/10 via-transparent to-transparent border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-start justify-between mb-6 pr-8">
          <div>
            <p className="text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">{title}</p>
            <h2 className="text-lg font-bold text-[#1A1A1A] dark:text-white mt-0.5">{subtitle}</h2>
            {paidOn && <p className="text-xs text-[#00D4A0] mt-1">Paid on {paidOn}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
            <RevealButton revealed={revealed} onClick={onToggleReveal} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">Gross Salary</p>
            <p className="text-xl font-bold text-[#1A1A1A] dark:text-white">
              <MoneyText value={gross} revealed={revealed} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">Deductions</p>
            <p className="text-xl font-bold text-[#FF4D4D]">
              <MoneyText value={run.deductions} revealed={revealed} prefix="- " />
            </p>
          </div>
          <div>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">Net Salary</p>
            <p className="text-2xl font-bold text-[#00D4A0]">
              <MoneyText value={net} revealed={revealed} />
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Earnings breakdown */}
        <div>
          <h3 className="text-sm font-semibold text-[#1A1A1A] dark:text-white mb-3">Earnings Breakdown</h3>
          <div className="space-y-2.5">
            {earnings.map(e => (
              <div key={e.label} className="flex items-center justify-between text-sm">
                <span className="text-[#666666] dark:text-[#A0A0A0]">{e.label}</span>
                <span className="font-semibold text-[#1A1A1A] dark:text-white">
                  <MoneyText value={e.value} revealed={revealed} currency="" />
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm pt-2.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
              <span className="font-semibold text-[#1A1A1A] dark:text-white">Gross Total</span>
              <span className="font-bold text-[#00D4A0]"><MoneyText value={gross} revealed={revealed} /></span>
            </div>
          </div>
        </div>

        {/* Deductions breakdown */}
        <div>
          <h3 className="text-sm font-semibold text-[#1A1A1A] dark:text-white mb-3">Deductions Breakdown</h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#666666] dark:text-[#A0A0A0]">Statutory & Other Deductions</span>
              <span className="font-semibold text-[#FF4D4D]">
                <MoneyText value={run.deductions} revealed={revealed} currency="" prefix="- " />
              </span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
              <span className="font-semibold text-[#1A1A1A] dark:text-white">Net Salary</span>
              <span className="font-bold text-[#00D4A0]"><MoneyText value={net} revealed={revealed} /></span>
            </div>
          </div>

          <button
            onClick={onDownload}
            disabled={downloading}
            className="mt-6 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {downloading ? 'Generating PDF…' : 'Download Payslip'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Previous Months List ─────────────────────────────────────────────────────

function PreviousMonthsList({ runs, onSelect }) {
  if (!runs.length) {
    return (
      <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center">
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No previous payslips on record</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
            {['Period', 'Gross', 'Net', 'Status', ''].map(h => (
              <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
          {runs.map(r => {
            const meta = RUN_STATUS[r.status] ?? RUN_STATUS.draft
            return (
              <tr
                key={r.id}
                onClick={() => onSelect(r)}
                className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] cursor-pointer transition-colors"
              >
                <td className="px-5 py-3.5 font-semibold text-[#1A1A1A] dark:text-white">{periodLabel(r.period_year, r.period_month)}</td>
                <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white">{maskSalary()}</td>
                <td className="px-5 py-3.5 text-[#1A1A1A] dark:text-white">{maskSalary()}</td>
                <td className="px-5 py-3.5"><span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span></td>
                <td className="px-5 py-3.5 text-right text-[#AAAAAA] dark:text-[#555555]"><ChevronRight size={14} className="inline" /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── My Payslip Tab ───────────────────────────────────────────────────────────

function MyPayslipTab({ employee, companyId, showToast }) {
  const now  = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1

  const [runs,     setRuns]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [revealed, setRevealed] = useState(false)

  const [selectedRun,     setSelectedRun]     = useState(null)
  const [modalRevealed,   setModalRevealed]   = useState(false)
  const [downloadingId,   setDownloadingId]   = useState(null)

  const fetchRuns = useCallback(async () => {
    if (!employee?.id) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('employee_id', employee.id)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
    setRuns(data ?? [])
    setLoading(false)
  }, [employee])

  useEffect(() => { fetchRuns() }, [fetchRuns])

  async function handleDownload(run) {
    if (!run || !employee) return
    setDownloadingId(run.id)
    try {
      const { data: company, error } = await supabase
        .from('company')
        .select('name, country, currency')
        .eq('id', companyId)
        .single()
      if (error) throw error

      const blob = await pdf(<PayslipPDF run={run} employee={employee} company={company} />).toBlob()

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const safeName = (employee.full_name || 'employee').trim().replace(/\s+/g, '-')
      a.href = url
      a.download = `payslip-${safeName}-${MONTHS[run.period_month - 1]}-${run.period_year}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showToast('success', 'Payslip PDF downloaded')
    } catch (err) {
      console.error('[Payroll] handleDownload failed', err)
      showToast('error', 'Something went wrong generating the payslip PDF. Please try again.')
    } finally {
      setDownloadingId(null)
    }
  }

  if (!employee) {
    return (
      <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20 max-w-lg">
        <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
          <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
            Your login is not linked to an employee record, so no payslip can be shown. Contact HR to complete setup.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-8 max-w-4xl animate-pulse">
        <SkeletonBlock className="h-64" />
        <SkeletonBlock className="h-40" />
      </div>
    )
  }

  const currentRun    = runs.find(r => r.period_year === curY && r.period_month === curM) ?? null
  const previousRuns  = runs.filter(r => r !== currentRun)

  return (
    <div className="space-y-8 max-w-4xl">
      <PayslipCard
        run={currentRun}
        revealed={revealed}
        onToggleReveal={() => setRevealed(v => !v)}
        onDownload={() => handleDownload(currentRun)}
        downloading={!!currentRun && downloadingId === currentRun.id}
        title="Current Period"
        subtitle={periodLabel(curY, curM)}
      />

      <section>
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Previous Months</h2>
        <PreviousMonthsList
          runs={previousRuns}
          onSelect={(r) => { setSelectedRun(r); setModalRevealed(false) }}
        />
      </section>

      {selectedRun && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setSelectedRun(null)}
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <PayslipCard
              run={selectedRun}
              revealed={modalRevealed}
              onToggleReveal={() => setModalRevealed(v => !v)}
              onDownload={() => handleDownload(selectedRun)}
              downloading={downloadingId === selectedRun.id}
              onClose={() => setSelectedRun(null)}
              title="Payslip"
              subtitle={periodLabel(selectedRun.period_year, selectedRun.period_month)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Edit Run Modal ───────────────────────────────────────────────────────────

function EditRunModal({ run, onClose, onSave }) {
  const [form, setForm] = useState({
    basic_salary:        run.basic_salary ?? 0,
    housing_allowance:   run.housing_allowance ?? 0,
    transport_allowance: run.transport_allowance ?? 0,
    other_allowance:     run.other_allowance ?? 0,
    overtime_pay:        run.overtime_pay ?? 0,
    performance_bonus:   run.performance_bonus ?? 0,
    deductions:          run.deductions ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const gross = computeGross(form)
  const net   = computeNet(gross, form.deductions)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    const numeric = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v) || 0]))
    const ok = await onSave(run, numeric)
    setSaving(false)
    if (ok) onClose()
  }

  const FIELDS = [
    ['basic_salary',        'Basic Salary'],
    ['housing_allowance',   'Housing Allowance'],
    ['transport_allowance', 'Transport Allowance'],
    ['other_allowance',     'Other Allowance'],
    ['overtime_pay',        'Overtime Pay'],
    ['performance_bonus',   'Performance Bonus'],
    ['deductions',          'Deductions'],
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-2xl border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div>
            <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">Edit Payroll Amounts</h2>
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">{periodLabel(run.period_year, run.period_month)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-3.5 max-h-[65vh] overflow-y-auto">
          {FIELDS.map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs font-semibold text-[#1A1A1A] dark:text-white mb-1">{label}</label>
              <input
                type="number"
                step="0.01"
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                className={INPUT}
              />
            </div>
          ))}

          <div className="p-3.5 rounded-xl bg-[#F5F5F0] dark:bg-[#252525] border border-[#E8E8E8] dark:border-[#2A2A2A] space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-[#666666] dark:text-[#A0A0A0]">Gross</span>
              <span className="font-semibold text-[#1A1A1A] dark:text-white">{fmtMoney(gross)} AED</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#666666] dark:text-[#A0A0A0]">Net</span>
              <span className="font-bold text-[#00D4A0]">{fmtMoney(net)} AED</span>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Payroll Run Tab ──────────────────────────────────────────────────────────

function PayrollRunTab({ companyId, role, showToast }) {
  const now = new Date()
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })

  const [employees, setEmployees] = useState([])
  const [runs,       setRuns]     = useState([])
  const [loading,    setLoading]  = useState(true)
  const [selected,   setSelected] = useState(new Set())
  const [revealed,   setRevealed] = useState(false)
  const [running,    setRunning]  = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [actionId,   setActionId] = useState(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: emps }, { data: runRows }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, full_name, job_title, department_id, status, basic_salary, housing_allowance, transport_allowance, other_allowance, departments!employees_department_id_fkey(name)')
        .neq('status', 'terminated')
        .order('full_name'),
      supabase
        .from('payroll_runs')
        .select('*')
        .eq('period_year', period.year)
        .eq('period_month', period.month),
    ])
    setEmployees(emps ?? [])
    setRuns(runRows ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [period.year, period.month])

  useEffect(() => { fetchData() }, [fetchData])

  const runByEmp = Object.fromEntries(runs.map(r => [r.employee_id, r]))
  const rows = employees.map(emp => ({ emp, run: runByEmp[emp.id] ?? null }))
  const eligibleIds = rows.filter(r => !r.run).map(r => r.emp.id)
  const allEligibleSelected = eligibleIds.length > 0 && eligibleIds.every(id => selected.has(id))
  const processedCount = rows.filter(r => r.run).length

  function toggleAll() {
    setSelected(allEligibleSelected ? new Set() : new Set(eligibleIds))
  }
  function toggleOne(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function runPayroll() {
    if (selected.size === 0) return
    setRunning(true)

    const toInsert = rows
      .filter(r => selected.has(r.emp.id))
      .map(r => {
        const base = {
          company_id:           companyId,
          employee_id:          r.emp.id,
          period_year:          period.year,
          period_month:         period.month,
          basic_salary:         r.emp.basic_salary || 0,
          housing_allowance:    r.emp.housing_allowance || 0,
          transport_allowance:  r.emp.transport_allowance || 0,
          other_allowance:      r.emp.other_allowance || 0,
          overtime_pay:         0,
          performance_bonus:    0,
          deductions:           0,
          status:               'draft',
        }
        const gross = computeGross(base)
        return { ...base, gross_salary: gross, net_salary: computeNet(gross, base.deductions) }
      })

    const { error } = await supabase.from('payroll_runs').insert(toInsert)
    if (error) {
      console.error('[Payroll] runPayroll failed', error)
      showToast('error', 'Something went wrong running payroll. Please try again.')
    } else {
      showToast('success', `Payroll run for ${toInsert.length} employee${toInsert.length !== 1 ? 's' : ''} — ${periodLabel(period.year, period.month)}`)
      await fetchData()
    }
    setRunning(false)
  }

  // aa_payroll_transition enforces maker-checker (draft→approved requires
  // super_admin; approved→paid requires hr_manager/super_admin) and throws a
  // hand-written message on any other attempt — shown verbatim below, same
  // convention as the shift module's DB validation errors. The frontend only
  // sends `status` — the trigger sets approved_by/paid_at itself.
  async function approveRun(run) {
    setActionId(run.id)
    const { error } = await supabase
      .from('payroll_runs')
      .update({ status: 'approved' })
      .eq('id', run.id)
    if (error) {
      console.error('[Payroll] approveRun failed', error)
      showToast('error', error.message)
    } else { showToast('success', 'Payroll run approved'); await fetchData() }
    setActionId(null)
  }

  async function markPaid(run) {
    setActionId(run.id)
    const { error } = await supabase
      .from('payroll_runs')
      .update({ status: 'paid' })
      .eq('id', run.id)
    if (error) {
      console.error('[Payroll] markPaid failed', error)
      showToast('error', error.message)
    } else { showToast('success', 'Marked as paid'); await fetchData() }
    setActionId(null)
  }

  async function saveEdit(run, updates) {
    const merged = { ...run, ...updates }
    const gross  = computeGross(merged)
    const net    = computeNet(gross, merged.deductions)
    const { error } = await supabase
      .from('payroll_runs')
      .update({ ...updates, gross_salary: gross, net_salary: net })
      .eq('id', run.id)
    if (error) {
      console.error('[Payroll] saveEdit failed', error)
      showToast('error', 'Something went wrong saving these amounts. Please try again.')
      return false
    }
    showToast('success', 'Payroll amounts updated')
    await fetchData()
    return true
  }

  return (
    <div className="space-y-6">
      {/* Period selector + bulk action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-3">
          <Calendar size={16} className="text-[#00D4A0]" />
          <select
            value={period.month}
            onChange={e => setPeriod(p => ({ ...p, month: Number(e.target.value) }))}
            className={SELECT}
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={period.year}
            onChange={e => setPeriod(p => ({ ...p, year: Number(e.target.value) }))}
            className={SELECT}
          >
            {[now.getFullYear(), now.getFullYear() - 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!loading && (
            <span className="text-xs text-[#666666] dark:text-[#A0A0A0] ml-1">
              {processedCount} / {rows.length} processed
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <RevealButton revealed={revealed} onClick={() => setRevealed(v => !v)} />
          <button
            onClick={runPayroll}
            disabled={selected.size === 0 || running}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 transition-colors"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Running…' : `Run Payroll (${selected.size})`}
          </button>
        </div>
      </div>

      {/* Employee table */}
      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[0, 1, 2, 3, 4].map(i => <SkeletonBlock key={i} className="h-12" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Users size={22} className="text-[#AAAAAA] dark:text-[#555555] mb-2" />
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0]">No eligible employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                <th className="px-5 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allEligibleSelected}
                    onChange={toggleAll}
                    disabled={eligibleIds.length === 0}
                    className="accent-[#00D4A0]"
                  />
                </th>
                {['Employee', 'Department', 'Gross', 'Net', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
              {rows.map(({ emp, run }) => {
                const status = run?.status ?? 'not_run'
                const meta   = RUN_STATUS[status]
                const gross  = run ? computeGross(run) : computeGross(emp)
                const net    = run ? computeNet(gross, run.deductions) : gross
                const busy   = run && actionId === run.id

                return (
                  <tr key={emp.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                    <td className="px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(emp.id)}
                        disabled={!!run}
                        onChange={() => toggleOne(emp.id)}
                        className="accent-[#00D4A0]"
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-[#00D4A0]/10 flex items-center justify-center text-[#00D4A0] text-xs font-bold shrink-0">
                          {initials(emp.full_name)}
                        </div>
                        <div>
                          <p className="font-semibold text-[#1A1A1A] dark:text-white">{emp.full_name}</p>
                          <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{emp.job_title || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0]">{emp.departments?.name ?? '—'}</td>
                    <td className="px-4 py-3.5 font-semibold text-[#1A1A1A] dark:text-white">
                      <MoneyText value={gross} revealed={revealed} currency="" />
                    </td>
                    <td className="px-4 py-3.5 font-semibold text-[#00D4A0]">
                      <MoneyText value={net} revealed={revealed} currency="" />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {run && (
                          <button
                            onClick={() => setEditTarget(run)}
                            title="Edit amounts"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#2A2A2A] transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        {status === 'draft' && role === 'super_admin' && (
                          <button
                            onClick={() => approveRun(run)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#4D9FFF] hover:bg-[#3B8AEF] disabled:opacity-50 transition-colors"
                          >
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <ClipboardCheck size={11} />} Approve
                          </button>
                        )}
                        {status === 'draft' && role !== 'super_admin' && (
                          <span className="flex items-center gap-1 text-xs text-[#FF8C42] font-medium whitespace-nowrap">
                            <Clock size={12} /> Awaiting owner approval
                          </span>
                        )}
                        {status === 'approved' && (
                          <button
                            onClick={() => markPaid(run)}
                            disabled={busy}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00D4A0] hover:bg-[#00B589] disabled:opacity-50 transition-colors"
                          >
                            {busy ? <Loader2 size={11} className="animate-spin" /> : <Banknote size={11} />} Mark Paid
                          </button>
                        )}
                        {status === 'paid' && (
                          <span className="flex items-center gap-1 text-xs text-[#00D4A0] font-semibold">
                            <CheckCircle2 size={13} /> Paid
                          </span>
                        )}
                        {status === 'not_run' && <span className="text-xs text-[#AAAAAA] dark:text-[#555555]">—</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {editTarget && (
        <EditRunModal run={editTarget} onClose={() => setEditTarget(null)} onSave={saveEdit} />
      )}
    </div>
  )
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────

function SummaryTab({ canExport, showToast }) {
  const now  = new Date()
  const curY = now.getFullYear()
  const curM = now.getMonth() + 1
  const prevDate = new Date(curY, curM - 2, 1)
  const prevY = prevDate.getFullYear()
  const prevM = prevDate.getMonth() + 1

  const [loading,     setLoading]     = useState(true)
  const [revealed,    setRevealed]    = useState(false)
  const [currentRuns, setCurrentRuns] = useState([])
  const [prevRuns,    setPrevRuns]    = useState([])
  const [exporting,   setExporting]   = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: cur }, { data: prev }] = await Promise.all([
        supabase
          .from('payroll_runs')
          .select('gross_salary, net_salary, employees(departments!employees_department_id_fkey(name))')
          .eq('period_year', curY)
          .eq('period_month', curM),
        supabase
          .from('payroll_runs')
          .select('gross_salary')
          .eq('period_year', prevY)
          .eq('period_month', prevM),
      ])
      setCurrentRuns(cur ?? [])
      setPrevRuns(prev ?? [])
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleExportPayroll() {
    setExporting(true)
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('basic_salary, housing_allowance, transport_allowance, other_allowance, overtime_pay, performance_bonus, deductions, status, employees(full_name)')
      .eq('period_year', curY)
      .eq('period_month', curM)
    setExporting(false)

    if (error) {
      console.error('[Payroll] handleExportPayroll failed', error)
      showToast('error', 'Something went wrong exporting the payroll report. Please try again.')
      return
    }

    const rows = (data ?? []).map(r => {
      const gross = computeGross(r)
      const allowances =
        Number(r.housing_allowance || 0) + Number(r.transport_allowance || 0) + Number(r.other_allowance || 0)
      return {
        Employee:        r.employees?.full_name || '—',
        'Basic Salary':  Number(r.basic_salary || 0),
        Allowances:      allowances,
        Overtime:        Number(r.overtime_pay || 0),
        Bonus:           Number(r.performance_bonus || 0),
        Gross:           gross,
        Deductions:      Number(r.deductions || 0),
        Net:             computeNet(gross, r.deductions),
        Status:          r.status,
      }
    })

    const monthName = MONTHS[curM - 1]
    const ok = exportToExcel(rows, `payroll-${monthName}-${curY}.xlsx`, 'Payroll', showToast)
    if (ok) showToast('success', 'Payroll report exported')
  }

  const totalCost = currentRuns.reduce((s, r) => s + Number(r.gross_salary || 0), 0)
  const prevCost  = prevRuns.reduce((s, r) => s + Number(r.gross_salary || 0), 0)
  const delta     = totalCost - prevCost
  const pct       = prevCost > 0 ? (delta / prevCost) * 100 : null
  const isUp      = delta >= 0

  const deptMap = {}
  currentRuns.forEach(r => {
    const name = r.employees?.departments?.name ?? 'Unassigned'
    deptMap[name] = (deptMap[name] || 0) + Number(r.gross_salary || 0)
  })
  const deptRows = Object.entries(deptMap).sort((a, b) => b[1] - a[1])
  const maxDept  = deptRows.length ? deptRows[0][1] : 0

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-base font-bold text-[#1A1A1A] dark:text-white">{periodLabel(curY, curM)} Overview</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {canExport && (
            <button
              onClick={handleExportPayroll}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 disabled:opacity-50 transition-colors"
            >
              {exporting
                ? <Loader2 size={15} className="animate-spin text-[#00D4A0]" />
                : <FileSpreadsheet size={15} className="text-[#00D4A0]" />}
              Export Payroll Report
            </button>
          )}
          <RevealButton revealed={revealed} onClick={() => setRevealed(v => !v)} />
        </div>
      </div>

      {loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} className="h-24" />)}
          </div>
          <SkeletonBlock className="h-48" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={CircleDollarSign}
              label="Total Payroll Cost"
              value={<MoneyText value={totalCost} revealed={revealed} />}
              iconBg="bg-[#00D4A0]/10" iconColor="text-[#00D4A0]" valueColor="text-[#1A1A1A] dark:text-white"
            />
            <StatCard
              icon={isUp ? TrendingUp : TrendingDown}
              label="vs Last Month"
              value={pct === null ? '—' : `${isUp ? '+' : ''}${pct.toFixed(1)}%`}
              iconBg={isUp ? 'bg-[#00D4A0]/10' : 'bg-[#FF4D4D]/10'}
              iconColor={isUp ? 'text-[#00D4A0]' : 'text-[#FF4D4D]'}
              valueColor={isUp ? 'text-[#00D4A0]' : 'text-[#FF4D4D]'}
            />
            <StatCard
              icon={Users}
              label="Employees Processed"
              value={currentRuns.length}
              iconBg="bg-[#4D9FFF]/10" iconColor="text-[#4D9FFF]" valueColor="text-[#1A1A1A] dark:text-white"
            />
            <StatCard
              icon={Wallet}
              label="Avg. Cost / Employee"
              value={<MoneyText value={currentRuns.length ? totalCost / currentRuns.length : 0} revealed={revealed} />}
              iconBg="bg-[#A78BFA]/10" iconColor="text-[#A78BFA]" valueColor="text-[#1A1A1A] dark:text-white"
            />
          </div>

          <section>
            <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4 flex items-center gap-2">
              <Building2 size={16} className="text-[#00D4A0]" /> Department Breakdown
            </h3>
            {deptRows.length === 0 ? (
              <div className="p-8 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-center text-sm text-[#666666] dark:text-[#A0A0A0]">
                No payroll data for this period yet
              </div>
            ) : (
              <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] p-6 space-y-5">
                {deptRows.map(([name, cost]) => (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-1.5 text-sm">
                      <span className="font-semibold text-[#1A1A1A] dark:text-white">{name}</span>
                      <span className="font-semibold text-[#1A1A1A] dark:text-white">
                        <MoneyText value={cost} revealed={revealed} />
                      </span>
                    </div>
                    <div className="h-2 bg-[#F0F0F0] dark:bg-[#2A2A2A] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#00D4A0] rounded-full transition-all duration-500"
                        style={{ width: `${maxDept ? (cost / maxDept) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-base font-bold text-[#1A1A1A] dark:text-white mb-4">Month-over-Month</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">{periodLabel(prevY, prevM)}</p>
                <p className="text-xl font-bold text-[#1A1A1A] dark:text-white"><MoneyText value={prevCost} revealed={revealed} /></p>
              </div>
              <div className="p-5 rounded-xl bg-[#00D4A0]/5 border border-[#00D4A0]/20">
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mb-1">{periodLabel(curY, curM)}</p>
                <p className="text-xl font-bold text-[#00D4A0]"><MoneyText value={totalCost} revealed={revealed} /></p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Payroll() {
  const employee  = useAuthStore(s => s.employee)
  const role      = useAuthStore(s => s.role)
  const companyId = useAuthStore(s => s.companyId)

  const canRun     = RUN_ROLES.has(role)
  const canSummary = SUMMARY_ROLES.has(role)

  const [activeTab, setActiveTab] = useState('my-payslip')
  const { toast, showToast } = useToast()

  const tabs = [
    { id: 'my-payslip', label: 'My Payslip', icon: Wallet },
    ...(canRun ? [{ id: 'payroll-run', label: 'Payroll Run', icon: Play }] : []),
    ...(canSummary ? [{ id: 'summary', label: 'Summary', icon: BarChart3 }] : []),
  ]

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* Page header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Payroll</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Payslips, payroll runs, and company-wide cost summary
            </p>
          </div>

          {/* Tab bar */}
          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit mb-8">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  activeTab === id
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
          {activeTab === 'my-payslip' && (
            <MyPayslipTab employee={employee} companyId={companyId} showToast={showToast} />
          )}
          {activeTab === 'payroll-run' && canRun && (
            <PayrollRunTab companyId={companyId} role={role} showToast={showToast} />
          )}
          {activeTab === 'summary' && canSummary && (
            <SummaryTab canExport={RUN_ROLES.has(role)} showToast={showToast} />
          )}
        </main>
      </div>

      <ToastComp toast={toast} />
    </div>
  )
}
