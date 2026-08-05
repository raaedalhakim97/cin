import { useCallback, useState } from 'react'
import { View, ScrollView, RefreshControl } from 'react-native'
import { useFocusEffect } from 'expo-router'
import supabase from '../lib/supabase'
import useAuthStore from '../store/authStore'
import useModeStore from '../store/modeStore'
import useUiStore from '../store/uiStore'
import TopBar from './TopBar'
import { useTheme } from './ui'
import { space } from '../theme'

// Common shell: dark top bar plus a scroll area for content.
//
// The drawer itself is deliberately NOT rendered here — it lives once at the
// root (app/_layout.jsx) and is opened through uiStore. Rendering it per screen
// mounted one Modal per tab, and the leftover closed modals blocked taps.
export default function Screen({ title, children, onRefresh, refreshing = false, scroll = true }) {
  const { c } = useTheme()
  const openDrawer = useUiStore((s) => s.openDrawer)
  const isManager = useAuthStore((s) => s.isManager())
  const mode = useModeStore((s) => s.mode)
  const [pending, setPending] = useState(0)

  // Drives the badge on the bell. Only meaningful for a role that can approve.
  const loadPending = useCallback(async () => {
    if (!isManager) {
      setPending(0)
      return
    }
    const { count } = await supabase
      .from('leave_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
    setPending(count ?? 0)
  }, [isManager])

  useFocusEffect(
    useCallback(() => {
      loadPending()
    }, [loadPending])
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar
        title={title}
        onMenu={openDrawer}
        notifications={mode === 'manager' ? pending : 0}
        onNotifications={openDrawer}
        onHelp={openDrawer}
      />
      {scroll ? (
        <ScrollView
          style={{ flex: 1, backgroundColor: c.bg }}
          contentContainerStyle={{ padding: space(2), paddingBottom: space(5) }}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.cyan} /> : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, backgroundColor: c.bg }}>{children}</View>
      )}
    </View>
  )
}
