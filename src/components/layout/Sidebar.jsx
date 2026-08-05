import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  CalendarOff,
  CreditCard,
  BarChart3,
  BarChart2,
  Newspaper,
  Inbox,
  Settings,
  ShieldCheck,
  FileText,
  Calendar,
  CalendarClock,
  LogOut,
  X,
  UserCircle,
} from 'lucide-react'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import useUiStore from '../../store/uiStore'
import Logo from '../Logo'

// `roles` is optional — items without it render for everyone (route-level
// guards in App.jsx are what actually block access); only items that should
// be hidden entirely from other roles (not just redirected) set it.
// Migration 42 — 'employee' loses Employees-list access entirely (matches
// EMPLOYEES_LIST_ROLES in App.jsx) and Settings access entirely (they keep
// My Schedule/My KPI/Leave/News, plus the new My Profile page below).
// Session 42: Settings narrowed further to just super_admin/hr_manager —
// once My Privacy & Data moved to /profile for everyone, 'admin'/
// 'department_manager'/'read_only' had nothing left to see there either
// (matches SETTINGS_ROLES in App.jsx).
const SETTINGS_NAV_ROLES = ['super_admin', 'hr_manager']

const navItems = [
  { label: 'Dashboard',       icon: LayoutDashboard, path: '/dashboard',      live: true },
  { label: 'My Profile',      icon: UserCircle,       path: '/profile',        live: true },
  { label: 'Employees',       icon: Users,            path: '/employees',      live: true, roles: ['super_admin', 'hr_manager', 'admin'] },
  { label: 'Attendance',      icon: CalendarCheck,    path: '/attendance',     live: true },
  { label: 'Leave',           icon: CalendarOff,      path: '/leave',          live: true },
  { label: 'Payroll',         icon: CreditCard,       path: '/payroll',        live: true },
  { label: 'KPI Scores',      icon: BarChart3,        path: '/kpi',            live: true },
  { label: 'Team Analytics',  icon: BarChart2,        path: '/team-analytics', live: true, roles: ['super_admin', 'hr_manager'] },
  { label: 'HR Documents',    icon: FileText,         path: '/documents',      live: true, roles: ['super_admin', 'hr_manager', 'admin'] },
  { label: 'Schedule',        icon: Calendar,         path: '/schedule',       live: true, roles: ['super_admin', 'hr_manager', 'admin'] },
  { label: 'My Schedule',     icon: CalendarClock,    path: '/my-schedule',    live: true },
  { label: 'News Feed',       icon: Newspaper,        path: '/news',           live: true },
  { label: 'Leads',           icon: Inbox,            path: '/leads',          live: true, roles: ['super_admin'] },
  { label: 'Settings',        icon: Settings,         path: '/settings',       live: true, roles: SETTINGS_NAV_ROLES },
  { label: 'Permissions',     icon: ShieldCheck,      path: '/permissions',    live: true, roles: ['super_admin'] },
]

export default function Sidebar() {
  const location = useLocation()
  const signOut = useAuthStore(s => s.signOut)
  const role = useAuthStore(s => s.role)
  const isDark = useThemeStore(s => s.isDark)
  const mobileNavOpen = useUiStore(s => s.mobileNavOpen)
  const closeMobileNav = useUiStore(s => s.closeMobileNav)

  const visibleItems = navItems.filter(item => !item.roles || item.roles.includes(role))

  return (
    <>
      {/* Mobile backdrop — tapping it closes the drawer */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-60 flex flex-col bg-white dark:bg-[#1A1A1A] border-r border-[#E8E8E8] dark:border-[#2A2A2A] z-50 transform transition-transform duration-200 lg:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >

        {/* Logo */}
        <div className="px-6 py-5 border-b border-[#E8E8E8] dark:border-[#2A2A2A] flex items-center justify-between">
          <Logo size="sm" variant={isDark ? 'dark' : 'light'} />
          <button
            onClick={closeMobileNav}
            className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {visibleItems.map(({ label, icon: Icon, path, live }) => {
            const isActive = live && (
              location.pathname === path || location.pathname.startsWith(path + '/')
            )
            if (live) {
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={closeMobileNav}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#00D4A0]/10 text-[#00D4A0]'
                      : 'text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white'
                  }`}
                >
                  <Icon size={18} />
                  {label}
                </Link>
              )
            }
            return (
              <div
                key={path}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-sm cursor-not-allowed text-[#AAAAAA] dark:text-[#555555]"
              >
                <Icon size={18} />
                {label}
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#E8E8E8] dark:bg-[#2A2A2A] text-[#AAAAAA] dark:text-[#555555] font-medium">
                  Soon
                </span>
              </div>
            )
          })}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
          <button
            onClick={signOut}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-medium text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
