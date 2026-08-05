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

function useInView() {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
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
  }, [])
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
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!inView) return
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
              BYOND tracks every KPI automatically and turns it into living performance graphs — so managers coach
              with clarity, and no one gets lost in a spreadsheet.
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
            <div className="flex gap-6 sm:gap-8 mt-12 flex-wrap">
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-[#00D4A0]">
                  <CountUp to={38} suffix="%" />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">avg. productivity lift</div>
              </div>
              <div className="w-px bg-[#222]" />
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-white">
                  <CountUp to={5} prefix="<" suffix=" min" />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">to full setup</div>
              </div>
              <div className="w-px bg-[#222]" />
              <div>
                <div className="text-[34px] font-extrabold tracking-tight text-white">
                  <CountUp to={120} suffix="+" />
                </div>
                <div className="text-[13px] text-[#8A8A8A] mt-0.5">KPI templates</div>
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

function LogoStrip() {
  return (
    <Reveal className="max-w-[1240px] mx-auto px-6 sm:px-8 lg:px-10 mt-10">
      <div className="border-y border-[#1a1a1a] py-7 flex flex-wrap items-center justify-between gap-6">
        <span className="text-xs tracking-[.16em] uppercase text-[#6E6E6E] font-semibold">
          Trusted by SME teams across the Gulf
        </span>
        <div className="flex flex-wrap gap-8 lg:gap-10 items-center opacity-[0.55] font-bold text-lg tracking-tight text-[#C9C9C9]">
          <span>Meridian</span>
          <span>Qasr&nbsp;Labs</span>
          <span>Nakhla</span>
          <span>Vantage</span>
          <span>Dune&nbsp;&amp;&nbsp;Co</span>
        </div>
      </div>
    </Reveal>
  )
}

const FEATURES = [
  { icon: Workflow, title: 'Automatic KPI tracking', body: 'Connect your tools once. BYOND pulls activity and scores KPIs continuously — zero manual entry.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 0 },
  { icon: TrendingUp, title: 'Live performance graphs', body: 'Every person and pod gets a trend line that updates in real time. See momentum at a glance.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 80 },
  { icon: LayoutGrid, title: 'Team dashboards', body: 'One clear view of who is thriving and who needs support — organised the way your teams actually work.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 160 },
  { icon: AlertTriangle, title: 'Smart alerts', body: 'A KPI dip gets flagged before it becomes a problem — so you coach early, not after the fact.', iconBg: 'bg-[#FF4D4D]/10', iconColor: 'text-[#FF4D4D]', delay: 0 },
  { icon: Target, title: 'Goals & reviews', body: 'Lightweight OKRs and review cycles that connect daily work to the outcomes that matter.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 80 },
  { icon: HeartHandshake, title: 'Human-centered insights', body: 'Not surveillance — coaching. BYOND turns numbers into prompts that help managers support their people.', iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]', delay: 160 },
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
          No manual entry, no guesswork. BYOND connects to the tools your team already uses and turns activity into
          clear, human performance signals.
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
  { num: '01', title: 'Connect', body: 'Link the tools your team already uses — no data migration, no IT project.', delay: 0 },
  { num: '02', title: 'Track automatically', body: 'KPIs score themselves in real time. Dashboards fill in without anyone touching a spreadsheet.', delay: 100 },
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

function Quote() {
  return (
    <Reveal className="max-w-[900px] mx-auto px-6 sm:px-8 lg:px-10 pt-24 lg:pt-32 pb-6 text-center">
      <div className="text-[clamp(24px,3.4vw,40px)] font-semibold tracking-tight leading-[1.3]">
        &quot;We stopped chasing spreadsheets and started actually coaching. BYOND made performance{' '}
        <span className="text-[#00D4A0]">visible</span> — and human.&quot;
      </div>
      <div className="mt-7 flex items-center justify-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[linear-gradient(135deg,#00D4A0,#0a7a5e)]" />
        <div className="text-left">
          <div className="text-[15px] font-semibold">Reem Al Marri</div>
          <div className="text-[13px] text-[#8A8A8A]">People Lead, Vantage · Dubai</div>
        </div>
      </div>
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
          <div className="flex flex-col gap-3">
            <span className="text-xs tracking-[.14em] uppercase text-[#6E6E6E] font-semibold">Company</span>
            <a href="#" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">About</a>
            <a href="#" className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Careers</a>
            <Link to={SIGNUP_HREF} className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Start free trial</Link>
            <Link to={DEMO_HREF} className="text-sm text-[#B5B5B5] hover:text-[#F5F5F5] transition-colors">Book a demo</Link>
          </div>
        </div>
      </div>
      <div className="max-w-[1240px] mx-auto mt-10 pt-6 border-t border-[#1a1a1a] flex flex-col sm:flex-row justify-between gap-3 text-[13px] text-[#6E6E6E]">
        <span>© 2026 BYOND by SERVA · Dubai, UAE</span>
        <span>Privacy · Terms</span>
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
      <Quote />
      <CTASection />
      <Footer />
    </div>
  )
}
