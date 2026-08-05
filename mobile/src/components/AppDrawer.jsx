import { View, Text, Pressable, Modal, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import useAuthStore from '../store/authStore'
import useModeStore from '../store/modeStore'
import useUiStore from '../store/uiStore'
import { Avatar, useTheme } from './ui'
import { radius, space, type } from '../theme'

// Grouped navigation drawer with a Personal / Manager switch at the top, after
// the reference app. Sections are grouped by what the item is about rather than
// listed flat, which is what makes a long menu scannable.
//
// The Manager half of the toggle is not rendered at all for a role that cannot
// use it — a disabled control that never becomes available is just noise.

function Item({ icon, label, onPress, badge, active }) {
  const { c } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(2),
        paddingVertical: space(1.5),
        paddingHorizontal: space(2.5),
        backgroundColor: active ? c.cyan + '1A' : pressed ? c.chromeAlt : 'transparent',
      })}
    >
      <Ionicons name={icon} size={21} color={active ? c.cyan : c.chromeText} />
      <Text style={{ ...type.bodyL, color: active ? c.cyan : c.chromeText, flex: 1 }}>{label}</Text>
      {badge > 0 ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: radius.pill,
            backgroundColor: c.cyan,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: c.onCyan }}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

function GroupLabel({ children }) {
  const { c } = useTheme()
  return (
    <Text
      style={{
        ...type.overline,
        color: c.chromeMuted,
        paddingHorizontal: space(2.5),
        marginTop: space(3),
        marginBottom: space(1),
      }}
    >
      {children}
    </Text>
  )
}

export default function AppDrawer({ pendingApprovals = 0 }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const visible = useUiStore((s) => s.drawerOpen)
  const onClose = useUiStore((s) => s.closeDrawer)
  const employee = useAuthStore((s) => s.employee)
  const company = useAuthStore((s) => s.company)
  const isManager = useAuthStore((s) => s.isManager())
  const signOut = useAuthStore((s) => s.signOut)
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  const go = (path) => {
    onClose()
    router.push(path)
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View
          style={{
            width: '82%',
            maxWidth: 340,
            backgroundColor: c.chrome,
            paddingTop: insets.top + space(1),
          }}
        >
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space(3) }}>
            {/* Personal / Manager switch */}
            {isManager ? (
              <View
                style={{
                  flexDirection: 'row',
                  margin: space(2),
                  padding: 4,
                  borderRadius: radius.pill,
                  backgroundColor: c.chromeAlt,
                }}
              >
                {['personal', 'manager'].map((m) => {
                  const active = mode === m
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m)}
                      style={{
                        flex: 1,
                        paddingVertical: space(1.25),
                        borderRadius: radius.pill,
                        backgroundColor: active ? c.cyan : 'transparent',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          ...type.label,
                          color: active ? c.onCyan : c.chromeMuted,
                        }}
                      >
                        {m === 'personal' ? 'Personal' : 'Manager'}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}

            {/* Identity */}
            <Pressable
              onPress={() => go('/(tabs)/profile')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(2.5) }}
            >
              <Avatar name={employee?.full_name} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.h2, color: c.chromeText }} numberOfLines={1}>
                  {employee?.full_name ?? 'Not linked'}
                </Text>
                <Text style={{ ...type.caption, color: c.chromeMuted }} numberOfLines={1}>
                  {employee?.job_title ?? '—'}
                  {company?.name ? ` · ${company.name}` : ''}
                </Text>
              </View>
            </Pressable>

            <Item icon="home-outline" label="Home" onPress={() => go('/(tabs)')} />
            <Item icon="megaphone-outline" label="Announcements" onPress={() => go('/feed')} />

            <GroupLabel>Work</GroupLabel>
            <Item icon="time-outline" label="Attendance" onPress={() => go('/(tabs)/attendance')} />
            <Item icon="calendar-outline" label="Leave" onPress={() => go('/(tabs)/leave')} />
            <Item icon="trending-up-outline" label="Performance" onPress={() => go('/(tabs)/kpi')} />

            {mode === 'manager' && isManager ? (
              <>
                <GroupLabel>My team</GroupLabel>
                <Item
                  icon="checkmark-done-outline"
                  label="Approvals"
                  badge={pendingApprovals}
                  onPress={() => go('/approvals')}
                />
                <Item icon="people-outline" label="Team attendance" onPress={() => go('/approvals')} />
              </>
            ) : null}

            <GroupLabel>Account</GroupLabel>
            <Item icon="person-outline" label="My profile" onPress={() => go('/(tabs)/profile')} />
            <Item icon="document-text-outline" label="Payslips" onPress={() => go('/(tabs)/profile')} />
            <Item icon="settings-outline" label="Settings" onPress={() => go('/settings')} />
            <Item
              icon="log-out-outline"
              label="Sign out"
              onPress={() => {
                onClose()
                signOut()
              }}
            />
          </ScrollView>
        </View>

        {/* Tapping the dimmed remainder closes the drawer. */}
        <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={onClose} />
      </View>
    </Modal>
  )
}
