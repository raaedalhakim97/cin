import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/components/ui'
import { space } from '../../src/theme'

// Five tabs, hard cap — the design PDF's mobile-nav rule. The news feed and the
// manager approvals queue are reached from Home as stack routes rather than
// becoming tabs six and seven.
const TABS = [
  { name: 'index', title: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'attendance', title: 'Work', icon: 'briefcase-outline', activeIcon: 'briefcase' },
  { name: 'leave', title: 'Leave', icon: 'umbrella-outline', activeIcon: 'umbrella' },
  // Kept short so it doesn't truncate at 390px — the screen and drawer both
  // still call this module Performance.
  { name: 'kpi', title: 'KPI', icon: 'trending-up-outline', activeIcon: 'trending-up' },
  { name: 'profile', title: 'Profile', icon: 'person-outline', activeIcon: 'person' },
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
