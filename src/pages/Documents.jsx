import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Building2, Users, AlertTriangle, Search, FileSpreadsheet, Loader2,
  ChevronUp, ChevronDown,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { exportToExcel, hasExportableData, localDateStr } from '../utils/exportHelpers'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import EmptyState from '../components/EmptyState'
import ToastComp, { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import DocumentTypeGrid from '../components/documents/DocumentTypeGrid'

// Mirrors hr_documents_with_status.expiry_status — see DocumentTypeGrid.jsx
const EXPIRY_META = {
  expiring_soon:     { label: 'Expiring Soon',     cls: 'bg-[#FF8C42]/10 text-[#FF8C42]' },
  expiring_critical: { label: 'Expiring Critical', cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
  expired:           { label: 'Expired',           cls: 'bg-[#FF4D4D]/10 text-[#FF4D4D]' },
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// ─── Employee Documents tab ─────────────────────────────────────────────────

function EmployeeDocumentsTab({ companyId, currentEmployeeId, canManage, showToast }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!search.trim() || (selected && search === selected.full_name)) {
      setResults([])
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('employees')
        .select('id, full_name, job_title, departments!employees_department_id_fkey(name)')
        .ilike('full_name', `%${search.trim()}%`)
        .order('full_name')
        .limit(8)
      setResults(data ?? [])
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [search, selected])

  function pickEmployee(emp) {
    setSelected(emp)
    setSearch(emp.full_name)
    setOpen(false)
  }

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555]" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); if (selected && e.target.value !== selected.full_name) setSelected(null) }}
          onFocus={() => setOpen(true)}
          placeholder="Search employee by name…"
          className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] focus:outline-none focus:border-[#00D4A0] transition-colors"
        />
        {open && search.trim() && !(selected && search === selected.full_name) && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute left-0 right-0 mt-2 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-lg z-20 max-h-64 overflow-y-auto">
              {searching ? (
                <div className="p-4 flex justify-center"><Loader2 size={16} className="animate-spin text-[#00D4A0]" /></div>
              ) : results.length === 0 ? (
                <p className="p-4 text-sm text-[#666666] dark:text-[#A0A0A0]">No employees found</p>
              ) : (
                results.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => pickEmployee(emp)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-[10px] font-semibold shrink-0">
                      {initials(emp.full_name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1A1A1A] dark:text-white truncate">{emp.full_name}</p>
                      <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">{emp.job_title || '—'} · {emp.departments?.name || '—'}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {!selected ? (
        <EmptyState icon={Users} title="Select an employee" hint="Search by name above to view and manage their documents." />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials(selected.full_name)}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{selected.full_name}</p>
              <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">{selected.job_title || '—'} · {selected.departments?.name || '—'}</p>
            </div>
          </div>
          <DocumentTypeGrid
            scope="employee"
            employeeId={selected.id}
            companyId={companyId}
            currentEmployeeId={currentEmployeeId}
            canManage={canManage}
            showToast={showToast}
          />
        </>
      )}
    </div>
  )
}

// ─── Expiry Tracker tab ─────────────────────────────────────────────────────

const DAY_OPTIONS = [7, 30, 60, 90]
const SCOPE_OPTIONS = [
  { value: '', label: 'All Scopes' },
  { value: 'employee', label: 'Employee' },
  { value: 'company', label: 'Company' },
]
const COLUMNS = [
  { key: 'subjectName', label: 'Subject' },
  { key: 'typeLabel', label: 'Document Type' },
  { key: 'scope', label: 'Scope' },
  { key: 'expiry_date', label: 'Expiry Date' },
  { key: 'days_until_expiry', label: 'Days Left' },
  { key: 'expiry_status', label: 'Status' },
]

function ExpiryTrackerTab({ showToast }) {
  const [rows, setRows] = useState([])
  const [typesById, setTypesById] = useState({})
  const [employeesById, setEmployeesById] = useState({})
  const [loading, setLoading] = useState(true)
  const [dayFilter, setDayFilter] = useState(30)
  const [scopeFilter, setScopeFilter] = useState('')
  const [sortKey, setSortKey] = useState('days_until_expiry')
  const [sortDir, setSortDir] = useState('asc')
  const [exporting, setExporting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: docRows }, { data: typeRows }] = await Promise.all([
      supabase
        .from('hr_documents_with_status')
        .select('*')
        .in('expiry_status', ['expiring_soon', 'expiring_critical', 'expired']),
      supabase.from('document_types').select('id, label, category'),
    ])
    setTypesById(Object.fromEntries((typeRows ?? []).map((t) => [t.id, t])))

    const empIds = [...new Set((docRows ?? []).filter((d) => d.employee_id).map((d) => d.employee_id))]
    let empMap = {}
    if (empIds.length) {
      const { data: empRows } = await supabase.from('employees').select('id, full_name').in('id', empIds)
      empMap = Object.fromEntries((empRows ?? []).map((e) => [e.id, e]))
    }
    setEmployeesById(empMap)
    setRows(docRows ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const shaped = rows
    .filter((r) => (scopeFilter ? r.scope === scopeFilter : true))
    // days_until_expiry is null only for no_expiry rows, which the base
    // query already excludes (expiry_status is never 'no_expiry' here) —
    // the null check is defensive. Negative (expired) values always pass.
    .filter((r) => r.days_until_expiry != null && r.days_until_expiry <= dayFilter)
    .map((r) => ({
      ...r,
      typeLabel: typesById[r.document_type_id]?.label ?? '—',
      category: typesById[r.document_type_id]?.category ?? '—',
      subjectName: r.scope === 'employee' ? (employeesById[r.employee_id]?.full_name ?? '—') : 'Company',
    }))

  const sorted = [...shaped].sort((a, b) => {
    const av = a[sortKey]
    const bv = b[sortKey]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
  })

  async function handleExport() {
    if (!hasExportableData(sorted, showToast)) return
    setExporting(true)
    const exportRows = sorted.map((r) => ({
      Subject: r.subjectName,
      Scope: r.scope,
      'Document Type': r.typeLabel,
      Category: r.category,
      'Expiry Date': r.expiry_date ?? '',
      'Days Left': r.days_until_expiry,
      Status: EXPIRY_META[r.expiry_status]?.label ?? r.expiry_status,
    }))
    const ok = exportToExcel(exportRows, `document-expiry-tracker-${localDateStr()}.xlsx`, 'Expiry Tracker', showToast)
    setExporting(false)
    if (ok) showToast('success', 'Expiry tracker exported')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDayFilter(d)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  dayFilter === d ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="px-3.5 py-2 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
          >
            {SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 disabled:opacity-50 transition-colors"
        >
          {exporting ? <Loader2 size={15} className="animate-spin text-[#00D4A0]" /> : <FileSpreadsheet size={15} className="text-[#00D4A0]" />}
          Export to Excel
        </button>
      </div>

      <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} className="h-10" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-4">
            <EmptyState icon={AlertTriangle} title="Nothing expiring in this window" hint="Try a wider day range or a different scope." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className="px-5 py-3 text-left text-xs font-semibold text-[#666666] dark:text-[#A0A0A0] uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
                    >
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortKey === c.key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                {sorted.map((r) => {
                  const meta = EXPIRY_META[r.expiry_status]
                  return (
                    <tr key={r.id} className="hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-[#1A1A1A] dark:text-white whitespace-nowrap">{r.subjectName}</td>
                      <td className="px-4 py-3.5 text-[#1A1A1A] dark:text-white whitespace-nowrap">{r.typeLabel}</td>
                      <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] capitalize">{r.scope}</td>
                      <td className="px-4 py-3.5 text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">{formatDate(r.expiry_date)}</td>
                      <td className={`px-4 py-3.5 font-semibold whitespace-nowrap ${r.days_until_expiry < 0 ? 'text-[#FF4D4D]' : 'text-[#1A1A1A] dark:text-white'}`}>
                        {r.days_until_expiry < 0 ? `${Math.abs(r.days_until_expiry)}d overdue` : `${r.days_until_expiry}d`}
                      </td>
                      <td className="px-4 py-3.5">
                        {meta && <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Documents() {
  const employee = useAuthStore((s) => s.employee)
  const role = useAuthStore((s) => s.role)
  const companyId = useAuthStore((s) => s.companyId)
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') === 'expiry' ? 'expiry' : 'company')
  const { toast, showToast } = useToast()

  // Migration 38: hr_documents_select/hr_documents_write RLS now include
  // 'admin' (document_types stays HR-only — see App.jsx's role-constants
  // comment). Migration 39 additionally extended `emp_select` to 'admin',
  // so the Employee Documents tab's name search and the Expiry Tracker's
  // subject-name lookup (both query `employees` directly) now work for this
  // role too — no frontend change was needed for either, since neither ever
  // special-cased the role; they just return real rows instead of an
  // RLS-empty set now.
  const canManage = role === 'super_admin' || role === 'hr_manager' || role === 'admin'

  const tabs = [
    { id: 'company', label: 'Company Documents', icon: Building2 },
    { id: 'employee', label: 'Employee Documents', icon: Users },
    { id: 'expiry', label: 'Expiry Tracker', icon: AlertTriangle },
  ]

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">HR Documents</h1>
            <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
              Company and employee documents, compliance, and expiry tracking
            </p>
          </div>

          <div className="flex gap-1 p-1 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] w-fit mb-8 overflow-x-auto">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  activeTab === id ? 'bg-[#00D4A0]/10 text-[#00D4A0]' : 'text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'company' && (
            <DocumentTypeGrid
              scope="company"
              employeeId={null}
              companyId={companyId}
              currentEmployeeId={employee?.id}
              canManage={canManage}
              showToast={showToast}
            />
          )}
          {activeTab === 'employee' && (
            <EmployeeDocumentsTab
              companyId={companyId}
              currentEmployeeId={employee?.id}
              canManage={canManage}
              showToast={showToast}
            />
          )}
          {activeTab === 'expiry' && (
            <ExpiryTrackerTab showToast={showToast} />
          )}
        </main>
      </div>

      <ToastComp toast={toast} />
    </div>
  )
}
