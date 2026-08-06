import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Workflow,
  TrendingUp,
  LayoutGrid,
  AlertTriangle,
  Target,
  HeartHandshake,
} from 'lucide-react'
import Logo from '../components/Logo'

// Ported from "BYOND Website.dc.html" (Claude Design export) — the public
// marketing site. Renders with no Supabase session and never touches the DB.

// Primary conversion path (trial signup) vs. secondary (sales-assisted demo
// request) — both routes are real pages now (Signup.jsx / Demo.jsx).
const SIGNUP_HREF = '/signup'
const DEMO_HREF = '/demo'

const DELAY_CLASS = {
  0: '',
  80: 'delay-[80ms]',
  100: 'delay-[100ms]',
  160: 'delay-[160ms]',
  200: 'delay-[200ms]',
  240: 'delay-[240ms]',
  320: 'delay-[320ms]',
}

// Read once. matchMedia is cheap but this is called by every Reveal on the page.
const PREFERS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function useInView() {
  const ref = useRef(null)
  // Start revealed when animating would be wrong or impossible.
  //
  // Every section on this page renders at opacity-0 and waits for an observer
  // callback, so if IntersectionObserver is missing the entire marketing site
  // is a blank black screen — the worst possible failure for the one page
  // strangers see first. Same treatment when the visitor has asked for reduced
  // motion: show them the content, skip the entrance.
  const [inView, setInView] = useState(
    () => PREFERS_REDUCED_MOTION || typeof IntersectionObserver === 'undefined'
  )
  useEffect(() => {
    if (inView) return undefined
    const el = ref.current
    if (!el) return undefined
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          io.unobserve(el)
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])
  return [ref, inView]
}

function Reveal({ children, delay = 0, className = '' }) {
  const [ref, inView] = useInView()
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${DELAY_CLASS[delay] || ''} ${
        inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      } ${className}`}
    >
      {children}
    </div>
  )
}

function CountUp({ to, prefix = '', suffix = '', duration = 1400 }) {
  const [ref, inView] = useInView()
  // Counting up is the animation. Without motion, start at the final number
  // rather than animating to it — set here instead of in the effect, so there
  // is no cascading render.
  const [value, setValue] = useState(() => (PREFERS_REDUCED_MOTION ? to : 0))
  useEffect(() => {
    if (!inView || PREFERS_REDUCED_MOTION) return
    let raf
    const start = performance.now()
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(to * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, duration])
  return (
    <span ref={ref}>
      {prefix}
      {value}
      {suffix}
    </span>
  )
}

function Bar({ targetWidthClass, colorClass = 'bg-[#00D4A0]', delayClass = '' }) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} className="h-[7px] rounded-full bg-[#242424] overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-out ${delayClass} ${colorClass} ${
          inView ? targetWidthClass : 'w-0'
        }`}
      />
    </div>
  )
}

function Ring({ pct = 87 }) {
  const [ref, inView] = useInView()
  const r = 56
  const circumference = 2 * Math.PI * r
  const offset = inView ? circumference * (1 - pct / 100) : circumference
  return (
    <div ref={ref} className="relative w-[132px] h-[132px] shrink-0">
      <svg width="132" height="132" viewBox="0 0 132 132" className="-rotate-90">
        <circle cx="66" cy="66" r={r} stroke="#242424" strokeWidth="12" fill="none" />
        <circle
          cx="66"
          cy="66"
          r={r}
          stroke="#00D4A0"
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-[1600ms] ease-out delay-[300ms]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-extrabold tracking-tight text-white">
          <CountUp to={pct} />
        </span>
        <span className="text-[11px] tracking-widest uppercase text-[#8A8A8A] mt-0.5">Team score</span>
      </div>
    </div>
  )
}

