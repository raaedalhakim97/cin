import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, Animated, Dimensions, Easing } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import useAuthStore from '../store/authStore'
import useModeStore from '../store/modeStore'
import useUiStore from '../store/uiStore'
import { MODE_LABEL } from '../lib/permissions'
import { NAV } from '../lib/vocabulary'
import { DURATION, USE_NATIVE_DRIVER, useReducedMotion } from '../lib/motion'
import { Avatar, useTheme } from './ui'
import { radius, space, type } from '../theme'

// Grouped navigation drawer with a surface switch at the top, after the
// reference app. Which items appear is decided entirely by capabilities derived
// from the access-control standard — per §4.10, a control a role cannot use is
// not rendered at all rather than shown and allowed to fail.
//
// This is an absolutely-positioned overlay, not a <Modal>. Modal's 'slide'
// animation enters from the bottom, which is wrong for a panel anchored to the
// left edge — it has to travel in from the side it lives on. The Modal also left
// a full-screen container mounted after closing, which swallowed taps on the
// hamburger. Driving translateX here fixes both: the panel slides from the left,
// and when closed the overlay is unmounted entirely.

const PANEL_WIDTH = Math.min(340, Dimensions.get('window').width * 0.82)

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

  const reduceMotion = useReducedMotion()

  // 0 closed, 1 open. Drives both the panel's slide and the scrim's fade so they
  // stay in step.
  const progress = useRef(new Animated.Value(0)).current
  // Kept mounted while closing so the exit animation can play, then removed so
  // nothing is left to intercept touches.
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (visible) setMounted(true)

    const animation = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : DURATION.base,
      easing: Easing.bezier(0.2, 0, 0, 1),
      useNativeDriver: USE_NATIVE_DRIVER,
    })
    animation.start(({ finished }) => {
      if (finished && !visible) setMounted(false)
    })
    return () => animation.stop()
  }, [visible, reduceMotion, progress])

  const go = (path) => {
    onClose()
    router.push(path)
  }

  const inSecond = mode === second

  if (!mounted) return null

  return (
    <View
      // pointerEvents follows the open state, so a closing overlay stops
      // capturing touches immediately rather than when the animation ends.
      pointerEvents={visible ? 'auto' : 'none'}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', zIndex: 100 }}
    >
      {/* Scrim, behind the panel, fading with the same progress value. */}
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#000',
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        style={{
          width: PANEL_WIDTH,
          backgroundColor: c.chrome,
          // Matches the web sidebar's `border-r`. Now that the drawer is white
          // in light mode it needs an edge against the dimmed content behind it.
          borderRightWidth: 1,
          borderRightColor: c.border,
          paddingTop: insets.top + space(1),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-PANEL_WIDTH, 0],
              }),
            },
          ],
        }}
      >
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
            <Item icon="home-outline" label={NAV.home} onPress={() => go('/(tabs)')} />
            <Item icon="megaphone-outline" label={NAV.news} onPress={() => go('/feed')} />

            <GroupLabel>Work</GroupLabel>
            {can.viewOwnAttendance ? (
              <Item icon="time-outline" label={NAV.attendance} onPress={() => go('/(tabs)/attendance')} />
            ) : null}
            {can.viewOwnLeave ? <Item icon="umbrella-outline" label={NAV.leave} onPress={() => go('/(tabs)/leave')} /> : null}
            <Item icon="trending-up-outline" label={NAV.kpi} onPress={() => go('/(tabs)/kpi')} />
            {can.viewSchedule ? (
              <Item icon="calendar-outline" label={NAV.mySchedule} onPress={() => go('/(tabs)/attendance')} />
            ) : null}

            {/* Second surface, shown only while you're in it. */}
            {inSecond && second === 'manager' ? (
              <>
                <GroupLabel>My team</GroupLabel>
                {can.approveLeaveStep1 ? (
                  <Item
                    icon="checkmark-done-outline"
                    label={NAV.approvals}
                    badge={pendingApprovals}
                    hint={can.approveLeaveFinal ? 'Final sign-off' : 'Step-one review'}
                    onPress={() => go('/approvals')}
                  />
                ) : null}
                {can.viewTeamAttendance ? (
                  <Item icon="people-outline" label="Team attendance" onPress={() => go('/approvals')} />
                ) : null}
                {can.evaluateOthers ? (
                  <Item icon="star-outline" label={`Team ${NAV.kpi}`} onPress={() => go('/(tabs)/kpi')} />
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
                  <Item icon="calendar-number-outline" label={NAV.schedule} onPress={() => go('/operations')} />
                ) : null}
                {can.manageDocuments ? (
                  <Item icon="folder-open-outline" label={NAV.documents} onPress={() => go('/operations')} />
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
            <Item icon="person-outline" label={NAV.profile} onPress={() => go('/(tabs)/profile')} />
            {can.viewOwnPayslip ? (
              <Item icon="document-text-outline" label={NAV.payroll} onPress={() => go('/(tabs)/profile')} />
            ) : null}
            <Item
              icon="shield-checkmark-outline"
              label={can.manageRoles ? NAV.access : `My ${NAV.access.toLowerCase()}`}
              hint={can.manageRoles ? 'Assign roles' : can.label}
              onPress={() => go('/access')}
            />
            <Item icon="settings-outline" label={NAV.settings} onPress={() => go('/settings')} />
            <Item
              icon="log-out-outline"
              label={NAV.signOut}
              onPress={() => {
                onClose()
                signOut()
              }}
            />
        </ScrollView>
      </Animated.View>
    </View>
  )
}
