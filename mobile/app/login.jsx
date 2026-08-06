import { useState } from 'react'
import { View, Text, TextInput, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import supabase, { isDemo } from '../src/lib/supabase'
import { demoPersonas } from '../src/lib/demo/client'
import { logLoginAttempt } from '../src/lib/sessionService'
import { Avatar, Badge, Button, Card, useTheme } from '../src/components/ui'
import { radius, space, type } from '../src/theme'

export default function Login() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(overrideEmail) {
    const trimmed = (overrideEmail ?? email).trim()
    // In demo mode any password is accepted — the persona is chosen by email.
    if (!trimmed || (!password && !isDemo)) {
      setError('Enter your email and password.')
      return
    }
    setBusy(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password: password || 'demo',
    })

    // Logged either way, matching the web app's audit behaviour (Art. 26.5).
    await logLoginAttempt(trimmed, !signInError)

    if (signInError) {
      setError(signInError.message)
      setBusy(false)
      return
    }
    // onAuthStateChange in authStore loads the profile; the root Gate redirects.
    setBusy(false)
  }

  const inputStyle = {
    ...type.body,
    color: c.text,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: space(2),
    paddingVertical: space(1.5),
    marginTop: space(0.5),
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: space(3),
          paddingTop: insets.top + space(3),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: space(4) }}>
          <Text style={{ ...type.display, color: c.text }}>
            BY<Text style={{ color: c.mint }}>O</Text>ND
          </Text>
          <Text style={{ ...type.body, color: c.textMuted, marginTop: space(0.5) }}>Sign in to BYOND HR</Text>
        </View>

        <Text style={{ ...type.label, color: c.text }}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@company.com"
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={inputStyle}
        />

        <Text style={{ ...type.label, color: c.text, marginTop: space(2) }}>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={c.textFaint}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          onSubmitEditing={onSubmit}
          style={inputStyle}
        />

        {error ? (
          <View
            style={{
              marginTop: space(2),
              padding: space(1.5),
              borderRadius: radius.sm,
              backgroundColor: c.danger + '1A',
              borderWidth: 1,
              borderColor: c.danger + '33',
            }}
          >
            <Text style={{ ...type.body, color: c.danger }}>{error}</Text>
          </View>
        ) : null}

        <Button label="Sign in" onPress={() => onSubmit()} loading={busy} style={{ marginTop: space(3) }} />

        {isDemo ? (
          <View style={{ marginTop: space(3) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginBottom: space(1) }}>
              <Badge label="DEMO MODE" color={c.warning} />
              <Text style={{ ...type.caption, color: c.textMuted, flex: 1 }}>
                In-memory data, no database. Tap an account.
              </Text>
            </View>

            {demoPersonas.map((p) => (
              <Pressable key={p.userId} onPress={() => onSubmit(p.email)} disabled={busy}>
                <Card style={{ marginTop: space(1) }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                    <Avatar name={p.label} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }}>{p.label}</Text>
                      <Text style={{ ...type.caption, color: c.textMuted }}>{p.sub}</Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={{ ...type.caption, color: c.textFaint, textAlign: 'center', marginTop: space(3) }}>
          BYOND by SERVA — HR Platform
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
