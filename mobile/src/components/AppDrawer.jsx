import { View, Text, Pressable, Modal, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import useAuthStore from '../store/authStore'
import useModeStore from '../store/modeStore'
import useUiStore from '../store/uiStore'
import { MODE_LABEL } from '../lib/permissions'
import { Avatar, useTheme } from './ui'
import { radius, space, type } from '../theme'

// Grouped navigation drawer with a surface switch at the top, after the
// reference app. Which items appear is decided entirely by capabilities derived
// from the access-control standard — per §4.10, a control a role cannot use is
// not rendered at all rather than shown and allowed to fail.

function Item({ icon, label, onPress, badge, hint }) {
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
        backgroundColor: pressed ? c.chromeAlt : 'transparent',
      })}
    >
      <Ionicons name={icon} size={21} color={c.chromeText} />
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.bodyL, color: c.chromeText }}>{label}</Text>
        {hint ? <Text style={{ ...type.caption, color: c.chromeMuted }}>{hint}</Text> : null}
      </View>
      {badge > 0 ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: radius.pill,
            backgroundColor: c.mint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: '700', color: c.onMint }}>{badge}</Text>
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
  const can = useAuthStore((s) => s.caps)
  const second = useAuthStore((s) => s.second)
  const signOut = useAuthStore((s) => s.signOut)
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  const go = (path) => {
    onClose()
    router.push(path)
  }

  const inSecond = mode === second

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <View style={{ width: '82%', maxWidth: 340, backgroundColor: c.chrome, paddingTop: insets.top + space(1) }}>
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space(3) }}>
            {/* Surface switch — only for a role that has a second surface. */}
            {second ? (
              <View
                style={{
                  flexDirection: 'row',
                  margin: space(2),
                  padding: 4,
                  borderRadius: radius.pill,
                  backgroundColor: c.chromeAlt,
                }}
              >
                {['personal', second].map((m) => {
                  const active = mode === m
                  return (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m, second)}
                      style={{
                        flex: 1,
                        paddingVertical: space(1.25),
                        borderRadius: radius.pill,
                        backgroundColor: active ? c.mint : 'transparent',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ ...type.label, color: active ? c.onMint : c.chromeMuted }}>{MODE_LABEL[m]}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}

            {/* Identity, with the role spelled out — useful when access differs
                from what a colleague sees. */}
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
                  {can.label}
                  {company?.name ? ` · ${company.name}` : ''}
                </Text>
              </View>
            </Pressable>

            {can.isReadOnly ? (
              <View style={{ marginHorizontal: space(2.5), padding: space(1.5), borderRadius: radius.sm, backgroundColor: c.warning + '1F' }}>
                <Text style={{ ...type.caption, color: c.warning }}>
                  Read-only account. You can view records but cannot change anything, including your own.
                </Text>
              </View>
            ) : null}

            <View style={{ height: space(1) }} />
            <Item icon="home-outline" label="Home" onPress={() => go('/(tabs)')} />
            <Item icon="megaphone-outline" label="Announcements" onPress={() => go('/feed')} />

            <GroupLabel>Work</GroupLabel>
            {can.viewOwnAttendance ? (
              <Item icon="time-outline" label="Attendance" onPress={() => go('/(tabs)/attendance')} />
            ) : null}
            {can.viewOwnLeave ? <Item icon="umbrella-outline" label="Leave" onPress={() => go('/(tabs)/leave')} /> : null}
            <Item icon="trending-up-outline" label="Performance" onPress={() => go('/(tabs)/kpi')} />
            {can.viewSchedule ? (
              <Item icon="calendar-outline" label="My schedule" onPress={() => go('/(tabs)/attendance')} />
            ) : null}

            {/* Second surface, shown only while you're in it. */}
            {inSecond && second === 'manager' ? (
              <>
                <GroupLabel>My team</GroupLabel>
                {can.approveLeaveStep1 ? (
                  <Item
                    icon="checkmark-done-outline"
                    label="Leave approvals"
                    badge={pendingApprovals}
                    hint={can.approveLeaveFinal ? 'Final sign-off' : 'Step-one review'}
                    onPress={() => go('/approvals')}
                  />
                ) : null}
                {can.viewTeamAttendance ? (
                  <Item icon="people-outline" label="Team attendance" onPress={() => go('/approvals')} />
                ) : null}
                {can.evaluateOthers ? (
                  <Item icon="star-outline" label="Team performance" onPress={() => go('/(tabs)/kpi')} />
                ) : null}
                {can.recommendWarning ? (
                  <Item icon="alert-circle-outline" label="Recommend a warning" hint="HR issues it" onPress={() => go('/approvals')} />
                ) : null}
              </>
            ) : null}

            {inSecond && second === 'ops' ? (
              <>
                <GroupLabel>Operations</GroupLabel>
                {can.manageShifts ? (
                  <Item icon="calendar-number-outline" label="Shift schedule" onPress={() => go('/operations')} />
                ) : null}
                {can.manageDocuments ? (
                  <Item icon="folder-open-outline" label="Documents" onPress={() => go('/operations')} />
                ) : null}
                {can.viewTeamAttendance ? (
                  <Item icon="people-outline" label="Team attendance" hint="View only" onPress={() => go('/operations')} />
                ) : null}
                {can.viewInvites ? (
                  <Item icon="link-outline" label="Invite links" hint="View only" onPress={() => go('/operations')} />
                ) : null}
              </>
            ) : null}

            <GroupLabel>Account</GroupLabel>
            <Item icon="person-outline" label="My profile" onPress={() => go('/(tabs)/profile')} />
            {can.viewOwnPayslip ? (
              <Item icon="document-text-outline" label="Payslips" onPress={() => go('/(tabs)/profile')} />
            ) : null}
            <Item
              icon="shield-checkmark-outline"
              label={can.manageRoles ? 'Access & permissions' : 'My access'}
              hint={can.manageRoles ? 'Assign roles' : can.label}
              onPress={() => go('/access')}
            />
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

        <Pressable style={{ flex: 1, backgroundColor: '#00000088' }} onPress={onClose} />
      </View>
    </Modal>
  )
}
