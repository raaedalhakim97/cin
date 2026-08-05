import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import Screen from '../../src/components/Screen'
import { clockIn, clockOut, loadClockSettings, STATUS_LABEL } from '../../src/lib/attendance'
import { Badge, Card, EmptyState, SectionTitle, SkeletonCard, StatTile, useTheme } from '../../src/components/ui'
import { localDateStr, longDate, timeOfDay } from '../../src/lib/format'
import { radius, space, type } from '../../src/theme'

const STATUS_COLOR = (c) => ({
  present: c.success,
  late_minor: c.warning,
  late_moderate: c.warning,
  late_major: c.danger,
  absent: c.danger,
  on_leave: c.info,
})

export default function Attendance() {
  const { c } = useTheme()
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)
  const role = useAuthStore((s) => s.role)

  const [settings, setSettings] = useState(null)
  const [today, setToday] = useState(null)
  const [month, setMonth] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(new Date())

  // Live clock, matching the design PDF's mobile attendance screen.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!companyId) return
    loadClockSettings(companyId).then(setSettings)
  }, [companyId])

  const load = useCallback(async () => {
    if (!employee?.id) {
      setLoading(false)
      return
    }
    const first = new Date()
    first.setDate(1)
    const [todayRes, monthRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('id, clock_in, clock_out, status, clock_in_lat, clock_in_lng')
        .eq('employee_id', employee.id)
        .eq('date', localDateStr())
        .maybeSingle(),
      supabase
        .from('attendance')
        .select('id, date, clock_in, clock_out, status, overtime_hours')
        .eq('employee_id', employee.id)
        .gte('date', localDateStr(first))
        .lte('date', localDateStr())
        .order('date', { ascending: false }),
    ])
    setToday(todayRes.data ?? null)
    setMonth(monthRes.data ?? [])
    setLoading(false)
  }, [employee?.id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const isReadOnly = role === 'read_only'
  const clockedIn = !!today?.clock_in && !today?.clock_out
  const done = !!today?.clock_out

  async function onPunch() {
    if (isReadOnly || !settings) return
    setBusy(true)
    setError('')
    const res = clockedIn
      ? await clockOut({ recordId: today.id, settings })
      : await clockIn({ employeeId: employee.id, companyId, settings })
    if (res.error) setError(res.error)
    else await load()
    setBusy(false)
  }

  const presentDays = month.filter((r) => r.status === 'present').length
  const lateDays = month.filter((r) => String(r.status).startsWith('late')).length
  const otHours = month.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0)

  const statusColors = STATUS_COLOR(c)

  return (
    <Screen title="Attendance" onRefresh={load}>
      <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>{longDate()}</Text>

      <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
        <Text style={{ fontSize: 40, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>
          {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space(0.5) }}>
          <Ionicons
            name={settings?.requireGps ? 'location' : 'location-outline'}
            size={13}
            color={today?.clock_in_lat ? c.success : c.textFaint}
          />
          <Text style={{ ...type.caption, color: c.textMuted }}>
            {today?.clock_in_lat
              ? 'Location verified'
              : settings?.requireGps
                ? 'Location required to clock in'
                : 'Location optional'}
          </Text>
        </View>

        <Pressable
          onPress={onPunch}
          disabled={busy || done || isReadOnly || !settings}
          style={({ pressed }) => ({
            marginTop: space(3),
            width: 168,
            height: 168,
            borderRadius: 84,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: done ? c.surfaceAlt : clockedIn ? c.danger : c.mint,
            opacity: busy || done || isReadOnly || !settings ? 0.6 : pressed ? 0.9 : 1,
          })}
        >
          <Ionicons
            name={done ? 'checkmark-done' : clockedIn ? 'log-out-outline' : 'log-in-outline'}
            size={40}
            color={done ? c.textMuted : clockedIn ? '#FFFFFF' : c.onMint}
          />
          <Text
            style={{
              ...type.h2,
              marginTop: space(1),
              color: done ? c.textMuted : clockedIn ? '#FFFFFF' : c.onMint,
            }}
          >
            {done ? 'ALL DONE' : clockedIn ? 'CLOCK OUT' : 'CLOCK IN'}
          </Text>
        </Pressable>

        <Text style={{ ...type.body, color: c.textMuted, marginTop: space(2) }}>
          {done
            ? `${timeOfDay(today.clock_in)} – ${timeOfDay(today.clock_out)}`
            : clockedIn
              ? `Clocked in at ${timeOfDay(today.clock_in)}`
              : 'Not clocked in'}
        </Text>
        {today?.status ? (
          <View style={{ marginTop: space(1) }}>
            <Badge label={STATUS_LABEL[today.status] ?? today.status} color={statusColors[today.status] ?? c.textMuted} />
          </View>
        ) : null}

        {isReadOnly ? (
          <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1.5), textAlign: 'center' }}>
            Your role can view attendance but not clock in.
          </Text>
        ) : null}

        {error ? (
          <View
            style={{
              marginTop: space(2),
              padding: space(1.5),
              borderRadius: radius.sm,
              backgroundColor: c.danger + '1A',
              alignSelf: 'stretch',
            }}
          >
            <Text style={{ ...type.body, color: c.danger }}>{error}</Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>This month</SectionTitle>
      <View style={{ flexDirection: 'row', gap: space(1.5) }}>
        <StatTile value={presentDays} label="Present" />
        <StatTile value={lateDays} label="Late" color={lateDays ? c.warning : undefined} />
        <StatTile value={`${otHours.toFixed(1)}h`} label="Overtime" />
      </View>

      <SectionTitle>History</SectionTitle>
      {loading ? (
        <SkeletonCard lines={4} />
      ) : month.length === 0 ? (
        <EmptyState icon="—" title="No records yet" body="Your attendance for this month will appear here once you clock in." />
      ) : (
        <Card style={{ padding: 0 }}>
          {month.map((r, i) => (
            <View
              key={r.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: space(1.5),
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              <View>
                <Text style={{ ...type.label, color: c.text }}>
                  {new Date(r.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
                <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>
                  {r.clock_in ? `${timeOfDay(r.clock_in)} – ${r.clock_out ? timeOfDay(r.clock_out) : '…'}` : '—'}
                </Text>
              </View>
              <Badge label={STATUS_LABEL[r.status] ?? r.status} color={statusColors[r.status] ?? c.textMuted} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  )
}
