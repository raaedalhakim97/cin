import { Navigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

/**
 * Role-based route guard.
 *
 * @param {string[]} [roles] - Allowed roles. Omit to allow any authenticated user.
 *
 * Role hierarchy (from handover):
 *   super_admin > hr_manager > admin > department_manager > employee > read_only
 * ('admin' added migrations 36–37 — an operational role scoped to shift
 * scheduling, not a superset of hr_manager's HR/document permissions.)
 */
export default function PrivateRoute({ children, roles }) {
  const session = useAuthStore((s) => s.session)
  const role = useAuthStore((s) => s.role)

  if (!session) return <Navigate to="/login" replace />

  if (roles && roles.length > 0 && !roles.includes(role)) {
    // Authenticated but wrong role — send to dashboard with 403-equivalent UX
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
