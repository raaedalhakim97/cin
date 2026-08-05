import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import useAuthStore from '../src/store/authStore'
import useThemeStore from '../src/store/themeStore'
import AppDrawer from '../src/components/AppDrawer'
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
  const hydrateTheme = useThemeStore((s) => s.hydrate)

  useEffect(() => {
    let sub
    init().then((s) => {
      sub = s
    })
    // Unsubscribe on unmount — the web app learned this the hard way; without it
    // every auth event fires loadProfile twice.
    return () => sub?.unsubscribe()
  }, [init])

  // Restores the saved light/dark choice from storage.
  useEffect(() => {
    hydrateTheme()
  }, [hydrateTheme])

  return (
    <SafeAreaProvider>
      {/* The top bar is dark in both themes, so the status bar text is always
          light — it sits on the chrome, not on the content surface. */}
      <StatusBar style="light" />
      <Gate>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="feed" options={{ presentation: 'card' }} />
          <Stack.Screen name="approvals" options={{ presentation: 'card' }} />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
          <Stack.Screen name="operations" options={{ presentation: 'card' }} />
        </Stack>
        {/* One drawer for the whole app, above the stack so it overlays any
            screen. Its open state is in uiStore. */}
        <AppDrawer />
      </Gate>
    </SafeAreaProvider>
  )
}
