import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { HelpCircle, X } from 'lucide-react'
import supabase from '../services/supabase'
import useAuthStore from '../store/authStore'
import { pageKeyFor, tutorialFor } from '../tutorials/content'
import TutorialDrawer from './TutorialDrawer'

// The first-visit guide for whichever page is open, written for the viewer's role.
//
// Lives in the Header, which every signed-in page renders, so a new page gets a guide
// by adding content for it — no page has to remember to mount anything. It also renders
// the "?" button that replays the guide on demand.
//
// Seen-state is kept in tutorial_seen (one row per person per guide), mirrored to
// localStorage so the check is instant on the next visit and a guide never flashes up
// again while the network is slow. If the database write fails the local copy still
// stops it repeating on this device, which is the failure worth avoiding.

const OPEN_DELAY_MS = 700
const TARGET_WAIT_MS = 1500
const GAP = 12

function localKey(uid) { return `byond-tutorials-seen:${uid}` }

function readLocal(uid) {
  try { return new Set(JSON.parse(localStorage.getItem(localKey(uid)) ?? '[]')) } catch { return new Set() }
}

function writeLocal(uid, key) {
  try {
    const seen = readLocal(uid)
    seen.add(key)
    localStorage.setItem(localKey(uid), JSON.stringify([...seen]))
  } catch { /* private window or blocked storage: the database row still counts */ }
}

