import { useRef } from 'react'
import { useColorScheme, View, Text, Pressable, ActivityIndicator, StyleSheet, Animated, Easing } from 'react-native'
import useThemeStore from '../store/themeStore'
import { DURATION, USE_NATIVE_DRIVER, useReducedMotion } from '../lib/motion'
import { palette, radius, space, type } from '../theme'

// Press feedback: a small scale-down alongside the opacity change. Opacity alone
// reads as flat — the scale is what makes a tap feel like it landed on something
// physical. Skipped entirely when the OS asks for reduced motion.
export function usePressScale(to = 0.97) {
  const scale = useRef(new Animated.Value(1)).current
  const reduceMotion = useReducedMotion()

  const animate = (value) =>
    Animated.timing(scale, {
      toValue: value,
      duration: DURATION.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start()

  return {
    scale,
    onPressIn: () => !reduceMotion && animate(to),
    onPressOut: () => !reduceMotion && animate(1),
    style: { transform: [{ scale }] },
  }
}

// Resolves the stored preference into a concrete theme: an explicit light/dark
// choice wins, and 'system' defers to the OS.
export function useTheme() {
  const preference = useThemeStore((s) => s.preference)
  const scheme = useColorScheme()
  const isDark = preference === 'system' ? scheme === 'dark' : preference === 'dark'
  return { c: palette(isDark), isDark }
}

export function Card({ children, style }) {
  const { c, isDark } = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderColor: c.border,
          borderWidth: 1,
          borderRadius: radius.md,
          padding: space(2),
        },
        // A light ground gets a soft lift instead of a hard border reading as the
        // only separation; on dark the border alone is enough.
        !isDark && {
          shadowColor: '#0D1B2A',
          shadowOpacity: 0.05,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

// Horizontal quick-action tile, as on the reference app's home screen.
export function QuickAction({ icon, label, onPress, tint }) {
  const { c } = useTheme()
  const press = usePressScale(0.95)
  return (
    <Animated.View style={press.style}>
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={({ pressed }) => ({
        width: 96,
        padding: space(1.5),
        borderRadius: radius.md,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: 'flex-start',
        gap: space(1),
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: space(4),
          height: space(4),
          borderRadius: radius.sm,
          backgroundColor: (tint ?? c.cyan) + '1F',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <Text style={{ ...type.caption, fontWeight: '600', color: c.text }} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
    </Animated.View>
  )
}

export function Overline({ children }) {
  const { c } = useTheme()
  return (
    <Text style={{ ...type.overline, color: c.textFaint, marginBottom: space(1) }}>
      {String(children).toUpperCase()}
    </Text>
  )
}

export function Badge({ label, color }) {
  const { c } = useTheme()
  const tint = color ?? c.mint
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: tint + '1A', paddingHorizontal: space(1), paddingVertical: 4, borderRadius: radius.pill }}>
      <Text style={{ ...type.caption, fontWeight: '700', color: tint }}>{label}</Text>
    </View>
  )
}

export function Button({ label, onPress, variant = 'primary', disabled, loading, style }) {
  const { c } = useTheme()
  const press = usePressScale(0.97)
  const isPrimary = variant === 'primary'
  const isDanger = variant === 'danger'
  const bg = isPrimary ? c.mint : isDanger ? c.danger : 'transparent'
  const fg = isPrimary ? c.onMint : isDanger ? '#FFFFFF' : c.text

  return (
    <Animated.View style={[press.style, style]}>
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight: space(6),
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space(1),
          borderRadius: radius.sm,
          paddingHorizontal: space(2),
          backgroundColor: bg,
          borderWidth: isPrimary || isDanger ? 0 : 1,
          borderColor: c.border,
          opacity: disabled || loading ? 0.55 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {loading && <ActivityIndicator size="small" color={fg} />}
      <Text style={{ ...type.label, color: fg }}>{label}</Text>
    </Pressable>
    </Animated.View>
  )
}

export function Avatar({ name, size = 40, uri }) {
  const { c } = useTheme()
  const label = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  // Initials fallback always, circle only — per the design PDF's avatar rule.
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.mint + '26',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Text style={{ color: c.mint, fontWeight: '700', fontSize: size * 0.36 }}>{label}</Text>
    </View>
  )
}

export function StatTile({ value, label, hint, color }) {
  const { c } = useTheme()
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ ...type.h1, color: color ?? c.text }} numberOfLines={1}>
        {value}
      </Text>
      <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }} numberOfLines={1}>
        {label}
      </Text>
      {hint ? (
        <Text style={{ ...type.caption, color: c.textFaint, marginTop: 2 }} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}

// Skeleton on every fetch — never a blank screen. Static rather than animated so
// it costs nothing on low-end Android, which matters for the Nigeria market.
export function Skeleton({ height = 16, width = '100%', style }) {
  const { c } = useTheme()
  return <View style={[{ height, width, backgroundColor: c.surfaceAlt, borderRadius: radius.sm }, style]} />
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <Card>
      <Skeleton height={20} width="55%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={12} width={i === lines - 1 ? '40%' : '85%'} style={{ marginTop: space(1) }} />
      ))}
    </Card>
  )
}

// Icon + heading + CTA for every empty list or table — also from the PDF's
// checklist. The web app only wired this into 6 of ~20 list screens.
export function EmptyState({ icon = '—', title, body, actionLabel, onAction }) {
  const { c } = useTheme()
  return (
    <View style={{ alignItems: 'center', paddingVertical: space(5), paddingHorizontal: space(3) }}>
      <View
        style={{
          width: space(7),
          height: space(7),
          borderRadius: space(3.5),
          backgroundColor: c.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space(2),
        }}
      >
        <Text style={{ fontSize: 24, color: c.textFaint }}>{icon}</Text>
      </View>
      <Text style={{ ...type.h2, color: c.text, textAlign: 'center' }}>{title}</Text>
      {body ? (
        <Text style={{ ...type.body, color: c.textMuted, textAlign: 'center', marginTop: space(0.5) }}>{body}</Text>
      ) : null}
      {actionLabel ? <Button label={actionLabel} onPress={onAction} style={{ marginTop: space(2), alignSelf: 'stretch' }} /> : null}
    </View>
  )
}

export function ErrorState({ onRetry, message = 'Something went wrong loading this.' }) {
  return <EmptyState icon="!" title="Couldn't load" body={message} actionLabel="Try again" onAction={onRetry} />
}

export function Row({ label, value, valueColor }) {
  const { c } = useTheme()
  return (
    <View style={styles.row}>
      <Text style={{ ...type.body, color: c.textMuted }}>{label}</Text>
      <Text style={{ ...type.label, color: valueColor ?? c.text }} numberOfLines={1}>
        {value ?? '—'}
      </Text>
    </View>
  )
}

export function SectionTitle({ children, action, onAction }) {
  const { c } = useTheme()
  return (
    <View style={styles.sectionTitle}>
      <Text style={{ ...type.h2, color: c.text }}>{children}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={{ ...type.label, color: c.mint }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(2),
    paddingVertical: space(1),
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space(1),
    marginTop: space(2),
  },
})
