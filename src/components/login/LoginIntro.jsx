import { useEffect, useMemo, useState } from 'react'

// The way into the product.
//
// It is the same move as the profile intro, turned inside out. On /profile the O closes
// around one person's face — it shrinks the company's name down to them. Here it does the
// opposite job: BYOND lands, B Y N D step aside, and the O keeps opening until it is the
// aperture the whole login arrives through.
//
// That is why this one plays on every visit and the profile one is a greeting. This is the
// front door. A door that only opens the first time is not a door.
//
// ── How the reveal is actually done ────────────────────────────────────────
//
// The dark backdrop is a separate fixed layer, and the page is clipped to a circle that
// grows past the corners of the screen. Clipping the PAGE rather than punching a hole in
// the cover is what makes the login appear to be behind the letters the whole time,
// instead of fading in over them.
//
// The content sits at opacity 0 until the moment the iris opens, with no transition on it.
// Without that, the 38px circle of login visible at dead centre from the first frame sits
// underneath the O — a small bright dot inside the letter, which reads as a rendering
// fault rather than a promise.
//
// prefers-reduced-motion skips the whole thing. Not a shorter version: the page renders
// settled, unclipped, with no overlay ever mounted.

const BYOND_LETTERS = ['B', 'Y', 'O', 'N', 'D']

// Stage boundaries in ms.
//   1 — B Y N D step aside
//   2 — the O goes, a beat after them, so the last thing on screen is the mint letter alone
//   3 — the iris opens and the ring grows with it
//   4 — the ring fades, having outrun the screen
//   5 — done; every overlay unmounts and the clip comes off
const STAGE_AT = [0, 950, 1050, 1250, 1950, 2150]

const DONE = STAGE_AT.length - 1

// The aperture and the ring are the same circle — the ring is meant to BE its edge, not a
// second circle chasing it. So both are sized in vmax off one number and share an easing
// and a duration: the ring element is 2 × RADIUS across, so scale 1 puts its stroke exactly
// on the clip boundary at every frame.
//
// Expressed in pixels instead, the two drift apart the moment the window is not the size it
// was tuned at — which is how the first cut of this looked: the page was already fully
// revealed while a mint circle was still crawling outwards through the middle of it.
//
// 100vmax clears the corner of any viewport (half-diagonal is at most ~0.71 × vmax), and
// 3vmax is about the size of the O glyph it grows out of on both a phone and a monitor.
const RADIUS = 100 // vmax
const START = 0.03 // of RADIUS

const OPEN = `circle(${RADIUS}vmax at 50% 50%)`
const SHUT = `circle(${RADIUS * START}vmax at 50% 50%)`

const IRIS_EASE = 'cubic-bezier(.4,0,.2,1)'
const IRIS_MS = 900

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function LoginIntro({ children }) {
  // Decided once, synchronously, before the first paint — deciding it inside an effect
  // would show one frame of the intro to somebody who asked never to see one.
  const shouldPlay = useMemo(() => !prefersReducedMotion(), [])

  const [stage, setStage] = useState(shouldPlay ? 0 : DONE)
  const [entered, setEntered] = useState(!shouldPlay)

  useEffect(() => {
    if (!shouldPlay) return

    // One frame late on purpose: the letters need a state to transition FROM.
    const raf = requestAnimationFrame(() => setEntered(true))
    const timers = STAGE_AT.slice(1).map((at, i) =>
      setTimeout(() => setStage(i + 1), at)
    )

    return () => {
      cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
    }
  }, [shouldPlay])

  const running = stage < DONE
  const opening = stage >= 3

  return (
    <>
      {running && (
        <div className="fixed inset-0 z-30 bg-[#0F0F0F]" aria-hidden="true" />
      )}

      <div
        className={running ? 'relative z-40 pointer-events-none' : undefined}
        style={
          running
            ? {
                clipPath: opening ? OPEN : SHUT,
                WebkitClipPath: opening ? OPEN : SHUT,
                transition: `clip-path ${IRIS_MS}ms ${IRIS_EASE}`,
                opacity: opening ? 1 : 0,
              }
            : undefined
        }
      >
        {children}
      </div>

      {running && (
        <>
          {/* The ring the O becomes. It grows with the iris and is gone before it could be
              mistaken for a border — by the time it fades it is already off-screen.

              Its SIZE is animated rather than a transform, which is the slower of the two
              and chosen deliberately: scaling the element scales its stroke with it, so a
              3px ring starts life at 0.09px and the first third of the opening has nothing
              visible in it at all. A constant stroke is the whole job of this element. It
              is one fixed-position span with no dependents, so there is nothing for the
              size change to reflow. */}
          <span
            aria-hidden="true"
            className="fixed left-1/2 top-1/2 z-[45] -translate-x-1/2 -translate-y-1/2
                       rounded-full border-[3px] border-[#00D4A0] pointer-events-none"
            style={{
              width: `${RADIUS * 2 * (opening ? 1 : START)}vmax`,
              height: `${RADIUS * 2 * (opening ? 1 : START)}vmax`,
              opacity: opening && stage < 4 ? 1 : 0,
              transition: `width ${IRIS_MS}ms ${IRIS_EASE}, height ${IRIS_MS}ms ${IRIS_EASE}, opacity 200ms ease-out`,
            }}
          />

          {stage < 3 && (
            <div
              aria-hidden="true"
              className="fixed inset-0 z-50 flex items-center justify-center gap-2.5 pointer-events-none"
            >
              {BYOND_LETTERS.map((ch, i) => {
                const isO = ch === 'O'
                // The outer four leave at stage 1; the O holds one beat longer and then
                // fades, so the last thing on a dark screen is the mint letter by itself.
                const gone = isO ? stage >= 2 : stage >= 1

                // Each letter gets a fixed-width box so the O holds dead centre while the
                // others leave. As one text node the remaining glyphs would re-centre and
                // the O would drift off the point the ring is about to occupy.
                return (
                  <span
                    key={ch + i}
                    className={`block w-[38px] sm:w-[52px] text-center text-5xl sm:text-[72px] font-extrabold leading-none tracking-[-0.03em] ${
                      isO ? 'text-[#00D4A0]' : 'text-white'
                    }`}
                    style={{
                      opacity: !entered || gone ? 0 : 1,
                      transform: !entered
                        ? 'translateY(14px)'
                        : gone && !isO
                          ? `translateX(${i < 2 ? '-26px' : '26px'})`
                          : 'none',
                      transition: 'opacity 400ms ease-out, transform 400ms ease-out',
                      // The stagger belongs to the entrance only. Carried into the exit it
                      // would hold D on screen 240ms after B, long past the iris opening.
                      transitionDelay: stage === 0 ? `${i * 60}ms` : '0ms',
                    }}
                  >
                    {ch}
                  </span>
                )
              })}
            </div>
          )}
        </>
      )}
    </>
  )
}
