import { Sun, Moon, User, Menu } from 'lucide-react'
import useAuthStore from '../../store/authStore'
import useThemeStore from '../../store/themeStore'
import useUiStore from '../../store/uiStore'
import TrialBanner from '../TrialBanner'

const roleLabel = {
  super_admin:        'Super Admin',
  hr_manager:         'HR Manager',
  admin:              'Admin',
  department_manager: 'Dept. Manager',
  employee:           'Employee',
  read_only:          'Read Only',
}

export default function Header() {
  const employee = useAuthStore(s => s.employee)
  const role     = useAuthStore(s => s.role)
  const { isDark, toggle } = useThemeStore()
  const toggleMobileNav = useUiStore(s => s.toggleMobileNav)

  return (
    <>
      <TrialBanner />
      <header className="flex items-center justify-between h-16 px-4 sm:px-8 bg-white dark:bg-[#1A1A1A] border-b border-[#E8E8E8] dark:border-[#2A2A2A]">
      <button
        onClick={toggleMobileNav}
        className="lg:hidden w-9 h-9 -ml-2 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      <div className="hidden lg:block" />

      <div className="flex items-center gap-2 sm:gap-4">

        {/* Theme toggle */}
        <button
          onClick={toggle}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Role badge */}
        {role && (
          <span className="hidden sm:inline-block text-xs px-2.5 py-1 rounded-full font-semibold bg-[#00D4A0]/10 text-[#00D4A0]">
            {roleLabel[role] ?? role}
          </span>
        )}

        {/* Avatar + name */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#00D4A0] flex items-center justify-center text-white text-sm font-semibold shrink-0">
            {employee?.full_name?.[0]?.toUpperCase() ?? <User size={14} />}
          </div>
          <span className="hidden sm:inline text-sm font-medium text-[#1A1A1A] dark:text-white">
            {employee?.full_name ?? 'Account'}
          </span>
        </div>
      </div>
      </header>
    </>
  )
}
