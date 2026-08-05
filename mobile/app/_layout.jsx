import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import useAuthStore from '../src/store/authStore'
import { useTheme } from '../src/components/ui'

function Gate({ children }) {
  const loading = useAuthStore((s) => s.loading)
  const session = useAuthStore((s) => s.session)
  const router = useRouter()
  const segments = useSegments()
  const { c } = useTheme()

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === 'login'
    if (!session && !inAuthGroup) router.replace('/login')
    else if (session && inAuthGroup) router.replace('/')
  }, [loading, session, segments, router])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.mint} />
      </View>
    )
  }
  return children
}

export default function RootLayout() {
  const init = useAuthStore((s) => s.init)
  const { isDark } = useTheme()

  useEffect(() => {
    let sub
    init().then((s) => {
      sub = s
    })
    // Unsubscribe on unmount — the web app learned this the hard way; without it
    // every auth event fires loadProfile twice.
    return () => sub?.unsubscribe()
  }, [init])

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Gate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="feed" options={{ presentation: 'card' }} />
          <Stack.Screen name="approvals" options={{ presentation: 'card' }} />
        </Stack>
      </Gate>
    </SafeAreaProvider>
  )
}