function HeroChart() {
  const [wrapRef, inView] = useInView()
  const pathRef = useRef(null)
  const [length, setLength] = useState(0)
  useEffect(() => {
    if (pathRef.current) setLength(pathRef.current.getTotalLength())
  }, [])
  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox="0 0 480 200" fill="none" className="block w-full">
        <defs>
          <linearGradient id="byArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00D4A0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00D4A0" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="50" x2="480" y2="50" stroke="#1e1e1e" strokeWidth="1" />
        <line x1="0" y1="100" x2="480" y2="100" stroke="#1e1e1e" strokeWidth="1" />
        <line x1="0" y1="150" x2="480" y2="150" stroke="#1e1e1e" strokeWidth="1" />
        <path
          d="M0,168 C60,158 92,128 140,132 C188,136 214,96 262,86 C312,76 344,52 392,42 C432,34 462,22 480,16 L480,200 L0,200 Z"
          fill="url(#byArea)"
          className={`transition-opacity duration-[1400ms] delay-[500ms] ${inView ? 'opacity-100' : 'opacity-0'}`}
        />
        <path
          ref={pathRef}
          d="M0,168 C60,158 92,128 140,132 C188,136 214,96 262,86 C312,76 344,52 392,42 C432,34 462,22 480,16"
          stroke="#00D4A0"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={inView ? 0 : length}
          className="transition-[stroke-dashoffset] duration-[1600ms] ease-out delay-[400ms]"
        />
        <circle
          cx="480"
          cy="16"
          r="5"
          fill="#00D4A0"
          className={`transition-opacity duration-300 delay-[1500ms] ${inView ? 'opacity-100' : 'opacity-0'}`}
        />
      </svg>
      <div
        className={`absolute -top-0.5 right-1.5 px-2.5 py-1 rounded-md bg-[#00D4A0] text-[#062b22] text-xs font-bold transition-all duration-500 delay-[1500ms] ${
          inView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1.5'
        }`}
      >
        +18% ↑
      </div>
    </div>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 sm:px-8 lg:px-10 border-b transition-[background-color,padding,border-color] duration-300 ${
        scrolled ? 'bg-black/80 backdrop-blur-md border-[#1a1a1a] py-3.5' : 'bg-transparent border-transparent py-5'
      }`}
    >
      <a href="#top">
        <Logo size="lg" variant="dark" />
      </a>
      <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[#B5B5B5]">
        <a href="#features" className="hover:text-[#F5F5F5] transition-colors">Platform</a>
        <a href="#how" className="hover:text-[#F5F5F5] transition-colors">How it works</a>
        <a href="#showcase" className="hover:text-[#F5F5F5] transition-colors">Dashboards</a>
        <Link to="/login" className="hover:text-[#F5F5F5] transition-colors">Log in</Link>
        <Link
          to={SIGNUP_HREF}
          className="px-4 py-2 rounded-lg bg-[#00D4A0] hover:bg-[#12e6b0] text-[#062b22] font-bold transition-colors"
        >
          Start free trial
        </Link>
      </div>
      <div className="md:hidden flex items-center gap-3">
        <Link to="/login" className="text-sm font-medium text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">
          Log in
        </Link>
        <Link to={SIGNUP_HREF} className="px-4 py-2 rounded-lg bg-[#00D4A0] text-[#062b22] text-sm font-bold whitespace-nowrap">
          Start free trial
        </Link>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <header
      id="top"
      className="relative max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-28 sm:pt-32 lg:pt-44 pb-16 lg:pb-24"
    >
      <div className="absolute top-16 -right-24 lg:-right-36 w-[420px] h-[420px] lg:w-[620px] lg:h-[620px] rounded-full bg-[radial-gradient(circle,rgba(0,212,160,.14),transparent_62%)] pointer-events-none" />
      <div className="relative grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center">
        <div>
          <Reveal>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#00D4A0]/10 border border-[#00D4A0]/25 text-[13px] font-semibold text-[#00D4A0] whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00D4A0] animate-pulse" />
              Performance, made human
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="text-[clamp(38px,5.4vw,72px)] font-extrabold tracking-tight leading-[1.02] mt-6">
              See how your team performs.<br />
              Then help them go <span className="text-[#00D4A0]">beyond</span>.
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="text-lg leading-relaxed text-[#B5B5B5] mt-6 max-w-[500px]">
              Attendance scores itself from the moment your team clocks in. Reviews, goals and manager input sit
              alongside it in one living performance graph — so managers coach with clarity, and no one gets lost
              in a spreadsheet.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="flex flex-wrap items-center gap-4 mt-9">
              <Link
                to={SIGNUP_HREF}
                className="inline-flex items-center gap-2.5 px-7 py-4 rounded-xl bg-[#00D4A0] hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_rgba(0,212,160,.5)] text-[#062b22] text-base font-bold transition-all"
              >
                Start free trial <ArrowRight size={16} strokeWidth={2.6} />
              </Link>
              <Link
                to={DEMO_HREF}
                className="inline-flex items-center gap-2 px-6 py-4 rounded-xl border border-[#2C2C2C] hover:border-[#00D4A0] text-base font-semibold text-[#F5F5F5] transition-colors"
              >
                Book a demo
              </Link>
            </div>
          </Reveal>
          <Reveal delay={320}>
            {/* Every figure here is a fact about the product, not a claim about
                results we have not measured. 14 days is what
                self_onboard_company actually sets; the two zeros are literally
                true because there is nothing to integrate or import. */}
            {/* Stacked on a phone, in a row from sm up.
                It was flex-wrap with w-px dividers between the items, which
                looks right until the row wraps — then a divider ends up
                stranded at the end of a line with nothing to divide. Dividers
                only exist in the layout that has something on both sides. */}
            <div className="flex flex-col sm:flex-row gap-5 sm:gap-8 mt-12">
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-[#00D4A0]">
                  <CountUp to={14} suffix=" days" />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">free, no card required</div>
              </div>
              <div className="hidden sm:block w-px bg-[#222] self-stretch" />
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-white">
                  <CountUp to={0} />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">imports or connectors</div>
              </div>
              <div className="hidden sm:block w-px bg-[#222] self-stretch" />
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-white">
                  <CountUp to={100} suffix="%" />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">of attendance scored automatically</div>
              </div>
            </div>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <div className="relative">
            <div className="rounded-[22px] p-6 bg-[linear-gradient(160deg,#181818,#121212)] border border-[#262626] shadow-[0_40px_90px_-30px_rgba(0,0,0,.9)]">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-[13px] text-[#8A8A8A]">Team performance</div>
                  <div className="text-xl font-bold tracking-tight mt-0.5">Q3 · Growth pod</div>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#00D4A0]/10 text-xs font-semibold text-[#00D4A0]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00D4A0] animate-pulse" />
                  Live
                </div>
              </div>
              <HeroChart />
              <div className="grid grid-cols-3 gap-3 mt-5">
                <div className="bg-[#1a1a1a] rounded-xl p-3.5">
                  <div className="text-xs text-[#8A8A8A]">Goals met</div>
                  <div className="text-[22px] font-bold mt-1">92%</div>
                  <div className="mt-2.5">
                    <Bar targetWidthClass="w-[92%]" delayClass="delay-[600ms]" />
                  </div>
                </div>
                <div className="bg-[#1a1a1a] rounded-xl p-3.5">
                  <div className="text-xs text-[#8A8A8A]">On track</div>
                  <div className="text-[22px] font-bold mt-1">14/16</div>
                  <div className="mt-2.5">
                    <Bar targetWidthClass="w-[88%]" delayClass="delay-[750ms]" />
                  </div>
                </div>
                <div className="bg-[#1a1a1a] rounded-xl p-3.5">
                  <div className="text-xs text-[#8A8A8A]">Needs support</div>
                  <div className="text-[22px] font-bold mt-1 text-[#FF4D4D]">2</div>
                  <div className="mt-2.5">
                    <Bar targetWidthClass="w-[18%]" colorClass="bg-[#FF4D4D]" delayClass="delay-[900ms]" />
                  </div>
                </div>
              </div>
            </div>
            <div className="hidden sm:block absolute -bottom-6 -left-7">
              <div className="flex items-center gap-2.5 bg-[#151515] border border-[#2a2a2a] rounded-2xl px-4 py-3.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,.9)]">
                <div className="w-9 h-9 rounded-lg bg-[#FF4D4D]/10 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-[#FF4D4D]" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold">KPI dip detected</div>
                  <div className="text-xs text-[#8A8A8A]">Support pod · response time</div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </header>
  )
}

// This strip used to read "Trusted by SME teams across the Gulf" above five
// invented company names. BYOND has no customers yet, so that was a false
// statement about commercial relationships — and the kind a single question
// from a prospect destroys. Replaced with capabilities that are built and
// shipping, which is the only proof we actually have.
const CAPABILITIES = ['Web & mobile', 'Geofenced attendance', 'WPS-ready payroll export', 'UAE labour-law aware']

function LogoStrip() {
  return (
    <Reveal className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 mt-10">
      <div className="border-y border-[#1a1a1a] py-7 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <span className="text-xs tracking-[.16em] uppercase text-[#6E6E6E] font-semibold">
          Built in Dubai for teams across the Gulf
        </span>
        <div className="flex flex-wrap gap-x-7 gap-y-3 items-center text-[15px] font-semibold tracking-tight text-[#9A9A9A]">
          {CAPABILITIES.map((c) => (
            <span key={c} className="flex items-center gap-2">
              <Check size={13} strokeWidth={3} className="text-[#00D4A0] shrink-0" />
              {c}
            </span>
          ))}
        </div>
      </div>
    </Reveal>
  )
}

// Each card describes something that exists in the product today.
//
// The first one used to promise "connect your tools once" and the fifth
// "lightweight OKRs". There are no integrations in the codebase and no OKR
// feature — both were claims a buyer would discover were untrue in week one of
// the trial. Rewritten around the real architecture, which is a better pitch
// anyway: nothing to integrate because the source data already lives here.
const FEATURES = [
  { icon: Workflow, title: 'Nothing to integrate', body: 'Attendance, leave and reviews already live in BYOND, so KPIs score themselves from the source. No connectors, no imports, no IT project.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 0 },
  { icon: TrendingUp, title: 'Live performance graphs', body: 'Every person and team gets a trend line that updates as the month runs. See momentum at a glance.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 80 },
  { icon: LayoutGrid, title: 'Team dashboards', body: 'One clear view of who is thriving and who needs support — organised the way your teams actually work.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 160 },
  { icon: AlertTriangle, title: 'Awards issue, warnings never', body: 'Strong attendance earns recognition automatically. A warning is only ever proposed to HR — discipline stays a human decision, with the hearing rights the labour law requires.', iconBg: 'bg-[#FF4D4D]/10', iconColor: 'text-[#FF4D4D]', delay: 0 },
  { icon: Target, title: 'Quarterly review cycles', body: 'Employee rates themselves, then the manager, then the system adds what it measured. Each stage is locked to its own turn, so nobody scores after seeing the answer.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 80 },
  { icon: HeartHandshake, title: 'Human-centered by design', body: 'Approved leave never costs you a point. An unassessed month is not a zero. The scoring model is built to be defensible to the person being scored.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 160 },
]

function Features() {
  return (
    <section id="features" className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6">
      <Reveal className="max-w-[640px]">
        <div className="text-[13px] tracking-[.2em] uppercase text-[#00D4A0] font-semibold">The platform</div>
        <h2 className="text-[clamp(30px,4vw,50px)] font-extrabold tracking-tight leading-[1.06] mt-4">
          Everything you need to track performance — automatically.
        </h2>
        <p className="text-lg leading-relaxed text-[#B5B5B5] mt-5">
          No manual entry, no guesswork. Clock-ins, leave and reviews all happen inside BYOND, so performance
          scores itself from data you already have.
        </p>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-14">
        {FEATURES.map((f) => (
          <Reveal key={f.title} delay={f.delay}>
            <div className="h-full bg-[linear-gradient(160deg,#151515,#111)] border border-[#232323] hover:border-[#00D4A0] hover:-translate-y-1 rounded-[18px] p-8 transition-all duration-300">
              <div className={`w-[46px] h-[46px] rounded-xl ${f.iconBg} flex items-center justify-center mb-6`}>
                <f.icon size={22} className={f.iconColor} strokeWidth={2.2} />
              </div>
              <h3 className="text-xl font-bold tracking-tight">{f.title}</h3>
              <p className="text-[15px] leading-relaxed text-[#9A9A9A] mt-2.5">{f.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { num: '01', title: 'Add your team', body: 'Create the company, invite your people, set your work locations. No data migration, no IT project.', delay: 0 },
  { num: '02', title: 'Let it score itself', body: 'Clock-ins, approved leave and review cycles feed the KPI engine. Dashboards fill in without anyone touching a spreadsheet.', delay: 100 },
  { num: '03', title: 'Coach beyond', body: 'Act on live signals and coaching prompts to help every person perform beyond their limits.', delay: 200 },
]

function HowItWorks() {
  return (
    <section id="how" className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6">
      <Reveal className="text-center max-w-[620px] mx-auto">
        <div className="text-[13px] tracking-[.2em] uppercase text-[#00D4A0] font-semibold">How it works</div>
        <h2 className="text-[clamp(30px,4vw,50px)] font-extrabold tracking-tight leading-[1.06] mt-4">
          Live in an afternoon. Insightful for good.
        </h2>
      </Reveal>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mt-14">
        {STEPS.map((s) => (
          <Reveal key={s.num} delay={s.delay}>
            <div className="text-sm font-bold text-[#00D4A0] tracking-[.1em]">{s.num}</div>
            <h3 className="text-[22px] font-bold tracking-tight mt-3.5">{s.title}</h3>
            <p className="text-[15px] leading-relaxed text-[#9A9A9A] mt-2.5">{s.body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

// Canonical acronym, confirmed — "Believe Yourself Or Never Do" (an earlier
// motivational phrase floated for the brand) is superseded and must not
// appear anywhere in this file.
const ACRONYM = [
  { letter: 'B', word: 'Better', desc: 'HR improvement', mint: false, delay: 0 },
  { letter: 'Y', word: 'Yield', desc: 'Measurable KPI results', mint: false, delay: 80 },
  { letter: 'O', word: 'Outstanding', desc: 'High-performing talent', mint: true, delay: 160 },
  { letter: 'N', word: 'Next-Level', desc: 'Continuous growth', mint: false, delay: 240 },
  { letter: 'D', word: 'Development', desc: 'Employee success', mint: false, delay: 320 },
]

function Acronym() {
  return (
    <section id="acronym" className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6">
      <Reveal className="text-center max-w-[640px] mx-auto">
        <div className="text-[13px] tracking-[.2em] uppercase text-[#00D4A0] font-semibold">
          What BYOND stands for
        </div>
        <h2 className="text-[clamp(30px,4vw,50px)] font-extrabold tracking-tight leading-[1.06] mt-4">
          Five letters. One promise.
        </h2>
      </Reveal>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-14">
        {ACRONYM.map((a) => (
          <Reveal key={a.letter} delay={a.delay}>
            <div className="h-full bg-[linear-gradient(160deg,#151515,#111)] border border-[#232323] hover:border-[#00D4A0] hover:-translate-y-1 rounded-[18px] px-6 py-7 min-h-[180px] flex flex-col transition-all duration-300">
              <span
                className={`text-[48px] sm:text-[56px] font-extrabold tracking-tight leading-none ${
                  a.mint ? 'text-[#00D4A0]' : 'text-[#F5F5F5]'
                }`}
              >
                {a.letter}
              </span>
              <span className="text-lg font-bold tracking-tight mt-4">{a.word}</span>
              <span className="text-sm text-[#8A8A8A] mt-1.5 leading-snug">{a.desc}</span>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

const CHECKS = [
  'Real-time KPI tracking, zero manual entry',
  'Per-person and per-pod trend lines',
  'Early-warning alerts on performance dips',
]

const BARS = [
  { label: 'Delivery', val: '94%', widthClass: 'w-[94%]', delayClass: 'delay-[500ms]' },
  { label: 'Quality', val: '88%', widthClass: 'w-[88%]', delayClass: 'delay-[650ms]' },
  { label: 'Collaboration', val: '81%', widthClass: 'w-[81%]', delayClass: 'delay-[800ms]' },
  { label: 'Response time', val: '46%', widthClass: 'w-[46%]', delayClass: 'delay-[950ms]', colorClass: 'bg-[#FF4D4D]' },
]

function Showcase() {
  return (
    <section id="showcase" className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6">
      <div className="relative bg-[linear-gradient(150deg,#141414,#0d0d0d)] border border-[#232323] rounded-[26px] p-8 sm:p-12 lg:p-16 overflow-hidden">
        <div className="absolute -top-24 -left-20 w-[320px] h-[320px] lg:w-[480px] lg:h-[480px] rounded-full bg-[radial-gradient(circle,rgba(0,212,160,.1),transparent_62%)]" />
        <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_1.15fr] gap-10 lg:gap-14 items-center">
          <Reveal>
            <div className="text-[13px] tracking-[.2em] uppercase text-[#00D4A0] font-semibold">
              Performance dashboards
            </div>
            <h2 className="text-[clamp(28px,3.6vw,44px)] font-extrabold tracking-tight leading-[1.08] mt-4">
              One graph tells you who&apos;s thriving — and who needs a hand.
            </h2>
            <p className="text-[17px] leading-relaxed text-[#B5B5B5] mt-5">
              Every person and pod gets a living performance line. Automatic KPI tracking means the numbers are
              always current, and smart alerts surface a dip before it becomes a problem.
            </p>
            <ul className="flex flex-col gap-3.5 mt-7 list-none p-0">
              {CHECKS.map((c) => (
                <li key={c} className="flex items-center gap-3 text-base text-[#E5E5E5]">
                  <span className="w-6 h-6 rounded-full bg-[#00D4A0]/15 flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={3} className="text-[#00D4A0]" />
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={160}>
            <div className="bg-[#111] border border-[#242424] rounded-2xl p-8">
              <div className="flex items-center gap-7">
                <Ring pct={87} />
                <div className="flex-1 flex flex-col gap-4">
                  {BARS.map((b) => (
                    <div key={b.label}>
                      <div className="flex justify-between text-[13px] mb-1.5">
                        <span className="text-[#C9C9C9]">{b.label}</span>
                        <span className="text-[#8A8A8A]">{b.val}</span>
                      </div>
                      <Bar targetWidthClass={b.widthClass} delayClass={b.delayClass} colorClass={b.colorClass} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-6 pt-5 border-t border-[#1e1e1e] flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#00D4A0]/10 flex items-center justify-center shrink-0">
                  <TrendingUp size={18} className="text-[#00D4A0]" />
                </div>
                <div className="text-sm text-[#C9C9C9]">
                  <span className="text-[#00D4A0] font-semibold">Coaching prompt:</span> Recognise Layla — 3 weeks
                  of consistent gains.
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// This was a testimonial from "Reem Al Marri, People Lead, Vantage · Dubai" —
// an invented person, quoted saying something she never said, at a company that
// does not exist. A fabricated endorsement attributed to a named individual is
// a different category of problem from marketing enthusiasm, and it is the kind
// of thing that is discovered rather than forgotten.
//
// Replaced with a first-party statement. It is framed and attributed as the
// company speaking, so nobody can mistake it for social proof we have not
// earned. When a real customer says something worth quoting, it goes here.
function Principle() {
  return (
    <Reveal className="max-w-[900px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6 text-center">
      <div className="text-[13px] tracking-[.2em] uppercase text-[#00D4A0] font-semibold">Why we built it</div>
      <div className="text-[clamp(24px,3.4vw,40px)] font-semibold tracking-tight leading-[1.3] mt-5">
        Most HR software measures whether people turned up. We wanted one that could tell a manager{' '}
        <span className="text-[#00D4A0]">who needs help</span> — while there is still a quarter left to help them.
      </div>
      <div className="mt-7 text-[13px] text-[#8A8A8A]">BYOND by SERVA · Dubai</div>
    </Reveal>
  )
}

function CTASection() {
  return (
    <section id="demo" className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 pt-16 lg:pt-20 pb-24 lg:pb-32">
      <Reveal className="relative bg-[linear-gradient(150deg,#0f3b30,#0a0a0a)] rounded-[28px] overflow-hidden">
        <div className="relative bg-[linear-gradient(150deg,rgba(0,212,160,.16),rgba(0,212,160,.03))] border border-[#00D4A0]/30 rounded-[28px] px-6 sm:px-10 lg:px-16 py-16 lg:py-24 text-center">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(0,212,160,.2),transparent_55%)]" />
          <div className="relative">
            <svg width="40" height="46" viewBox="0 0 100 116" fill="none" className="mx-auto mb-6">
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
            <h2 className="text-[clamp(30px,4.4vw,54px)] font-extrabold tracking-tight leading-[1.05]">
              Ready to see your team go beyond?
            </h2>
            <p className="text-lg text-[#C9C9C9] mt-5 max-w-[480px] mx-auto">
              Start your 14-day free trial in minutes, or book a 20-minute demo and we&apos;ll map your KPIs live.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 mt-9">
              <Link
                to={SIGNUP_HREF}
                className="inline-flex items-center gap-2.5 px-8 py-4 rounded-xl bg-[#00D4A0] hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-12px_rgba(0,212,160,.5)] text-[#062b22] text-base font-bold transition-all"
              >
                Start free trial <ArrowRight size={17} strokeWidth={2.6} />
              </Link>
              <Link
                to={DEMO_HREF}
                className="inline-flex items-center gap-2 px-6 py-4 rounded-xl border border-[#00D4A0]/30 hover:border-[#00D4A0] text-base font-semibold text-[#F5F5F5] transition-colors"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[#1a1a1a] px-6 sm:px-8 lg:px-10 py-14">
      <div className="max-w-[1240px] mx-auto flex flex-col lg:flex-row items-start justify-between gap-10">
        <div className="max-w-[300px]">
          <Logo size="lg" variant="dark" />
          <p className="text-sm text-[#8A8A8A] leading-relaxed mt-4">
            Better. Yield. Outstanding. Next-Level. Development. Human-centered HR &amp; performance for the teams
            building the Gulf.
          </p>
        </div>
        <div className="flex flex-wrap gap-16">
          <div className="flex flex-col gap-3">
            <span className="text-xs tracking-[.14em] uppercase text-[#6E6E6E] font-semibold">Product</span>
            <a href="#features" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Platform</a>
            <a href="#showcase" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Dashboards</a>
            <a href="#how" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">How it works</a>
          </div>
          {/* "About" and "Careers" were href="#" — links that look real and go
              nowhere. Dropped rather than faked; they come back when the pages do. */}
          <div className="flex flex-col gap-3">
            <span className="text-xs tracking-[.14em] uppercase text-[#6E6E6E] font-semibold">Get started</span>
            <Link to={SIGNUP_HREF} className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Start free trial</Link>
            <Link to={DEMO_HREF} className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Book a demo</Link>
            <Link to="/login" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Log in</Link>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-xs tracking-[.14em] uppercase text-[#6E6E6E] font-semibold">Legal</span>
            <Link to="/privacy" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
      <div className="max-w-[1240px] mx-auto mt-10 pt-6 border-t border-[#1a1a1a] flex flex-col sm:flex-row justify-between gap-3 text-[13px] text-[#6E6E6E]">
        <span>© 2026 BYOND by SERVA · Dubai, UAE</span>
        {/* Was plain text styled to look like links. Now they are links. */}
        <span className="flex gap-3">
          <Link to="/privacy" className="hover:text-[#B5B5B5] transition-colors">Privacy</Link>
          <span aria-hidden="true">·</span>
          <Link to="/terms" className="hover:text-[#B5B5B5] transition-colors">Terms</Link>
        </span>
      </div>
    </footer>
  )
}

export default function Landing() {
  return (
    <div className="bg-[#0A0A0A] text-[#F5F5F5] overflow-x-hidden min-h-screen selection:bg-[#00D4A0] selection:text-[#062b22]">
      <Nav />
      <Hero />
      <LogoStrip />
      <Features />
      <HowItWorks />
      <Acronym />
      <Showcase />
      <Principle />
      <CTASection />
      <Footer />
    </div>
  )
}
