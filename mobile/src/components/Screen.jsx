import { useCallback } from 'react'
import { View, ScrollView, RefreshControl } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import useAuthStore from '../store/authStore'
import useNotificationStore from '../store/notificationStore'
import useUiStore from '../store/uiStore'
import TopBar from './TopBar'
import { useTheme } from './ui'
import { space } from '../theme'

// Common shell: chrome bar plus a scroll area for content.
//
// The drawer itself is deliberately NOT rendered here — it lives once at the
// root (app/_layout.jsx) and is opened through uiStore. Rendering it per screen
// mounted one Modal per tab, and the leftover closed modals blocked taps.
export default function Screen({ title, children, onRefresh, refreshing = false, scroll = true }) {
  const { c } = useTheme()
  const router = useRouter()
  const openDrawer = useUiStore((s) => s.openDrawer)
  const employee = useAuthStore((s) => s.employee)
  const unread = useNotificationStore((s) => s.unread)
  const refreshUnread = useNotificationStore((s) => s.refresh)

  // The bell used to count PENDING LEAVE REQUESTS and open the drawer. Both were
  // wrong in the same way: the badge promised notifications and delivered one
  // manager's approval queue, hidden entirely in personal mode, so an employee
  // with a late punch or a declined leave request saw a permanently empty bell —
  // and tapping it landed on the navigation menu, which is not where any of that
  // lives. Nothing is lost by removing it: leave_submitted notifications now go
  // to the same approvers, so the queue is inside the stream rather than beside it.
  //
  // An account with no employee record cannot have notifications — every row
  // requires an employee_id — so there is nothing to count for one.
  useFocusEffect(
    useCallback(() => {
      if (!employee?.id) return
      refreshUnread()
      // Only the focused screen holds a timer, and it stops on blur, so this is
      // one 60-second HEAD request rather than one per mounted tab. Matches the
      // web bell's interval; the point is "within a minute", not "instantly",
      // which is also why neither surface holds a realtime socket open.
      const timer = setInterval(refreshUnread, 60000)
      return () => clearInterval(timer)
    }, [employee?.id, refreshUnread])
  )

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar
        title={title}
        onMenu={openDrawer}
        notifications={employee?.id ? unread : 0}
        onNotifications={() => router.push('/notifications')}
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
