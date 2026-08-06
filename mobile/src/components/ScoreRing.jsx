import Svg, { Circle } from 'react-native-svg'
import { View, Text } from 'react-native'
import { useTheme } from './ui'
import { ratingColor, type } from '../theme'

// The KPI score ring from the design PDF's mobile KPI screen. Color follows the
// rating band, matching the web's RATING_META so 85 looks the same on both.
export default function ScoreRing({ score, rating, size = 132, stroke = 12 }) {
  const { c } = useTheme()
  const value = Number(score) || 0
  const tint = ratingColor[rating] ?? c.mint
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, value))
  const dash = (clamped / 100) * circumference

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tint}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          // Start the arc at 12 o'clock instead of 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={{ fontSize: size * 0.28, fontWeight: '700', color: c.text }}>{value ? Math.round(value) : '—'}</Text>
      <Text style={{ ...type.caption, color: c.textMuted }}>/ 100</Text>
    </View>
  )
}
