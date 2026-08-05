import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/components/ui'

// Five tabs, hard cap — the design PDF's mobile-nav rule. The news feed and the
// manager approvals queue are reached from Home as stack routes rather than
// becoming tabs six and seven.
const TABS = [
  { name: 'index', title: 'Home', icon: 'home', activeIcon: 'home' },
  { name: 'attendance', title: 'Attend', icon: 'time-outline', activeIcon: 'time' },
  { name: 'leave', title: 'Leave', icon: 'calendar-outline', activeIcon: 'calendar' },
  { name: 'kpi', title: 'KPI', icon: 'trending-up-outline', activeIcon: 'trending-up' },
  { name: 'profile', title: 'Profile', icon: 'person-outline', activeIcon: 'person' },
]

export default function TabsLayout() {
  const { c } = useTheme()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.mint,
        tabBarInactiveTintColor: c.textFaint,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
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
