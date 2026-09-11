import { useState } from 'react'
import {
  Landmark, Download, Loader2, AlertTriangle, Check, Globe, Info, Clock,
} from 'lucide-react'
import supabase from '../../services/supabase'
import { downloadBlob } from '../../utils/exportHelpers'

// The salary transfer file. generate_wps_sif has existed in the database for a long time
// and nothing ever called it — AdminDashboard.jsx still says "WPS export isn't built yet"
// — so payroll stopped at "the figures are calculated" and never reached "here is the file
// for your bank".
//
// This screen is thin on purpose. Every decision lives in the RPC:
//
//   who may run it      super_admin or hr_manager, checked against user_roles
//   which country       migration 35 gates on country_rules.payment_file, so a company
//                       in a country with no bank file format is refused by name rather
//                       than shown a list of missing UAE documents
//   what counts         only 'approved' and 'paid' runs; drafts are excluded and counted
//   what is missing     per-employee validation, returned as sentences
//
// The frontend's whole job is to ask for a period, render whichever of the three answers
// comes back, and turn a valid one into a file.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Field order as generate_wps_sif declares it. Deliberately NOT presented as a
// bank-ready layout — see the notice rendered below the download button.
const SCR_COLUMNS = [
  'record_type', 'employer_mol_id', 'employer_bank_routing_code', 'file_creation_date',
  'file_creation_time', 'salary_month', 'edr_count', 'total_salary', 'currency', 'reference',
]

const EDR_COLUMNS = [
  'record_type', 'employee_unique_id', 'agent_routing_code', 'iban', 'pay_start_date',
  'pay_end_date', 'days_on_pay', 'net_salary', 'fixed_income', 'variable_income', 'leave_days',
]

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CRLF and a header row per block. Banking upload forms are historically unforgiving
// about line endings, and a header row means a human can check the numbers before
// anybody submits anything.
function buildCsv(sif) {
  const lines = [
    SCR_COLUMNS.join(','),
    SCR_COLUMNS.map((c) => csvCell(sif.scr?.[c])).join(','),
    '',
    EDR_COLUMNS.join(','),
    ...(sif.edr ?? []).map((row) => EDR_COLUMNS.map((c) => csvCell(row[c])).join(',')),
  ]
  return lines.join('\r\n')
}

const SELECT =
  'px-3 py-2 rounded-lg text-sm bg-[#F5F5F0] dark:bg-[#252525] text-[#1A1A1A] dark:text-white ' +
  'border border-[#E8E8E8] dark:border-[#2A2A2A] focus:outline-none focus:border-[#00D4A0] transition-colors'

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-0">
      <span className="text-sm text-[#666666] dark:text-[#A0A0A0]">{label}</span>
      <span className="text-sm font-semibold text-[#1A1A1A] dark:text-white tabular-nums text-right">{value}</span>
    </div>
  )
}

