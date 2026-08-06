import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

// Durations. Short enough to feel immediate, long enough to read as movement
// rather than a jump.
export const DURATION = {
  fast: 140, // press feedback
  base: 220, // drawers, sheets
  slow: 300, // screen transitions
}

export const EASING = {
  // Standard decelerate: quick to start, settles softly. Matches how the
  // platform animates its own sheets.
  out: [0.2, 0, 0, 1],
}

// react-native-web cannot use the native driver; passing true there logs a
// warning on every animation.
export const USE_NATIVE_DRIVER = Platform.OS !== 'web'

// Honours the OS "reduce motion" setting. When on, animations are skipped rather
// than shortened — the point is to remove movement, not to make it quicker.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    let active = true
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (active) setReduced(!!value)
      })
      .catch(() => {})

    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => setReduced(!!value))
    return () => {
      active = false
      sub?.remove?.()
    }
  }, [])

  return reduced
}
