import { useEffect, useState } from 'react'
import { Quote } from 'lucide-react'

// A slow slideshow of the people the product is for.
//
// Photographs are NOT bundled with this repository. Nothing here ships an image
// whose licence has not been checked, because a stock photo used without the
// right licence on a commercial site is a bill, not a design problem. Drop your
// own files into `public/people/` using the names in SLIDES below and they
// appear; until then each slide renders its caption over the mint gradient,
// which is a finished-looking state rather than a broken one.
//
// Where to get them, free for commercial use, no attribution required:
//   unsplash.com/license   ·   pexels.com/license
// Search "office team dubai", "warehouse team", "construction site uae".
// Prefer real working environments over conference-room stock — this section
// sits next to a page that has been careful not to overclaim, and generic
// smiling-people imagery is the fastest way to undo that.
//
// Landscape, at least 1200x800, saved as .jpg. Anything much larger just costs
// your visitors data on a phone.

const SLIDES = [
  {
    src: '/people/team-1.jpg',
    caption: 'The people whose day this actually changes',
    sub: 'Clocking in should take five seconds, not a queue at a clipboard.',
  },
  {
    src: '/people/team-2.jpg',
    caption: 'Managers who want to coach, not chase',
    sub: 'The numbers arrive on their own, so the conversation can be about the work.',
  },
  {
    src: '/people/team-3.jpg',
    caption: 'HR teams who are done with spreadsheets',
    sub: 'Payroll, leave and reviews in one place, built for how the Gulf actually works.',
  },
]

const INTERVAL = 5200

export default function PeopleSlides() {
  const [i, setI] = useState(0)
  // Which images 404'd. A missing file must not leave a torn <img> on the page,
  // so a failed load falls back to the gradient the slide already sits on.
  const [broken, setBroken] = useState({})
  const [paused, setPaused] = useState(false)

  // Respect the OS setting: an auto-advancing carousel is exactly the kind of
  // unrequested motion "reduce motion" exists to stop.
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (paused || reduced) return undefined
    const t = setInterval(() => setI((n) => (n + 1) % SLIDES.length), INTERVAL)
    return () => clearInterval(t)
  }, [paused, reduced])

  return (
    <section
      id="people"
      className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative rounded-[26px] overflow-hidden border border-[#232323] bg-[linear-gradient(150deg,#141414,#0d0d0d)]">
        <div className="relative aspect-[16/10] sm:aspect-[21/9]">
          {SLIDES.map((s, n) => (
            <div
              key={s.src}
              className={`absolute inset-0 transition-opacity duration-1000 ease-out ${
                n === i ? 'opacity-100' : 'opacity-0'
              }`}
              aria-hidden={n !== i}
            >
              {!broken[s.src] && (
                <img
                  src={s.src}
                  alt={s.caption}
                  loading="lazy"
                  onError={() => setBroken((b) => ({ ...b, [s.src]: true }))}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}

              {/* Mint wash + a dark floor, so white text stays readable over any
                  photograph and every slide reads as the same brand rather than
                  three unrelated pictures. */}
              <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(0,212,160,.30),rgba(10,10,10,.35))]" />
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(10,10,10,.92)_8%,rgba(10,10,10,.35)_55%,transparent_85%)]" />

              <div className="absolute inset-x-0 bottom-0 p-7 sm:p-10 lg:p-12">
                <Quote size={20} className="text-[#00D4A0] mb-3" />
                <p className="text-[clamp(20px,2.6vw,34px)] font-extrabold tracking-tight leading-[1.15] max-w-[720px]">
                  {s.caption}
                </p>
                <p className="text-[15px] sm:text-base text-[#C9C9C9] mt-2.5 max-w-[560px]">{s.sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Real buttons, not dots-as-decoration: this is the only way to reach
            slides 2 and 3 without waiting, and on a keyboard at all. */}
        <div className="absolute top-5 right-5 flex gap-2">
          {SLIDES.map((s, n) => (
            <button
              key={s.src}
              type="button"
              onClick={() => setI(n)}
              aria-label={`Show slide ${n + 1}: ${s.caption}`}
              aria-current={n === i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                n === i ? 'w-7 bg-[#00D4A0]' : 'w-3 bg-white/30 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
