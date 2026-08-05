import { View, Text, Pressable } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import useAuthStore from '../src/store/authStore'
import useThemeStore from '../src/store/themeStore'
import useModeStore from '../src/store/modeStore'
import Screen from '../src/components/Screen'
import { Card, Overline, Row, useTheme } from '../src/components/ui'
import { isDemo } from '../src/lib/supabase'
import { radius, space, type } from '../src/theme'

const THEMES = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
]

export default function Settings() {
  const { c } = useTheme()
  const router = useRouter()
  const preference = useThemeStore((s) => s.preference)
  const setPreference = useThemeStore((s) => s.setPreference)
  const employee = useAuthStore((s) => s.employee)
  const company = useAuthStore((s) => s.company)
  const role = useAuthStore((s) => s.role)
  const isManager = useAuthStore((s) => s.isManager())
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)

  return (
    <Screen title="Settings">
      <Overline>Appearance</Overline>
      <Card>
        <Text style={{ ...type.body, color: c.textMuted, marginBottom: space(1.5) }}>
          Choose how the app looks. System follows your phone's setting.
        </Text>
        <View style={{ flexDirection: 'row', gap: space(1) }}>
          {THEMES.map((t) => {
            const active = preference === t.key
            return (
              <Pressable
                key={t.key}
                onPress={() => setPreference(t.key)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: space(0.75),
                  paddingVertical: space(1.5),
                  borderRadius: radius.sm,
                  borderWidth: active ? 2 : 1,
                  borderColor: active ? c.cyan : c.border,
                  backgroundColor: active ? c.accentSoft : 'transparent',
                }}
              >
                <Ionicons name={t.icon} size={20} color={active ? c.cyan : c.textMuted} />
                <Text style={{ ...type.label, color: active ? c.cyan : c.textMuted }}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
      </Card>

      {isManager ? (
        <>
          <View style={{ height: space(3) }} />
          <Overline>View</Overline>
          <Card>
            <Text style={{ ...type.body, color: c.textMuted, marginBottom: space(1.5) }}>
              Personal shows only your own record. Manager adds your team's attendance and the approvals queue.
            </Text>
            <View style={{ flexDirection: 'row', padding: 4, borderRadius: radius.pill, backgroundColor: c.surfaceAlt }}>
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
                      alignItems: 'center',
                      backgroundColor: active ? c.cyan : 'transparent',
                    }}
                  >
                    <Text style={{ ...type.label, color: active ? c.onCyan : c.textMuted }}>
                      {m === 'personal' ? 'Personal' : 'Manager'}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </Card>
        </>
      ) : null}

      <View style={{ height: space(3) }} />
      <Overline>Account</Overline>
      <Card>
        <Row label="Name" value={employee?.full_name} />
        <Row label="Role" value={role} />
        <Row label="Company" value={company?.name} />
        <Row label="Currency" value={company?.currency} />
        {isDemo ? <Row label="Data source" value="Demo (in-memory)" valueColor={c.warning} /> : null}
      </Card>

      {isDemo ? (
        <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(2) }}>
          Running on demo data. Nothing you change here is saved to a database, and a reload resets everything.
        </Text>
      ) : null}

      <Pressable onPress={() => router.back()} style={{ marginTop: space(3), alignSelf: 'center' }}>
        <Text style={{ ...type.label, color: c.cyan }}>Back</Text>
      </Pressable>
    </Screen>
  )
}
