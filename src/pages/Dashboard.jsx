import { AlertTriangle } from 'lucide-react'
import useAuthStore from '../store/authStore'
import Sidebar from '../components/layout/Sidebar'
import Header from '../components/layout/Header'
import GreetingHeader from '../components/dashboard/GreetingHeader'
import EmployeeDashboard from './dashboards/EmployeeDashboard'
import ManagerDashboard from './dashboards/ManagerDashboard'
import HRDashboard from './dashboards/HRDashboard'
import AdminDashboard from './dashboards/AdminDashboard'
import OperationsDashboard from './dashboards/OperationsDashboard'
import GenericDashboard from './dashboards/GenericDashboard'

// Role-aware dashboard dispatcher (session 32). Sidebar/Header/greeting are
// rendered once here rather than duplicated in every role dashboard; each
// dashboard component below renders only its own stats row + panels.
// `read_only` and any unrecognized role fall back to `GenericDashboard` —
// the pre-session-32 dashboard content, moved there as-is. Read-only
// auditors get a role-specific dashboard in a future round, per the task.
function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-19 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-64 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]" />
        <div className="h-64 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]" />
      </div>
    </div>
  )
}

function NotLinkedNotice({ email }) {
  return (
    <div className="flex items-start gap-3 p-5 rounded-xl bg-[#FF8C42]/10 border border-[#FF8C42]/20">
      <AlertTriangle size={18} className="text-[#FF8C42] shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-[#FF8C42]">Account not linked</p>
        <p className="text-sm text-[#666666] dark:text-[#A0A0A0] mt-1">
          Your login ({email}) is not linked to an employee record yet.
          Please contact your HR manager to complete setup.
        </p>
      </div>
    </div>
  )
}

function renderRoleDashboard(role, employee) {
  switch (role) {
    case 'employee':           return <EmployeeDashboard />
    case 'department_manager': return <ManagerDashboard />
    case 'hr_manager':         return <HRDashboard />
    case 'super_admin':        return <AdminDashboard />
    case 'admin':              return <OperationsDashboard />
    case 'read_only':
    default:                   return <GenericDashboard employee={employee} />
  }
}

export default function Dashboard() {
  const role         = useAuthStore(s => s.role)
  const employee     = useAuthStore(s => s.employee)
  const session      = useAuthStore(s => s.session)
  const authLoading  = useAuthStore(s => s.loading)

  return (
    <div className="flex min-h-screen bg-[#F5F5F0] dark:bg-[#0F0F0F]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col lg:ml-60">
        <Header />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <GreetingHeader name={employee?.full_name} />

          {authLoading ? (
            <DashboardSkeleton />
          ) : !employee ? (
            <NotLinkedNotice email={session?.user?.email} />
          ) : (
            renderRoleDashboard(role, employee)
          )}
        </main>
      </div>
    </div>
  )
}
