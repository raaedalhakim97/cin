// Brand mark ported from "BYOND Website.dc.html" (Claude Design export) —
// dark rounded-square chip + mint upward arrow, paired with the "BY[O]ND"
// wordmark (the O is always mint). The chip is self-contained (its own dark
// fill) so it reads correctly on both light and dark page backgrounds;
// `variant` only controls the wordmark text colour.
//
// `auto` is the default and is what almost every caller wants: the wordmark
// follows the theme in CSS, one element, no JavaScript.
//
// It exists because the alternative was rendering the logo TWICE and hiding one
// with `dark:hidden` / `hidden dark:inline-flex` — which silently did not work.
// The root span below sets `inline-flex`, and `hidden` is a display utility
// too. Tailwind emits display utilities in a fixed order with `inline-flex`
// after `hidden`, so the base class won and BOTH logos rendered: the light one,
// and beside it a white wordmark on a white page, invisible unless you
// selected the text. Class-attribute order cannot fix that; not needing the
// second element can.
//
// Pass `light` or `dark` only to force a colour regardless of theme — the
// marketing site and the legal pages are always dark, so they force `dark`.
const SIZES = {
  sm: { icon: 22, text: 'text-base' },   // sidebar header
  md: { icon: 32, text: 'text-xl' },     // login screen
  lg: { icon: 30, text: 'text-xl' },     // marketing nav / footer
  xl: { icon: 44, text: 'text-3xl' },    // hero / CTA sections
}

const WORDMARK_COLOR = {
  auto:  'text-[#1A1A1A] dark:text-white',
  light: 'text-[#1A1A1A]', // dark ink, for a light background
  dark:  'text-white',     // light ink, for a dark background
}

export default function Logo({ size = 'md', variant = 'auto', showWordmark = true, className = '' }) {
  const { icon, text } = SIZES[size] ?? SIZES.md
  const height = Math.round(icon * 1.16)

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width={icon}
        height={height}
        viewBox="0 0 100 116"
        fill="none"
        className="shrink-0"
        aria-hidden="true"
      >
        <rect x="6" y="26" width="88" height="88" rx="24" fill="#1E1E1E" />
        <path d="M50 100 L50 22" stroke="#00D4A0" strokeWidth="13" strokeLinecap="round" />
        <path
          d="M27 42 L50 15 L73 42"
          stroke="#00D4A0"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      {showWordmark && (
        <span
          className={`font-extrabold tracking-tight ${text} ${
            WORDMARK_COLOR[variant] ?? WORDMARK_COLOR.auto
          }`}
        >
          BY<span className="text-[#00D4A0]">O</span>ND
        </span>
      )}
    </span>
  )
}
