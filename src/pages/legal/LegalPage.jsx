import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Logo from '../../components/Logo'

// Shared shell for /privacy and /terms.
//
// These render on the marketing side of the app: no session, no Supabase call,
// same black-and-mint treatment as Landing so following a footer link does not
// feel like leaving the site. Kept deliberately plain — legal text is read, not
// admired, and every scroll reveal or animation here is an obstacle.

export default function LegalPage({ title, updated, children }) {
  // Landing sets the title implicitly by being the index route; these pages are
  // reached directly and shared as links, so they name themselves.
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · BYOND HR`
    return () => { document.title = previous }
  }, [title])

  return (
    <div className="bg-[#0A0A0A] text-[#F5F5F5] min-h-screen selection:bg-[#00D4A0] selection:text-[#062b22]">
      <header className="border-b border-[#1a1a1a]">
        <div className="max-w-[820px] mx-auto px-6 sm:px-8 py-6 flex items-center justify-between gap-4">
          <Link to="/"><Logo size="md" variant="dark" /></Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors"
          >
            <ArrowLeft size={15} />
            Back to site
          </Link>
        </div>
      </header>

      <main className="max-w-[820px] mx-auto px-6 sm:px-8 py-14 lg:py-20">
        <h1 className="text-[clamp(30px,4vw,44px)] font-extrabold tracking-tight leading-[1.08]">{title}</h1>
        <p className="text-sm text-[#6E6E6E] mt-3">Last updated {updated}</p>

        {/* Vertical rhythm comes from `.legal-prose` in index.css — the margin
            utilities cannot be used here, see the comment beside that block.
            Colour and weight are fine as utilities: nothing resets those. */}
        <div
          className="legal-prose mt-10 text-[15px] leading-relaxed text-[#B5B5B5]
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-[#F5F5F5]
            [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-[#F5F5F5]
            [&_a]:text-[#00D4A0] [&_a]:underline [&_a]:underline-offset-2
            [&_strong]:text-[#E5E5E5] [&_strong]:font-semibold"
        >
          {children}
        </div>
      </main>

      <footer className="border-t border-[#1a1a1a] mt-10">
        <div className="max-w-[820px] mx-auto px-6 sm:px-8 py-8 flex flex-col sm:flex-row justify-between gap-3 text-[13px] text-[#6E6E6E]">
          <span>© 2026 BYOND by SERVA · Dubai, UAE</span>
          <span className="flex gap-3">
            <Link to="/privacy" className="hover:text-[#B5B5B5] transition-colors">Privacy</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms" className="hover:text-[#B5B5B5] transition-colors">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  )
}
