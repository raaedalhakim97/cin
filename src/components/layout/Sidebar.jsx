import { Link, useLocation } from 'react-router-dom'
import { LogOut, X } from 'lucide-react'
import useAuthStore from '../../store/authStore'
import { visibleNavFor } from '../../data/navigation'
import useUiStore from '../../store/uiStore'
import Logo from '../Logo'

export default function Sidebar() {
  const location = useLocation()
  const signOut = useAuthStore(s => s.signOut)
  const role = useAuthStore(s => s.role)
  const isPlatformOwner = useAuthStore(s => s.isPlatformOwner)
  const mobileNavOpen = useUiStore(s => s.mobileNavOpen)
  const closeMobileNav = useUiStore(s => s.closeMobileNav)

  // Item list and the rule that filters it both live in data/navigation.js, so the
  // role preview on /permissions can show exactly this and cannot drift from it.
  const visibleItems = visibleNavFor({ role, isPlatformOwner })

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
          {/* Default variant follows the theme in CSS, so the sidebar no longer
              needs to read the theme store just to colour a wordmark. */}
          <Logo size="sm" />
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