// Phones get the side panel; everything wider gets the spotlight.
const PHONE_QUERY = '(max-width: 639px)'
function subscribePhone(cb) {
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function isPhone() { return window.matchMedia(PHONE_QUERY).matches }

function findTarget(name) {
  return name ? document.querySelector(`[data-tour="${name}"]`) : null
}

// Visible on screen with a real size — a hidden tab's element is in the DOM but not
// something to point at.
function usable(el) {
  if (!el) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

export default function PageTutorial() {
  const { pathname } = useLocation()
  const role = useAuthStore((s) => s.role)
  const uid = useAuthStore((s) => s.session?.user?.id)
  const isPlatformOwner = useAuthStore((s) => s.isPlatformOwner)

  const tutorial = !isPlatformOwner && role ? tutorialFor(pageKeyFor(pathname), role) : null
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const narrow = useSyncExternalStore(subscribePhone, isPhone, () => false)
  const cardRef = useRef(null)
  const tKey = tutorial?.key

  // Open automatically the first time this guide is met.
  useEffect(() => {
    if (!tKey || !uid) return undefined
    if (readLocal(uid).has(tKey)) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('tutorial_seen').select('tutorial_key')
        .eq('tutorial_key', tKey).maybeSingle()
      if (cancelled) return
      if (data) { writeLocal(uid, tKey); return }
      if (error) console.error('[PageTutorial] seen check failed', error)
      setStep(0)
      setOpen(true)
    }, OPEN_DELAY_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [tKey, uid])

  async function close() {
    setOpen(false)
    setRect(null)
    if (!tKey || !uid) return
    writeLocal(uid, tKey)
    const { error } = await supabase
      .from('tutorial_seen')
      .upsert({ tutorial_key: tKey }, { onConflict: 'user_id,tutorial_key', ignoreDuplicates: true })
    if (error) console.error('[PageTutorial] could not record seen', error)
  }

  const current = open && tutorial ? tutorial.steps[step] : null
  const target = current?.target ?? null

  // Find the step's element, waiting briefly for pages that are still loading, then
  // keep the spotlight on it through scrolling and resizing.
  useEffect(() => {
    if (!open || narrow) return undefined
    let el = null
    let raf = 0
    let waited = 0
    let poll = 0

    const measure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setRect(el && usable(el) ? el.getBoundingClientRect() : null)
      })
    }

    const locate = () => {
      el = findTarget(target)
      if (usable(el)) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        measure()
      } else if (target && waited < TARGET_WAIT_MS) {
        waited += 150
        poll = setTimeout(locate, 150)
      } else {
        el = null
        measure()
      }
    }
    locate()

    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(poll)
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, target, step, narrow])

  useLayoutEffect(() => {
    if (open && !narrow) cardRef.current?.focus()
  }, [open, step, narrow])

  if (!tutorial) return null

  const last = step === tutorial.steps.length - 1
  const pad = 6

  // Card placement (wider screens only — phones get TutorialDrawer): under the
  // spotlight if it fits, else above it, centred when there is nothing to point at.
  let cardStyle = {}
  let cardClass = 'fixed z-[72] w-[min(360px,calc(100vw-32px))]'
  if (rect) {
    const cardH = 220
    const below = rect.bottom + pad + GAP
    const top = below + cardH < window.innerHeight ? below : Math.max(16, rect.top - pad - GAP - cardH)
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - 360 - 16)
    cardStyle = { top, left }
  } else {
    cardClass += ' left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setStep(0); setOpen(true) }}
        data-tour="header-guide"
        className="w-9 h-9 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525] hover:text-[#1A1A1A] dark:hover:text-white transition-colors"
        aria-label="Show the guide for this page"
        title="Guide for this page"
      >
        <HelpCircle size={17} />
      </button>

      {current && narrow && (
        <TutorialDrawer
          title={tutorial.title}
          steps={tutorial.steps}
          step={step}
          setStep={setStep}
          onClose={close}
        />
      )}

      {current && !narrow && (
        <>
          {/* The dim layer. With a target it is the spotlight's own shadow, so the
              element stays lit; without one it is a plain backdrop. Clicking it does
              nothing on purpose — a stray click should not throw the guide away. */}
          {rect ? (
            <div
              aria-hidden="true"
              className="fixed z-[71] rounded-xl pointer-events-none transition-all duration-200 motion-reduce:transition-none"
              style={{
                top: rect.top - pad, left: rect.left - pad,
                width: rect.width + pad * 2, height: rect.height + pad * 2,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                outline: '2px solid #00D4A0', outlineOffset: 2,
              }}
            />
          ) : (
            <div aria-hidden="true" className="fixed inset-0 z-[71] bg-black/55" />
          )}
          <div aria-hidden="true" className="fixed inset-0 z-[71]" />

          <div
            ref={cardRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutorial-title"
            aria-describedby="tutorial-body"
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
              if (e.key === 'ArrowRight') setStep((n) => Math.min(n + 1, tutorial.steps.length - 1))
              if (e.key === 'ArrowLeft') setStep((n) => Math.max(n - 1, 0))
            }}
            className={`${cardClass} p-5 rounded-2xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A] shadow-2xl focus:outline-none`}
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-xs font-semibold text-accent">
                {step + 1} of {tutorial.steps.length}
              </p>
              <button
                type="button" onClick={close} aria-label="Close guide"
                className="-mt-1 -mr-1 w-7 h-7 rounded-lg flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]"
              >
                <X size={15} />
              </button>
            </div>
            <h2 id="tutorial-title" className="text-base font-bold text-[#1A1A1A] dark:text-white">{current.title}</h2>
            <p id="tutorial-body" className="text-sm text-[#1A1A1A] dark:text-white mt-1.5 leading-relaxed">{current.body}</p>

            <div className="flex items-center justify-between gap-3 mt-5">
              <div className="flex gap-1.5" aria-hidden="true">
                {tutorial.steps.map((_, i) => (
                  <span key={i} className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${
                    i === step ? 'w-4 bg-[#00D4A0]' : 'w-1.5 bg-[#E8E8E8] dark:bg-[#3A3A3A]'}`} />
                ))}
              </div>
              <div className="flex items-center gap-2">
                {step === 0 ? (
                  <button type="button" onClick={close}
                    className="px-3 py-2 rounded-lg text-sm font-semibold text-[#666666] dark:text-[#A0A0A0] hover:text-[#1A1A1A] dark:hover:text-white">
                    Skip
                  </button>
                ) : (
                  <button type="button" onClick={() => setStep((s) => s - 1)}
                    className="px-3 py-2 rounded-lg text-sm font-semibold text-[#1A1A1A] dark:text-white border border-[#E8E8E8] dark:border-[#2A2A2A] hover:bg-[#F5F5F0] dark:hover:bg-[#252525]">
                    Back
                  </button>
                )}
                <button type="button" onClick={() => (last ? close() : setStep((s) => s + 1))}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-[#062B22] bg-[#00D4A0] hover:bg-[#00B589] transition-colors">
                  {last ? 'Got it' : 'Next'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}
