import { useEffect, useMemo, useState } from 'react'

// The way into your own profile.
//
// It opens on BYOND with the O already mint — the letter the acronym marks in Landing.jsx:
// O · Outstanding · High-performing talent. B, Y, N and D step aside, the O swells until it
// is the size of an avatar, and the person appears inside it.
//
// That is the whole message, and it is deliberately never written down. Nobody is told they
// are outstanding and no rating is printed on the page: the employee simply is, for a
// second and a half, the O in the company's own name. A badge saying "Outstanding" on every
// profile would be a claim, and an empty one. This is the same thought paid as a courtesy
// instead of an assertion — which is also why it plays when you arrive at your own record
// and nowhere else in the product.
//
// The O is the middle letter of five, so it is already dead centre. It grows in place and
// never travels, which is the only reason the handoff to the settled avatar looks like one
// continuous object rather than two elements swapping.
//
// ── Two rules it has to obey ───────────────────────────────────────────────
//
// It plays on every visit, at Raaed's instruction. It was once per person behind a
// localStorage key, on the reasoning that a flourish you cannot get past is a tax on
// somebody who came to check a date. She was seeing it rarely enough that it read as
// broken rather than as restraint, which is a fair answer: a gesture nobody reliably sees
// is not a gesture. If it ever starts to grate, the gate is one constant, not a rewrite.
//
// 1. prefers-reduced-motion skips it entirely — not a faster version, not a fade. The
//    settled band renders immediately with no motion at all. Vestibular disorders are not
//    a preference about taste.
//
// 2. It never blocks the page. The rest of /profile is mounted and readable underneath
//    while this plays. If the timers never fire, the intro is simply absent and the band
//    below is already correct.

const BYOND_LETTERS = ['B', 'Y', 'O', 'N', 'D']

// Stage boundaries in ms. The growth gets the longest beat of the four: it is the part
// carrying the idea, and rushing it reads as a glitch rather than a gesture.
const STAGE_AT = [0, 420, 1280, 1820, 2600]

// The O starts as a 40px glyph and ends as a 108px ring. Scaling the glyph by this factor
// puts its bowl exactly on the ring's stroke, so the cross-fade between them has nothing
// to give away.
const O_GROWTH = 3.1

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export default function ProfileIntro({ employeeId, initial, photoUrl, onDone }) {
  // Decided once, synchronously, before the first paint. Deciding this inside an effect
  // would show one frame of the intro to somebody who asked never to see one.
  const shouldPlay = useMemo(() => {
    if (!employeeId) return false
    return !prefersReducedMotion()
  }, [employeeId])

  const [stage, setStage] = useState(shouldPlay ? 0 : STAGE_AT.length - 1)

  useEffect(() => {
    if (!shouldPlay) {
      onDone?.()
      return
    }

    let finished = false
    const timers = STAGE_AT.slice(1).map((at, i) =>
      setTimeout(() => {
        setStage(i + 1)
        if (i + 1 === STAGE_AT.length - 1 && !finished) {
          finished = true
          onDone?.()
        }
      }, at)
    )

    return () => timers.forEach(clearTimeout)
    // onDone fires at most once, so an unstable prop cannot restart the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, employeeId])

  if (!shouldPlay) return null

  const growing = stage >= 1   // outer letters leave, O swells
  const personIn = stage >= 2  // the avatar arrives inside it
  const leaving = stage >= 3   // hand over to the settled band

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-10 flex flex-col items-center pt-8
                 rounded-xl bg-white dark:bg-[#1E1E1E]
                 transition-opacity duration-[420ms] ease-out"
      style={{ opacity: leaving ? 0 : 1, pointerEvents: leaving ? 'none' : undefined }}
    >
      {/* pt-8 and a 108px stage, matching the settled band exactly. The whole point is that
          the O grows around the spot the avatar is going to occupy, so when this overlay
          fades the picture is already there and nothing moves. Centring this in the card
          instead cost about 150px of jump — invisible behind the fade, but the kind of
          thing you feel without being able to name. */}
      <div className="relative flex items-center justify-center h-[108px] w-full">
        {/* The word. Each letter gets its own box so the O can hold its position while the
            others leave — as one text node, the remaining glyphs would re-centre and the O
            would drift off the point the ring is about to occupy. */}
        <div className="flex items-center justify-center gap-1 text-[40px] font-extrabold tracking-tight leading-none">
          {BYOND_LETTERS.map((ch, i) => {
            const isO = ch === 'O'

            if (isO) {
              return (
                <span
                  key={ch}
                  className="text-[#00D4A0] ease-out"
                  style={{
                    // Scales slowly in place, then leaves quickly. Two durations, not one:
                    // an 820ms fade-out would still be half-visible behind the ring at
                    // 1500ms, showing a second fainter circle just as the person arrives.
                    transitionProperty: 'transform, opacity',
                    transitionDuration: '820ms, 260ms',
                    transform: `scale(${growing ? O_GROWTH : 1})`,
                    opacity: personIn ? 0 : 1,
                  }}
                >
                  {ch}
                </span>
              )
            }

            return (
              <span
                key={ch + i}
                className="text-[#1A1A1A] dark:text-white transition-all duration-[520ms] ease-out"
                style={{
                  opacity: growing ? 0 : 1,
                  transform: growing ? `translateX(${i < 2 ? '-26px' : '26px'})` : 'none',
                }}
              >
                {ch}
              </span>
            )
          })}
        </div>

        {/* The ring the O becomes, and the person inside it. Both are centred on the exact
            point the O occupies, which is what makes the swap invisible. */}
        <div
          className="absolute left-1/2 top-1/2 rounded-full border-[3px] border-[#00D4A0]
                     transition-opacity duration-[380ms] ease-out"
          style={{
            width: 108,
            height: 108,
            transform: 'translate(-50%, -50%)',
            opacity: personIn ? 1 : 0,
          }}
        />
        {/* The person, inside the O. Their actual photo when they have one — the point of
            the whole sequence is that they occupy the letter, and an initial is the
            stand-in for a face, not the intended subject. */}
        <div
          className="absolute left-1/2 top-1/2 rounded-full bg-[#00D4A0] overflow-hidden
                     flex items-center justify-center text-[#062B22] font-bold
                     transition-all duration-[460ms] ease-out"
          style={{
            width: 84,
            height: 84,
            fontSize: 34,
            transform: `translate(-50%, -50%) scale(${personIn ? 1 : 0.45})`,
            opacity: personIn ? 1 : 0,
          }}
        >
          {photoUrl
            ? <img src={photoUrl} alt="" className="w-full h-full object-cover" />
            : initial}
        </div>
      </div>
    </div>
  )
}
