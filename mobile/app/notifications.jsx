import { useCallback, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../src/lib/supabase'
import useAuthStore from '../src/store/authStore'
import useNotificationStore from '../src/store/notificationStore'
import { metaFor, mobileRoute, timeAgo } from '../src/lib/notifications'
import { Card, EmptyState, ErrorState, SkeletonCard, useTheme } from '../src/components/ui'
import { radius, space, type } from '../src/theme'

// The notification list, reached from the bell in TopBar.
//
// A pushed screen rather than the dropdown panel the web app uses. A 352px popover
// anchored to a header icon is a desktop shape; on a 390px phone it would be the
// width of the screen anyway, so it may as well be a screen — and a screen gets
// back-gesture dismissal, pull-to-refresh and the full height for free.
//
// Same two decisions as the web bell, for the same reasons: no employee_id filter
// (RLS owns that), and marking read never blocks navigation.
export default function Notifications() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const caps = useAuthStore((s) => s.caps)
  const refreshUnread = useNotificationStore((s) => s.refresh)

  // null means "never loaded", the only state that shows a skeleton. On a return
  // visit the previous list stays on screen while the refetch lands, so the
  // screen does not flash empty every time it is opened.
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    const { data, error: err } = await supabase
      .from('notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (err) {
      console.error('[Notifications] load failed', err)
      setError(true)
      return
    }
    setRows(data ?? [])
    // The badge and the list are read from the same table in the same breath, so
    // they cannot disagree about how many are unread.
    refreshUnread()
  }, [refreshUnread])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  async function pullToRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function openOne(row) {
    const to = mobileRoute(row.kind, caps)

    // Mark read first, but never let a failure here swallow the tap. Going where
    // the person asked matters more than the read flag.
    if (!row.read_at) {
      const { error: err } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', row.id)
      if (err) console.error('[Notifications] mark read failed', err)
      else {
        // Update in place rather than refetching: the row is about to be covered
        // by the pushed screen, and a refetch would reorder under the finger.
        setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)))
        refreshUnread()
      }
    }

    // A kind with no mobile destination stays on this screen rather than pushing
    // a route that does not exist — which expo-router answers with a blank
    // screen and no way back.
    if (to) router.push(to)
  }

  async function markAllRead() {
    // One statement rather than one request per row. The function runs as the
    // caller, so RLS keeps it to their own notifications.
    const { error: err } = await supabase.rpc('mark_notifications_read')
    if (err) {
      console.error('[Notifications] mark all read failed', err)
      return
    }
    load()
  }

  const unreadHere = (rows ?? []).filter((r) => !r.read_at).length

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space(2), paddingTop: insets.top + space(2), paddingBottom: space(4) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} tintColor={c.mint} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginBottom: space(2) }}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <Text style={{ ...type.h1, color: c.text, flex: 1 }}>Notifications</Text>
        {unreadHere > 0 ? (
          <Pressable
            onPress={markAllRead}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
            accessibilityLabel="Mark all as read"
          >
            <Ionicons name="checkmark-done" size={16} color={c.mint} />
            <Text style={{ ...type.label, color: c.mint }}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {rows === null && !error ? (
        <View style={{ gap: space(1.5) }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : error ? (
        <ErrorState onRetry={load} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="—"
          title="Nothing yet"
          body="You will hear about your shifts, your leave and your attendance here."
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((r, i) => {
            const meta = metaFor(r.kind)
            const unread = !r.read_at
            return (
              <Pressable
                key={r.id}
                onPress={() => openOne(r)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: space(1.5),
                  padding: space(1.5),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                  // A wash rather than a dot alone. On a phone the list is read at
                  // a glance and the block of colour is what carries "new".
                  backgroundColor: pressed ? c.surfaceAlt : unread ? c.accentSoft : 'transparent',
                })}
                accessibilityLabel={`${unread ? 'Unread. ' : ''}${r.title}`}
              >
                <View
                  style={{
                    width: space(4),
                    height: space(4),
                    borderRadius: radius.sm,
                    backgroundColor: meta.tint + '1F',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Ionicons name={meta.icon} size={18} color={meta.tint} />
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(1) }}>
                    <Text
                      style={{
                        ...type.body,
                        flex: 1,
                        fontWeight: unread ? '700' : '400',
                        color: unread ? c.text : c.textMuted,
                      }}
                      numberOfLines={2}
                    >
                      {r.title}
                    </Text>
                    <Text style={{ ...type.caption, color: c.textFaint }}>{timeAgo(r.created_at)}</Text>
                  </View>
                  {r.body ? (
                    <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2, lineHeight: 16 }} numberOfLines={3}>
                      {r.body}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </Card>
      )}
    </ScrollView>
  )
}
