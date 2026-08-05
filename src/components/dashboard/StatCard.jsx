// Extracted from Dashboard.jsx (session 32) so every role dashboard can
// share one implementation. `accent` (boolean) is the original API kept
// for backward compat with existing callers; `tone` is the superset that
// also lets callers reach for orange/red/purple when a stat needs to read
// as a warning or a KPI-style highlight, not just "on/off".
const TONE_STYLES = {
  mint:    { iconBg: 'bg-[#00D4A0]/10', iconColor: 'text-[#00D4A0]' },
  orange:  { iconBg: 'bg-[#FF8C42]/10', iconColor: 'text-[#FF8C42]' },
  red:     { iconBg: 'bg-[#FF4D4D]/10', iconColor: 'text-[#FF4D4D]' },
  purple:  { iconBg: 'bg-[#A78BFA]/10', iconColor: 'text-[#A78BFA]' },
  blue:    { iconBg: 'bg-[#4D9FFF]/10', iconColor: 'text-[#4D9FFF]' },
  neutral: { iconBg: 'bg-[#F5F5F0] dark:bg-[#252525]', iconColor: 'text-[#666666] dark:text-[#A0A0A0]' },
}

export default function StatCard({ icon: Icon, label, value, accent, tone }) {
  const resolvedTone = tone ?? (accent ? 'mint' : 'neutral')
  const { iconBg, iconColor } = TONE_STYLES[resolvedTone] ?? TONE_STYLES.neutral

  return (
    <div className="flex items-start gap-4 p-5 rounded-xl bg-white dark:bg-[#1E1E1E] border border-[#E8E8E8] dark:border-[#2A2A2A]">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div>
        <p className="text-xs font-medium text-[#666666] dark:text-[#A0A0A0] mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-[#1A1A1A] dark:text-white">{value || '—'}</p>
      </div>
    </div>
  )
}
