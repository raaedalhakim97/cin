import { Navigate } from 'react-router-dom'
import useAuthStore from '../store/authStore'

/**
 * Route guard.
 *
 * @param {string[]} [roles] - Allowed roles. Omit to allow any authenticated user.
 * @param {boolean} [platformOwner] - Require user_roles.is_platform_owner.
 *
 * Role hierarchy (from handover):
 *   super_admin > hr_manager > admin > department_manager > employee > read_only
 * ('admin' added migrations 36–37 — an operational role scoped to shift
 * scheduling, not a superset of hr_manager's HR/document permissions.)
 *
 * `platformOwner` is deliberately NOT part of that hierarchy and is not a role.
 * It sits beside it: role decides what you may do inside one company, platform
 * ownership decides whether you may see across companies at all. A tenant's
 * super_admin is not a platform owner. Gating an operator page on
 * roles={['super_admin']} would hand every customer's owner the operator surface.
 *
 * Both guards are convenience, not enforcement. Routing lives in a bundle the
 * browser already has, so the real boundary is in the database — RLS on `company`
 * and the refusal inside platform_company_overview(). This only spares someone a
 * page that would come back empty or error.
 */
export default function PrivateRoute({ children, roles, platformOwner }) {
  const session = useAuthStore((s) => s.session)
  const role = useAuthStore((s) => s.role)
  const isPlatformOwner = useAuthStore((s) => s.isPlatformOwner)

  if (!session) return <Navigate to="/login" replace />

  if (platformOwner && !isPlatformOwner) {
    return <Navigate to="/unauthorized" replace />
  }

  if (roles && roles.length > 0 && !roles.includes(role)) {
    // Authenticated but wrong role — send to dashboard with 403-equivalent UX
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