export default function BankFileTab({ showToast }) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [busy, setBusy]   = useState(false)
  const [result, setResult] = useState(null)

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2]

  async function generate() {
    setBusy(true)
    setResult(null)
    const { data, error } = await supabase.rpc('generate_wps_sif', {
      p_year: Number(year),
      p_month: Number(month),
    })
    setBusy(false)

    if (error) {
      // The RPC raises for an unauthorised caller and for an out-of-range period, and
      // writes those messages for this screen, so they are shown as-is — same convention
      // as the payroll status transitions and the shift module.
      console.error('[BankFileTab] generate_wps_sif failed', error.code, error)
      showToast('error', error.message || 'Could not build the salary transfer file.')
      return
    }
    setResult(data)
  }

  function download() {
    const filename = `salary-transfer-${year}-${String(month).padStart(2, '0')}.csv`
    downloadBlob(new Blob([buildCsv(result)], { type: 'text/csv;charset=utf-8' }), filename)
    showToast('success', `${filename} downloaded`)
  }

  const period = `${MONTHS[month - 1]} ${year}`

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Period + action */}
      <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
        <div className="flex items-center gap-2.5 mb-1">
          <Landmark size={15} className="text-[#00D4A0]" />
          <h3 className="text-base font-semibold text-[#1A1A1A] dark:text-white">Salary transfer file</h3>
        </div>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mb-5">
          Builds the bank file for a month from payroll runs that have been approved or paid.
          Drafts are never included.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Month</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={SELECT}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#1A1A1A] dark:text-white mb-1">Year</span>
            <select value={year} onChange={(e) => setYear(e.target.value)} className={SELECT}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[#00D4A0] text-white hover:bg-[#00B589] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {busy ? 'Checking…' : 'Build file'}
          </button>
        </div>
      </div>

      {/* ── Answer 1: this country has no bank file format ──────────────────── */}
      {result?.unsupported_country && (
        <div className="p-6 rounded-xl bg-[#4D9FFF]/[0.06] border border-[#4D9FFF]/25">
          <div className="flex items-start gap-3">
            <Globe size={18} className="text-[#4D9FFF] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                No bank file format on file for this country
              </p>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                {result.errors?.[0]}
              </p>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-2">
                The payroll figures for {period} are unaffected — use the Excel export on the
                Summary tab and give your bank its own template.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Answer 2: right country, but the data is not ready ──────────────── */}
      {result && !result.unsupported_country && !result.valid && (
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#FF8C42]/30">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                {period} is not ready yet
              </p>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                {result.errors?.length === 1
                  ? 'One thing is missing.'
                  : `${result.errors?.length} things are missing.`}{' '}
                Fix these and build the file again.
              </p>
            </div>
          </div>

          <ul className="space-y-2">
            {(result.errors ?? []).map((err, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-[#1A1A1A] dark:text-white">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#FF8C42] shrink-0" />
                {err}
              </li>
            ))}
          </ul>

          {result.draft_runs_excluded > 0 && (
            <p className="flex items-start gap-2 text-xs text-[#666666] dark:text-[#A0A0A0] mt-4 pt-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
              <Clock size={13} className="shrink-0 mt-0.5" />
              {result.draft_runs_excluded} draft payroll {result.draft_runs_excluded === 1 ? 'run was' : 'runs were'} left
              out. A bank file only ever contains approved or paid runs — approve them on the
              Payroll Run tab if they belong in {period}.
            </p>
          )}
        </div>
      )}

      {/* ── Answer 3: ready ─────────────────────────────────────────────────── */}
      {result?.valid && (
        <div className="p-6 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#00D4A0]/30">
          <div className="flex items-start gap-3 mb-4">
            <Check size={18} className="text-[#00D4A0] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                {period} is ready
              </p>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                Every employee in this run has the identifiers and bank details the file needs.
              </p>
            </div>
          </div>

          <div className="mb-5">
            <Row label="Employees in file" value={result.scr?.edr_count ?? 0} />
            <Row
              label="Total"
              value={`${Number(result.scr?.total_salary ?? 0).toLocaleString()} ${result.scr?.currency ?? ''}`}
            />
            <Row label="Employer registration" value={result.scr?.employer_mol_id ?? '—'} />
            <Row label="Bank routing code" value={result.scr?.employer_bank_routing_code ?? '—'} />
            <Row label="Salary month" value={result.scr?.salary_month ?? '—'} />
            <Row label="Reference" value={result.scr?.reference ?? '—'} />
          </div>

          <button
            onClick={download}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#00D4A0] text-white hover:bg-[#00B589] transition-colors"
          >
            <Download size={15} />
            Download CSV
          </button>

          {result.draft_runs_excluded > 0 && (
            <p className="flex items-start gap-2 text-xs text-[#666666] dark:text-[#A0A0A0] mt-4">
              <Clock size={13} className="shrink-0 mt-0.5" />
              {result.draft_runs_excluded} draft payroll {result.draft_runs_excluded === 1 ? 'run is' : 'runs are'} not
              in this file.
            </p>
          )}

          {/* The one thing this screen cannot verify for her. Said plainly rather than
              implied by calling the download a ".sif". */}
          <div className="flex items-start gap-2.5 mt-5 pt-5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
            <Info size={15} className="text-[#4D9FFF] shrink-0 mt-0.5" />
            <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
              <span className="font-semibold text-[#1A1A1A] dark:text-white">Confirm the layout with your bank once.</span>{' '}
              The figures and identifiers here come straight from your records and are correct.
              The column order a specific bank's upload form expects is not something BYOND can
              verify on your behalf, so send one file through before you rely on this for a live
              salary run.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
