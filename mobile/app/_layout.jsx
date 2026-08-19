import { useEffect } from 'react'
import { View, ActivityIndicator } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import useAuthStore from '../src/store/authStore'
import useThemeStore from '../src/store/themeStore'
import AppDrawer from '../src/components/AppDrawer'
import { DURATION, useReducedMotion } from '../src/lib/motion'
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
  const isDark = useThemeStore((s) => s.isDark)
  const reduceMotion = useReducedMotion()

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
      {/* The status bar sits on the chrome, and the chrome now follows the
          theme to match the web. So this has to follow it too: it was pinned
          to "light", which was correct while the bar was always dark and would
          otherwise paint white text onto the white light-mode bar. */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Gate>
        <Stack
          screenOptions={{
            headerShown: false,
            // Pushed screens slide in from the right and back out the same way,
            // so forward and back read as opposite directions.
            animation: reduceMotion ? 'none' : 'slide_from_right',
            animationDuration: DURATION.slow,
          }}
        >
          {/* The tab host and login are roots, not pushes — sliding them would
              imply a back destination that isn't there. */}
          <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
          <Stack.Screen name="login" options={{ animation: reduceMotion ? 'none' : 'fade' }} />
          <Stack.Screen name="feed" options={{ presentation: 'card' }} />
          <Stack.Screen name="notifications" options={{ presentation: 'card' }} />
          <Stack.Screen name="approvals" options={{ presentation: 'card' }} />
          <Stack.Screen name="settings" options={{ presentation: 'card' }} />
          <Stack.Screen name="operations" options={{ presentation: 'card' }} />
          <Stack.Screen name="access" options={{ presentation: 'card' }} />
        </Stack>
        {/* One drawer for the whole app, above the stack so it overlays any
            screen. Its open state is in uiStore. */}
        <AppDrawer />
      </Gate>
    </SafeAreaProvider>
  )
}
