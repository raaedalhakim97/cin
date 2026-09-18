import { Link } from 'react-router-dom'
import Logo from '../Logo'

// The left half of /login.
//
// It says what the name means, because the login is the first thing most employees ever
// see of BYOND — they are sent a link by their HR team, not shown a marketing site. The
// old page gave them a 384px card floating in an empty screen, which told them nothing
// about what they were signing in to.
//
// The five letters and their words are the same ones on the marketing page (Landing.jsx).
// They are repeated here rather than imported because Landing's copy carries a third field
// and animation delays this panel has no use for, and because two screens agreeing on five
// words is not the kind of coupling worth a shared module.
//
// The panel stays dark in both themes, like the marketing site and the legal pages. It is
// the brand side; it does not follow the workspace theme, and the form beside it does.
const ACRONYM = [
  { letter: 'B', word: 'Better' },
  { letter: 'Y', word: 'Yield' },
  { letter: 'O', word: 'Outstanding', mint: true },
  { letter: 'N', word: 'Next-Level' },
  { letter: 'D', word: 'Development' },
]

export default function BrandPanel() {
  return (
    <div className="hidden lg:flex w-[520px] shrink-0 relative flex-col justify-between
                    px-12 py-11 bg-[#0F0F0F] border-r border-[#1E1E1E] overflow-hidden">
      {/* The O again, enormous and almost invisible — the letter the product already owns.
          aria-hidden and unselectable: it is texture, and a screen reader announcing a
          lone "O" before the sign-in form is noise. */}
      <span
        aria-hidden="true"
        className="absolute -right-28 -top-36 text-[420px] font-extrabold leading-none
                   tracking-[-0.05em] text-[rgba(0,212,160,0.045)] pointer-events-none select-none"
      >
        O
      </span>

      <Link to="/" aria-label="BYOND home" className="relative">
        <Logo size="lg" variant="dark" />
      </Link>

      <div className="relative flex flex-col gap-[18px]">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#00D4A0]">
          What the name stands for
        </p>
        <div className="flex flex-col gap-3.5">
          {ACRONYM.map(({ letter, word, mint }) => (
            <div key={letter} className="flex items-baseline gap-4">
              <span
                className={`w-[34px] shrink-0 text-3xl font-extrabold leading-none tracking-tight ${
                  mint ? 'text-[#00D4A0]' : 'text-[#8A8A8A]'
                }`}
              >
                {letter}
              </span>
              <span
                className={`text-[19px] font-semibold tracking-tight ${
                  mint ? 'text-white' : 'text-[#C8C8C8]'
                }`}
              >
                {word}
              </span>
            </div>
          ))}
        </div>
      </div>

      <p className="relative text-xs text-[#8A8A8A]">BYOND by SERVA &mdash; HR Platform</p>
    </div>
  )
}
