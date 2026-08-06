import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import { NAV } from '../../src/lib/vocabulary'
import Screen from '../../src/components/Screen'
import {
  checkEarlyCheckout,
  clockIn,
  clockOut,
  loadClockSettings,
  nearestLocation,
  STATUS_LABEL,
} from '../../src/lib/attendance'
import { Badge, Card, EmptyState, SectionTitle, SkeletonCard, StatTile, useTheme } from '../../src/components/ui'
import { localDateStr, longDate, timeOfDay } from '../../src/lib/format'
import { radius, space, type } from '../../src/theme'

const STATUS_COLOR = (c) => ({
  present: c.success,
  late_minor: c.warning,
  late_moderate: c.warning,
  late_major: c.danger,
  absent_approved: c.info,
  absent_unauthorized: c.danger,
})

export default function Attendance() {
  const { c } = useTheme()
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)
  const can = useAuthStore((s) => s.caps)

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
        .select(
          'id, clock_in, clock_out, status, clock_in_lat, clock_in_lng, clock_in_distance_m, early_minutes, work_locations!attendance_clock_in_location_id_fkey(name)'
        )
        .eq('employee_id', employee.id)
        .eq('date', localDateStr())
        .maybeSingle(),
      supabase
        .from('attendance')
        .select('id, date, clock_in, clock_out, status, overtime_hours, early_minutes')
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

  const isReadOnly = !can.clockInOut
  const clockedIn = !!today?.clock_in && !today?.clock_out
  const done = !!today?.clock_out

  // Set when the employee presses Clock Out before their day is scheduled to
  // finish. Holding it in state (rather than firing an Alert) keeps the flow
  // identical on device and in the browser preview, and gives somewhere to
  // type the reason that gets stored on the record.
  const [early, setEarly] = useState(null)
  const [earlyReason, setEarlyReason] = useState('')

  async function doClockOut(reason) {
    setBusy(true)
    setError('')
    const res = await clockOut({ recordId: today.id, settings, reason })
    if (res.error) setError(res.error)
    else await load()
    setEarly(null)
    setEarlyReason('')
    setBusy(false)
  }

  async function onPunch() {
    if (isReadOnly || !settings) return
    setError('')

    if (clockedIn) {
      setBusy(true)
      const shortfall = await checkEarlyCheckout({ employeeId: employee.id, settings })
      setBusy(false)
      if (shortfall) {
        setEarly(shortfall)
        return
      }
      await doClockOut(null)
      return
    }

    setBusy(true)
    const res = await clockIn({ employeeId: employee.id, companyId, settings })
    if (res.error) setError(res.error)
    else await load()
    setBusy(false)
  }

  const presentDays = month.filter((r) => r.status === 'present').length
  const lateDays = month.filter((r) => String(r.status).startsWith('late')).length
  const otHours = month.reduce((sum, r) => sum + Number(r.overtime_hours || 0), 0)

  const statusColors = STATUS_COLOR(c)

  // One line that says exactly what the location rule is for this person right
  // now — before the punch it's the requirement, after it's the measurement.
  const site = settings?.locations?.[0]
  const locationCaption = (() => {
    if (today?.clock_in_distance_m != null) {
      const where = today.work_locations?.name
      return where
        ? `Clocked in ${Math.round(today.clock_in_distance_m)} m from ${where}`
        : `Location recorded (${Math.round(today.clock_in_distance_m)} m from site)`
    }
    if (today?.clock_in_lat) return 'Location recorded'
    if (settings?.enforceGeofence && settings.locations.length) {
      return settings.locations.length === 1
        ? `Must be within ${site.radius_metres} m of ${site.name}`
        : `Must be at one of ${settings.locations.length} approved locations`
    }
    if (settings?.requireGps) return 'Location required to clock in'
    return 'Location optional'
  })()

  // 'Attendance (own)' is '-' for read_only: no own-attendance access at all,
  // so the screen says that rather than showing an inert clock face.
  if (!can.viewOwnAttendance) {
    return (
      <Screen title={NAV.attendance}>
        <EmptyState
          icon="!"
          title="No attendance record"
          body="Read-only accounts have no attendance of their own. An auditor who also needs to clock in requires a separate employee account."
        />
      </Screen>
    )
  }

  return (
    <Screen title={NAV.attendance} onRefresh={load}>
      <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>{longDate()}</Text>

      <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
        <Text style={{ fontSize: 40, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] }}>
          {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space(0.5) }}>
          <Ionicons
            name={settings?.requireGps || settings?.enforceGeofence ? 'location' : 'location-outline'}
            size={13}
            color={today?.clock_in_lat ? c.success : c.textFaint}
          />
          <Text style={{ ...type.caption, color: c.textMuted }}>{locationCaption}</Text>
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
            Read-only accounts cannot clock in or out.
          </Text>
        ) : null}

        {early ? (
          <View
            style={{
              marginTop: space(2),
              padding: space(2),
              borderRadius: radius.sm,
              backgroundColor: c.warning + '14',
              borderWidth: 1,
              borderColor: c.warning + '40',
              alignSelf: 'stretch',
              gap: space(1.5),
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
              <Ionicons name="alert-circle-outline" size={18} color={c.warning} />
              <Text style={{ ...type.label, color: c.warning }}>Leaving {early.label} early</Text>
            </View>
            <Text style={{ ...type.body, color: c.text }}>
              {early.fromShift ? 'Your shift' : 'Your working day'} ends at {early.endLabel}. Clocking out now
              records the day as {early.label} short.
            </Text>
            <TextInput
              value={earlyReason}
              onChangeText={setEarlyReason}
              placeholder="Reason (optional)"
              placeholderTextColor={c.textFaint}
              style={{
                ...type.body,
                color: c.text,
                borderWidth: 1,
                borderColor: c.border,
                borderRadius: radius.sm,
                paddingHorizontal: space(1.5),
                paddingVertical: space(1.25),
                backgroundColor: c.surface,
              }}
            />
            <View style={{ flexDirection: 'row', gap: space(1) }}>
              <Pressable
                onPress={() => {
                  setEarly(null)
                  setEarlyReason('')
                }}
                disabled={busy}
                style={{
                  flex: 1,
                  paddingVertical: space(1.25),
                  borderRadius: radius.sm,
                  borderWidth: 1,
                  borderColor: c.border,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...type.label, color: c.text }}>Stay clocked in</Text>
              </Pressable>
              <Pressable
                onPress={() => doClockOut(earlyReason)}
                disabled={busy}
                style={{
                  flex: 1,
                  paddingVertical: space(1.25),
                  borderRadius: radius.sm,
                  backgroundColor: c.warning,
                  alignItems: 'center',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={{ ...type.label, color: '#FFFFFF' }}>Clock out anyway</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {done && today?.early_minutes > 0 ? (
          <Text style={{ ...type.caption, color: c.warning, marginTop: space(1.5), textAlign: 'center' }}>
            Finished {today.early_minutes} min before the scheduled end
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
