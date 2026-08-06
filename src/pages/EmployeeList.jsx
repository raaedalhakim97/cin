import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Users,
  Loader2,
  FileDown,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  Inbox,
} from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { exportToExcel, exportToPDF, hasExportableData, localDateStr } from '../utils/exportHelpers'
import ReportTablePDF from '../components/ReportTablePDF'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import EmptyState from '../components/EmptyState'
import Toast, { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import PendingInvitesModal from '../components/employees/PendingInvitesModal'

const CLASSIFICATION_LABEL = {
  full_time_permanent: 'Full-Time Permanent',
  full_time_contract:  'Full-Time Contract',
  part_time:           'Part-Time',
  intern:              'Intern',
  contractor:          'Contractor',
}

const EXPORT_SELECT =
  'full_name, email, phone, job_title, classification, hire_date, status, departments!employees_department_id_fkey(name)'

const STATUS_OPTIONS = [
  { value: '',           label: 'All Statuses' },
  { value: 'invited',    label: 'Invited' },
  { value: 'active',     label: 'Active' },
  { value: 'on_leave',   label: 'On Leave' },
  { value: 'suspended',  label: 'Suspended' },
  { value: 'terminated', label: 'Terminated' },
]

const STATUS_STYLES = {
  invited:    'bg-[#4D9FFF]/10 text-[#4D9FFF]',
  active:     'bg-[#00D4A0]/10 text-[#00D4A0]',
  on_leave:   'bg-[#FF8C42]/10 text-[#FF8C42]',
  suspended:  'bg-[#FF4D4D]/10 text-[#FF4D4D]',
  terminated: 'bg-[#555555]/20 text-[#A0A0A0]',
}

const PAGE_SIZE = 10

function Avatar({ name }) {
  const initials = (name ?? '')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

  return (
    <div className="w-9 h-9 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-xs font-semibold shrink-0">
      {initials}
    </div>
  )
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Excel — object keys become the header row, so these are the display labels directly.
function toExcelRows(data) {
  return (data ?? []).map(e => ({
    Name:           e.full_name,
    Email:          e.email,
    Phone:          e.phone || '',
    'Job Title':    e.job_title || '',
    Department:     e.departments?.name || '',
    Classification: CLASSIFICATION_LABEL[e.classification] ?? e.classification ?? '',
    'Hire Date':    e.hire_date || '',
    Status:         e.status || '',
  }))
}

// PDF — camelCase keys matched against ReportTablePDF's `columns[].key` config.
function toPdfRows(data) {
  return (data ?? []).map(e => ({
    name:           e.full_name,
    email:          e.email,
    phone:          e.phone || '—',
    jobTitle:       e.job_title || '—',
    department:     e.departments?.name || '—',
    classification: CLASSIFICATION_LABEL[e.classification] ?? e.classification ?? '—',
    hireDate:       formatDate(e.hire_date),
    status:         e.status?.replace('_', ' ') || '—',
  }))
}

const PDF_COLUMNS = [
  { key: 'name',           label: 'Name',           width: 16 },
  { key: 'email',          label: 'Email',          width: 20 },
  { key: 'phone',          label: 'Phone',          width: 12 },
  { key: 'jobTitle',       label: 'Job Title',      width: 14 },
  { key: 'department',     label: 'Department',     width: 12 },
  { key: 'classification', label: 'Classification', width: 14 },
  { key: 'hireDate',       label: 'Hire Date',       width: 8 },
  { key: 'status',         label: 'Status',          width: 4 },
]

export default function EmployeeList() {
  const navigate = useNavigate()
  // 'admin' can reach this page since migration 39 (emp_select RLS), but
  // emp_insert stays super_admin/hr_manager only — hide the create action
  // rather than let it 400 on submit.
  const canCreate = useAuthStore(s => s.role) !== 'admin'

  const [employees,    setEmployees]    = useState([])
  const [departments,  setDepartments]  = useState([])
  const [pendingInviteIds, setPendingInviteIds] = useState(new Set()) // employee_id -> has a pending invite
  const [showInvitesModal, setShowInvitesModal] = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(0)
  const [search,       setSearch]       = useState('')
  const [deptFilter,   setDeptFilter]   = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [exportMenuOpen,  setExportMenuOpen]  = useState(false)
  const [exportingExcel,  setExportingExcel]  = useState(false)
  const [exportingPDF,    setExportingPDF]    = useState(false)
  const [fetchError,      setFetchError]      = useState(false)
  const { toast, showToast } = useToast()

  async function fetchAllForExport() {
    const { data, error } = await supabase
      .from('employees')
      .select(EXPORT_SELECT)
      .order('full_name')
    if (error) {
      console.error('[EmployeeList] fetchAllForExport failed', error)
      showToast('error', 'Something went wrong preparing this export. Please try again.')
      return null
    }
    return data ?? []
  }

  async function handleExportExcel() {
    setExportMenuOpen(false)
    setExportingExcel(true)
    const data = await fetchAllForExport()
    setExportingExcel(false)
    if (data === null) return
    const ok = exportToExcel(toExcelRows(data), `employees-${localDateStr()}.xlsx`, 'Employees', showToast)
    if (ok) showToast('success', 'Employee list exported to Excel')
  }

  async function handleExportPDF() {
    setExportMenuOpen(false)
    const data = await fetchAllForExport()
    if (data === null) return
    if (!hasExportableData(data, showToast)) return

    setExportingPDF(true)
    const rows = toPdfRows(data)
    const ok = await exportToPDF(
      <ReportTablePDF
        title="EMPLOYEE REPORT"
        subtitle={`${rows.length} employee${rows.length !== 1 ? 's' : ''} · Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
        columns={PDF_COLUMNS}
        rows={rows}
      />,
      `employees-${localDateStr()}.pdf`,
      showToast,
    )
    setExportingPDF(false)
    if (ok) showToast('success', 'Employee list exported to PDF')
  }

  useEffect(() => {
    supabase
      .from('departments')
      .select('id, name')
      .order('name')
      .then(({ data }) => setDepartments(data ?? []))
  }, [])

  // Drives the "Invite pending" badge below — a lightweight, unpaginated
  // lookup since the number of outstanding invites is normally small. Also
  // reused as the "Pending Invites" button's count and refreshed after
  // creating/revoking an invite so both stay in sync.
  const fetchPendingInviteIds = useCallback(async () => {
    const { data, error } = await supabase.from('employee_invites').select('employee_id').eq('status', 'pending')
    if (error) { console.error('[EmployeeList] fetchPendingInviteIds failed', error); return }
    setPendingInviteIds(new Set((data ?? []).map((r) => r.employee_id)))
  }, [])

  useEffect(() => { fetchPendingInviteIds() }, [fetchPendingInviteIds])

  useEffect(() => {
    fetchEmployees()
  }, [page, search, deptFilter, statusFilter])

  async function fetchEmployees() {
    setLoading(true)
    setFetchError(false)

    let query = supabase
      .from('employees')
      .select(
        'id, user_id, emp_code, full_name, email, job_title, department_id, status, hire_date, departments!employees_department_id_fkey(name)',
        { count: 'exact' }
      )
      .order('full_name')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,email.ilike.%${search}%,job_title.ilike.%${search}%`
      )
    }
    if (deptFilter)   query = query.eq('department_id', deptFilter)
    if (statusFilter) query = query.eq('status', statusFilter)

    const { data, count, error } = await query
    if (error) {
      console.error('[EmployeeList] fetchEmployees failed', error)
      setFetchError(true)
      setEmployees([])
      setTotal(0)
      setLoading(false)
      return
    }
    setEmployees(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function handleSearchChange(e) {
    setSearch(e.target.value)
    setPage(0)
  }

  function handleDeptChange(e) {
    setDeptFilter(e.target.value)
    setPage(0)
  }

  function handleStatusChange(e) {
    setStatusFilter(e.target.value)
    setPage(0)
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-[#1A1A1A] dark:text-white">Employees</h1>
              <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
                {total} total {total === 1 ? 'employee' : 'employees'}
              </p>
            </div>
            {/* flex-wrap, because three text buttons in a row are wider than a
                phone. Without it the row forced the whole document wider than
                the viewport, which is what exposed the unpainted canvas. */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Export dropdown */}
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen(v => !v)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 transition-colors"
                >
                  <FileDown size={16} />
                  Export
                  <ChevronDown size={14} className={`transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {exportMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-64 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-lg z-20 overflow-hidden">
                      <button
                        onClick={handleExportExcel}
                        disabled={exportingExcel}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors disabled:opacity-50"
                      >
                        {exportingExcel
                          ? <Loader2 size={15} className="animate-spin text-[#00D4A0] shrink-0" />
                          : <FileSpreadsheet size={15} className="text-[#00D4A0] shrink-0" />}
                        Export to Excel (.xlsx)
                      </button>
                      <button
                        onClick={handleExportPDF}
                        disabled={exportingPDF}
                        className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-[#1A1A1A] dark:text-white hover:bg-[#F5F5F0] dark:hover:bg-[#252525] transition-colors disabled:opacity-50 border-t border-[#E8E8E8] dark:border-[#2A2A2A]"
                      >
                        {exportingPDF
                          ? <Loader2 size={15} className="animate-spin text-[#FF4D4D] shrink-0" />
                          : <FileText size={15} className="text-[#FF4D4D] shrink-0" />}
                        Export to PDF
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setShowInvitesModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white text-sm font-semibold hover:border-[#00D4A0]/40 transition-colors"
              >
                <Inbox size={16} />
                Pending Invites{pendingInviteIds.size > 0 ? ` (${pendingInviteIds.size})` : ''}
              </button>

              {canCreate && (
                <Link
                  to="/employees/new"
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#00D4A0] hover:bg-[#00B589] text-white text-sm font-semibold transition-colors"
                >
                  <Plus size={16} />
                  Add Employee
                </Link>
              )}
            </div>
          </div>

          {/* Filters row */}
          <div className="flex flex-wrap gap-3 mb-6">
            {/* Search */}
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAAAAA] dark:text-[#555555]"
              />
              <input
                type="text"
                placeholder="Search name, email or title…"
                value={search}
                onChange={handleSearchChange}
                className="w-full pl-9 pr-4 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white placeholder-[#AAAAAA] dark:placeholder-[#555555] focus:outline-none focus:border-[#00D4A0] transition-colors"
              />
            </div>

            {/* Department filter */}
            <select
              value={deptFilter}
              onChange={handleDeptChange}
              className="px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={handleStatusChange}
              className="px-3.5 py-2.5 text-sm rounded-lg bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] text-[#1A1A1A] dark:text-white focus:outline-none focus:border-[#00D4A0] transition-colors"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Table card */}
          <div className="rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-4 animate-pulse">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[#F0F0F0] dark:bg-[#242424] shrink-0" />
                    <div className="flex-1 space-y-2">
                      <SkeletonRow className="h-3 w-1/3" />
                      <SkeletonRow className="h-2.5 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
                <AlertCircle size={32} className="text-[#FF4D4D]" />
                <p className="text-sm font-medium text-[#1A1A1A] dark:text-white">Something went wrong loading employees.</p>
                <button
                  onClick={fetchEmployees}
                  className="bg-[#00D4A0] hover:bg-[#00B589] text-white font-semibold text-sm py-2 px-4 rounded-lg transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : employees.length === 0 ? (
              <div className="py-4">
                <EmptyState
                  icon={Users}
                  title="No employees found"
                  hint="Try adjusting your search or filters."
                  action={(search || deptFilter || statusFilter) ? {
                    label: 'Clear filters',
                    onClick: () => { setSearch(''); setDeptFilter(''); setStatusFilter(''); setPage(0) },
                  } : undefined}
                />
              </div>
            ) : (
              <>
                {/* Mobile: card list */}
                <div className="md:hidden divide-y divide-[#E8E8E8] dark:divide-[#2A2A2A]">
                  {employees.map((emp) => (
                    <div
                      key={emp.id}
                      onClick={() => navigate(`/employees/${emp.id}`)}
                      className="flex items-center gap-3 p-4 active:bg-[#F9F9F7] dark:active:bg-[#252525] cursor-pointer"
                    >
                      <Avatar name={emp.full_name} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white truncate">{emp.full_name}</p>
                          {emp.status === 'invited' && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF]">Invite pending</span>
                          )}
                        </div>
                        <p className="text-xs text-[#666666] dark:text-[#A0A0A0] truncate">
                          {emp.emp_code ? `${emp.emp_code} · ` : ''}{emp.job_title || '—'} · {emp.departments?.name || '—'}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          STATUS_STYLES[emp.status] ??
                          'bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]'
                        }`}
                      >
                        {emp.status?.replace('_', ' ') || '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
                      <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Emp Code
                      </th>
                      <th className="text-left py-3.5 px-5 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Employee
                      </th>
                      <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Job Title
                      </th>
                      <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Department
                      </th>
                      <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Status
                      </th>
                      <th className="text-left py-3.5 px-4 text-xs font-semibold uppercase tracking-wider text-[#666666] dark:text-[#A0A0A0]">
                        Hire Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr
                        key={emp.id}
                        onClick={() => navigate(`/employees/${emp.id}`)}
                        className="border-b border-[#E8E8E8] dark:border-[#2A2A2A] last:border-b-0 hover:bg-[#F9F9F7] dark:hover:bg-[#252525] cursor-pointer transition-colors"
                      >
                        <td className="py-4 px-4 text-xs font-mono text-[#666666] dark:text-[#A0A0A0] whitespace-nowrap">
                          {emp.emp_code || '—'}
                        </td>
                        <td className="py-4 px-5">
                          <div className="flex items-center gap-3">
                            <Avatar name={emp.full_name} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">
                                  {emp.full_name}
                                </p>
                                {emp.status === 'invited' && (
                                  <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#4D9FFF]/10 text-[#4D9FFF]">Invite pending</span>
                                )}
                              </div>
                              <p className="text-xs text-[#666666] dark:text-[#A0A0A0] mt-0.5">
                                {emp.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4 text-sm text-[#1A1A1A] dark:text-white">
                          {emp.job_title || '—'}
                        </td>
                        <td className="py-4 px-4 text-sm text-[#666666] dark:text-[#A0A0A0]">
                          {emp.departments?.name || '—'}
                        </td>
                        <td className="py-4 px-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                              STATUS_STYLES[emp.status] ??
                              'bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#666666] dark:text-[#A0A0A0]'
                            }`}
                          >
                            {emp.status?.replace('_', ' ') || '—'}
                          </span>
                        </td>
                        <td className="py-4 px-4 text-sm text-[#666666] dark:text-[#A0A0A0]">
                          {formatDate(emp.hire_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </>
            )}

            {/* Pagination */}
            {!loading && totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
                <p className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                  Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span className="text-xs text-[#666666] dark:text-[#A0A0A0]">
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {showInvitesModal && (
        <PendingInvitesModal
          canRevoke={canCreate}
          onClose={() => setShowInvitesModal(false)}
          onChanged={fetchPendingInviteIds}
          showToast={showToast}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
