import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/components/ui'
import { space } from '../../src/theme'
import { TAB } from '../../src/lib/vocabulary'

// Five tabs, hard cap — the design PDF's mobile-nav rule. The news feed and the
// manager approvals queue are reached from Home as stack routes rather than
// becoming tabs six and seven.
const TABS = [
  { name: 'index', title: TAB.home, icon: 'home-outline', activeIcon: 'home' },
  // 'Attend' rather than 'Work': the concept is Attendance everywhere else, and
  // five labels have to share 390px.
  { name: 'attendance', title: TAB.attendance, icon: 'time-outline', activeIcon: 'time' },
  { name: 'leave', title: TAB.leave, icon: 'umbrella-outline', activeIcon: 'umbrella' },
  { name: 'kpi', title: TAB.kpi, icon: 'trending-up-outline', activeIcon: 'trending-up' },
  { name: 'profile', title: TAB.profile, icon: 'person-outline', activeIcon: 'person' },
]

export default function TabsLayout() {
  const { c } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.cyan,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          borderTopWidth: 1,
          height: space(8),
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? t.activeIcon : t.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}
