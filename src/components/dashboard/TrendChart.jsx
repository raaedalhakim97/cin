// Extracted from TeamAnalytics.jsx (session 32) so ManagerDashboard and
// AdminDashboard can reuse the exact same hand-rolled SVG line chart instead
// of a chart library, per the design system's "hand-rolled SVG only" rule.
// Generalized from a hardcoded 3-line team/att/ach chart into a configurable
// `lines` array so a caller can render just one line (e.g. team avg only)
// without carrying the other two — `lines` defaults to TeamAnalytics.jsx's
// original three-line config so its own rendering is unchanged.
const DEFAULT_LINES = [
  { key: 'att',  color: '#4DA6FF', width: 2 },
  { key: 'ach',  color: '#FFB020', width: 2 },
  { key: 'team', color: '#00D4A0', width: 3.5, dot: true },
]

export default function TrendChart({ data, lines = DEFAULT_LINES, min = 60, max = 100 }) {
  const W = 640, H = 230, pl = 34, pr = 12, pt = 16, pb = 26
  const iw = W - pl - pr, ih = H - pt - pb

  const x = i => pl + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw)
  const y = v => pt + ih - ((v - min) / (max - min)) * ih
  const path = key => data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(d[key])}`).join(' ')

  const gridlines = []
  for (let g = min; g <= max; g += 10) gridlines.push(g)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: 230 }}>
      {gridlines.map(g => (
        <g key={g}>
          <line x1={pl} x2={W - pr} y1={y(g)} y2={y(g)} className="stroke-[#E8E8E8] dark:stroke-[#2E2E2E]" strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />
          <text x={pl - 6} y={y(g) + 3} textAnchor="end" fontSize={10} className="fill-[#AAAAAA] dark:fill-[#6B6B6B]">{g}</text>
        </g>
      ))}
      {data.map((d, i) => (
        <text key={d.month} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} className="fill-[#AAAAAA] dark:fill-[#6B6B6B]">{d.label}</text>
      ))}
      {lines.map(line => (
        <path key={line.key} d={path(line.key)} fill="none" stroke={line.color} strokeWidth={line.width} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {lines.filter(line => line.dot).map(line => (
        data.map((d, i) => (
          <circle key={`${line.key}-${d.month}`} cx={x(i)} cy={y(d[line.key])} r={3.5} fill={line.color} />
        ))
      ))}
    </svg>
  )
}
