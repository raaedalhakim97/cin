import { useEffect, useMemo, useRef, useState } from 'react'

// The 2.6-second opening on /profile.
//
// It opens on BYOND with the O already mint — the letter the acronym marks in
// Landing.jsx: O · Outstanding · High-performing talent. B, Y, N and D step aside, the O
// grows into a ring, and the person's avatar pops inside it. Their name and meta rise
// underneath, and the settled state is the identity band that was going to be there
// anyway. The O is the middle letter of five, so it is already dead centre: it grows in
// place and never travels, which is the whole reason the handoff looks continuous.
//
// ── Three rules it has to obey ─────────────────────────────────────────────
//
// 1. Once per person, not once per page load. An animation you cannot get past is a tax
//    on everybody who visits the page twice, and /profile is where people go to check a
//    date. The localStorage key carries the employee id, so a shared machine does not
//    hand one person's "seen" flag to the next.
//
// 2. prefers-reduced-motion skips it entirely — not a faster version, not a fade. The
//    settled state renders immediately with no motion at all. Vestibular disorders are
//    not a preference about taste.
//
// 3. It never blocks the page. The rest of /profile renders underneath while this plays,
//    so nothing about the animation can stop somebody reading their own record. If the
//    timers never fire the intro is simply absent, and the band below is already correct.
//
// Storage can throw before it can return — a private window, cleared site data, or a
// browser set to block it — so every read and write is wrapped. The failure mode of a
// throwing localStorage is "the intro plays again", which is survivable; the failure mode
// of an unwrapped read is a blank profile page, which is not.

const SEEN_PREFIX = 'byond.profileIntro.seen.'

// The four stages, in ms from the start. Tuned so the O has finished growing before the
// avatar arrives — an avatar that lands mid-scale reads as two animations fighting.
const STAGE_AT = [0, 450, 1200, 1750, 2600]

function hasSeen(employeeId) {
  try {
    return localStorage.getItem(SEEN_PREFIX + employeeId) === '1'
  } catch {
    return false
  }
}

function markSeen(employeeId) {
  try {
    localStorage.setItem(SEEN_PREFIX + employeeId, '1')
  } catch {
    /* A browser that refuses to remember means the intro plays again. Acceptable. */
  }
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const BYOND_LETTERS = ['B', 'Y', 'O', 'N', 'D']

export default function ProfileIntro({ employeeId, initial, onDone }) {
  // Decided once, synchronously, before the first paint. Deciding this in an effect would
  // show a frame of the intro to somebody who asked never to see one.
  const shouldPlay = useMemo(() => {
    if (!employeeId) return false
    if (prefersReducedMotion()) return false
    return !hasSeen(employeeId)
  }, [employeeId])

  const [stage, setStage] = useState(shouldPlay ? 0 : STAGE_AT.length - 1)
  const doneRef = useRef(false)

  useEffect(() => {
    if (!shouldPlay) {
      onDone?.()
      return
    }

    markSeen(employeeId)

    const timers = STAGE_AT.slice(1).map((at, i) =>
      setTimeout(() => {
        setStage(i + 1)
        if (i + 1 === STAGE_AT.length - 1 && !doneRef.current) {
          doneRef.current = true
          onDone?.()
        }
      }, at)
    )

    return () => timers.forEach(clearTimeout)
    // onDone is called at most once (doneRef), so an unstable prop cannot re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay, employeeId])

  if (!shouldPlay) return null
  if (stage >= STAGE_AT.length - 1) return null

  const lettersGone = stage >= 1
  const ringGrown = stage >= 1
  const avatarIn = stage >= 2

  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5
                 rounded-xl bg-white dark:bg-[#1E1E1E]"
    >
      <div className="relative flex items-center justify-center h-28 w-full">
        {/* The word. Each letter is its own box so the O can stay put while the rest
            leave — laying this out as one text node would re-centre the remaining
            glyphs and the O would drift. */}
        <div
          className="flex items-center justify-center gap-1 text-[38px] font-extrabold tracking-tight
                     transition-opacity duration-300"
          style={{ opacity: ringGrown ? 0 : 1 }}
        >
          {BYOND_LETTERS.map((ch, i) => {
            const isO = ch === 'O'
            return (
              <span
                key={ch + i}
                className="transition-all duration-500 ease-out"
                style={{
                  color: isO ? '#00D4A0' : undefined,
                  opacity: lettersGone && !isO ? 0 : 1,
                  transform: lettersGone && !isO
                    ? `translateX(${i < 2 ? '-22px' : '22px'})`
                    : 'none',
                }}
              >
                <span className={isO ? '' : 'text-[#1A1A1A] dark:text-white'}>{ch}</span>
              </span>
            )
          })}
        </div>

        {/* The ring the O becomes, and the avatar inside it. Both are absolutely centred
            on the same point the O occupies, which is what makes the swap invisible. */}
        <div
          className="absolute left-1/2 top-1/2 rounded-full border-[3px] border-[#00D4A0]
                     transition-all duration-[600ms] ease-out"
          style={{
            width: 96,
            height: 96,
            transform: `translate(-50%, -50%) scale(${ringGrown ? 1 : 0.36})`,
            opacity: ringGrown ? 1 : 0,
          }}
        />
        <div
          className="absolute left-1/2 top-1/2 rounded-full bg-[#00D4A0] flex items-center justify-center
                     text-[#062B22] font-bold transition-all duration-[450ms] ease-out"
          style={{
            width: 76,
            height: 76,
            fontSize: 30,
            transform: `translate(-50%, -50%) scale(${avatarIn ? 1 : 0.5})`,
            opacity: avatarIn ? 1 : 0,
          }}
        >
          {initial}
        </div>
      </div>
    </div>
  )
}
