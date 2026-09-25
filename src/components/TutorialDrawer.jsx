import { useEffect, useRef, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'

// The page guide on a phone: a panel that slides in from the right.
//
// On a small screen the desktop spotlight fails — its card covers most of the page it is
// pointing at. A side panel is honest about that: it takes the screen for a moment and
// shows the whole guide as a timeline, so the person can see how long it is, jump to
// any step, and swipe it away like any other sheet on their phone.

const SWIPE_CLOSE_PX = 80
const ANIM_MS = 240

export default function TutorialDrawer({ title, steps, step, setStep, onClose }) {
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  const startX = useRef(null)
  // The live distance, read on release. State alone would hand onTouchEnd the value
  // from the last render, and a quick flick releases before that render happens.
  const dragRef = useRef(0)
  const panelRef = useRef(null)
  const last = step === steps.length - 1

  // Slide in on the frame after mount so the transition has somewhere to start from.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true))
    panelRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { cancelAnimationFrame(raf); document.body.style.overflow = prev }
  }, [])

  function dismiss() {
    setShown(false)
    setTimeout(onClose, ANIM_MS)
  }

  function onTouchStart(e) { startX.current = e.touches[0].clientX }
  function onTouchMove(e) {
    if (startX.current == null) return
    dragRef.current = Math.max(0, e.touches[0].clientX - startX.current)
    setDrag(dragRef.current)
  }
  function onTouchEnd() {
    if (dragRef.current > SWIPE_CLOSE_PX) dismiss()
    dragRef.current = 0
    setDrag(0)
    startX.current = null
  }

  const translate = shown ? `translateX(${drag}px)` : 'translateX(100%)'

  return (
    <>
      <div
        aria-hidden="true"
        onClick={dismiss}
        className="fixed inset-0 z-[71] bg-black/50 backdrop-blur-[2px] transition-opacity motion-reduce:transition-none"
        style={{ opacity: shown ? 1 : 0, transitionDuration: `${ANIM_MS}ms` }}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-drawer-title"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') dismiss() }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className="fixed z-[72] top-0 right-0 h-[100dvh] w-[min(88vw,380px)] flex flex-col bg-white dark:bg-[#1A1A1A] rounded-l-3xl shadow-2xl focus:outline-none motion-reduce:transition-none"
        style={{
          transform: translate,
          transition: drag ? 'none' : `transform ${ANIM_MS}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        }}
      >
        {/* Grab handle on the edge — says "this slides" without a word. */}
        <div aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 w-1 h-10 rounded-full bg-[#E8E8E8] dark:bg-[#3A3A3A]" />

        <header className="flex items-center gap-3 px-6 pt-[max(20px,env(safe-area-inset-top))] pb-4">
          <div className="w-10 h-10 rounded-2xl bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#666666] dark:text-[#A0A0A0]">Guide</p>
            <h2 id="tutorial-drawer-title" className="text-lg font-bold text-[#1A1A1A] dark:text-white truncate">{title}</h2>
          </div>
          <button
            type="button" onClick={dismiss} aria-label="Close guide"
            className="w-10 h-10 rounded-full flex items-center justify-center text-[#666666] dark:text-[#A0A0A0] bg-[#F5F5F0] dark:bg-[#252525]"
          >
            <X size={18} />
          </button>
        </header>

        <ol className="flex-1 overflow-y-auto px-6 pt-1 pb-4">
          {steps.map((s, i) => {
            const done = i < step
            const current = i === step
            return (
              <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                {i < steps.length - 1 && (
                  <span aria-hidden="true" className={`absolute left-[15px] top-8 bottom-0 w-0.5 ${done ? 'bg-[#00D4A0]' : 'bg-[#E8E8E8] dark:bg-[#2A2A2A]'}`} />
                )}
                <span aria-hidden="true" className={`relative z-[1] w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                  current ? 'bg-[#00D4A0] text-[#062B22] ring-4 ring-[#00D4A0]/20'
                  : done ? 'bg-[#00D4A0]/15 text-accent'
                  : 'bg-[#F5F5F0] dark:bg-[#252525] text-[#666666] dark:text-[#A0A0A0]'}`}>
                  {done ? <Check size={15} /> : i + 1}
                </span>
                <div className="min-w-0 pt-1">
                  <button
                    type="button" onClick={() => setStep(i)}
                    aria-current={current ? 'step' : undefined}
                    className={`text-left text-[15px] font-semibold ${current ? 'text-[#1A1A1A] dark:text-white' : 'text-[#666666] dark:text-[#A0A0A0]'}`}
                  >
                    {s.title}
                  </button>
                  {current && (
                    <p className="text-sm leading-relaxed text-[#1A1A1A] dark:text-white mt-1.5">{s.body}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        <footer className="px-6 pt-4 pb-[max(20px,env(safe-area-inset-bottom))] border-t border-[#E8E8E8] dark:border-[#2A2A2A]">
          <div className="h-1 rounded-full bg-[#E8E8E8] dark:bg-[#2A2A2A] overflow-hidden mb-4"
               role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={steps.length}
               aria-label={`Step ${step + 1} of ${steps.length}`}>
            <div className="h-full rounded-full bg-[#00D4A0] transition-all duration-300 motion-reduce:transition-none"
                 style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="flex items-center gap-3">
            {step === 0 ? (
              <button type="button" onClick={dismiss}
                className="flex-1 h-12 rounded-2xl text-[15px] font-semibold text-[#666666] dark:text-[#A0A0A0] bg-[#F5F5F0] dark:bg-[#252525]">
                Skip
              </button>
            ) : (
              <button type="button" onClick={() => setStep(step - 1)}
                className="flex-1 h-12 rounded-2xl text-[15px] font-semibold text-[#1A1A1A] dark:text-white bg-[#F5F5F0] dark:bg-[#252525]">
                Back
              </button>
            )}
            <button type="button" onClick={() => (last ? dismiss() : setStep(step + 1))}
              className="flex-[1.4] h-12 rounded-2xl text-[15px] font-semibold text-[#062B22] bg-[#00D4A0] active:bg-[#00B589] transition-colors">
              {last ? 'Got it' : 'Next'}
            </button>
          </div>
        </footer>
      </aside>
    </>
  )
}
