import { useCallback, useState } from 'react'
import { View, Text } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../src/lib/supabase'
import useAuthStore from '../src/store/authStore'
import { NAV } from '../src/lib/vocabulary'
import Screen from '../src/components/Screen'
import { STATUS_LABEL } from '../src/lib/attendance'
import { Avatar, Badge, Card, EmptyState, Overline, SectionTitle, SkeletonCard, StatTile, useTheme } from '../src/components/ui'
import { localDateStr, shortDate, timeOfDay } from '../src/lib/format'
import { radius, space, type } from '../src/theme'

// The Operations surface, for the `admin` role.
//
// §4.3 of the access-control standard is the whole design of this screen:
// "`admin` is operational, not managerial. They schedule shifts and coordinate
// documents. They do NOT approve leave, run payroll, score KPIs, or issue
// discipline. They can read attendance/leave to schedule around it, but never
// edit those records — the person who builds the schedule should never also be
// able to falsify the clock-in it produces."
//
// So attendance here is explicitly read-only, and there is no approve control
// anywhere on the screen.
export default function Operations() {
  const { c } = useTheme()
  const can = useAuthStore((s) => s.caps)

  const [shifts, setShifts] = useState([])
  const [team, setTeam] = useState([])
  const [docs, setDocs] = useState([])
  const [upcomingLeave, setUpcomingLeave] = useState([])
  const [openRecords, setOpenRecords] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const today = localDateStr()
    // 30 days back is enough to catch a forgotten clock-out inside the payroll
    // cycle it would otherwise be paid on.
    const from = localDateStr(new Date(Date.now() - 30 * 86400000))
    const [shiftRows, attendanceRows, docRows, leaveRows, openRows] = await Promise.all([
      supabase
        .from('shifts')
        .select('id, employee_id, shift_date, shift_type, status, start_at, end_at')
        // Day-off markers are also 'shifts'; they are not work to schedule around.
        .eq('shift_type', 'work')
        .gte('shift_date', today)
        .order('shift_date')
        .limit(30),
      supabase
        .from('attendance')
        .select('id, employee_id, clock_in, clock_out, status, employees!attendance_employee_id_fkey(full_name)')
        .eq('date', today)
        .limit(50),
      supabase
        .from('hr_documents_with_status')
        .select('id, employee_id, file_name, expiry_date, expiry_status')
        .in('expiry_status', ['expiring_soon', 'expiring_critical', 'expired'])
        .limit(20),
      // Read-only: knowing who is away is what makes a schedule workable.
      supabase
        .from('leave_requests')
        .select('id, leave_type, start_date, end_date, status, employees!leave_requests_employee_id_fkey(full_name)')
        .eq('status', 'approved')
        .gte('end_date', today)
        .order('start_date')
        .limit(15),
      // Clocked in on a past day and never clocked out. These read as normal
      // present days to the KPI and carry no hours to payroll, and nothing on
      // this screen used to show them.
      supabase
        .from('attendance')
        .select('id, date, clock_in, employees!attendance_employee_id_fkey(full_name)')
        .is('clock_out', null)
        .not('clock_in', 'is', null)
        .gte('date', from)
        .lt('date', today)
        .order('date', { ascending: false })
        .limit(25),
    ])

    setShifts(shiftRows.data ?? [])
    setTeam(attendanceRows.data ?? [])
    setDocs(docRows.data ?? [])
    setUpcomingLeave(leaveRows.data ?? [])
    setOpenRecords(openRows.data ?? [])
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  if (!can.manageShifts && !can.manageDocuments) {
    return (
      <Screen title={NAV.operations}>
        <EmptyState icon="!" title="Not available" body="Your role doesn't include shift or document coordination." />
      </Screen>
    )
  }

  const clockedIn = team.filter((t) => t.clock_in && !t.clock_out).length
  const published = shifts.filter((s) => s.status === 'published').length

  return (
    <Screen title={NAV.operations} onRefresh={load}>
      <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>
        Scheduling and document coordination
      </Text>

      <View style={{ flexDirection: 'row', gap: space(1.5) }}>
        <StatTile value={published} label="Shifts" hint="Published" />
        <StatTile value={clockedIn} label="On shift" hint={`of ${team.length}`} color={c.success} />
        <StatTile value={docs.length} label="Docs" hint="Need action" color={docs.length ? c.warning : undefined} />
      </View>

      {openRecords.length > 0 ? (
        <>
          <SectionTitle>Unclosed clock-ins</SectionTitle>
          <Card style={{ padding: 0, borderColor: c.warning + '55', borderWidth: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), padding: space(1.5) }}>
              <Ionicons name="alert-circle-outline" size={17} color={c.warning} />
              <Text style={{ ...type.caption, color: c.warning, flex: 1 }}>
                {openRecords.length} {openRecords.length === 1 ? 'day' : 'days'} in the last 30 with a clock-in and no
                clock-out. HR has to close these.
              </Text>
            </View>
            {openRecords.slice(0, 6).map((r) => (
              <View
                key={r.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space(1.5),
                  padding: space(1.5),
                  borderTopWidth: 1,
                  borderTopColor: c.border,
                }}
              >
                <Avatar name={r.employees?.full_name} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                    {r.employees?.full_name ?? 'Unknown'}
                  </Text>
                  <Text style={{ ...type.caption, color: c.textMuted }}>
                    {shortDate(r.date)} · in at {timeOfDay(r.clock_in)}, never out
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Upcoming shifts</SectionTitle>
      {loading ? (
        <SkeletonCard lines={3} />
      ) : shifts.length === 0 ? (
        <EmptyState icon="—" title="No shifts scheduled" body="Published shifts from today onwards will appear here." />
      ) : (
        <Card style={{ padding: 0 }}>
          {shifts.slice(0, 8).map((s, i) => (
            <View
              key={s.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(1.5),
                padding: space(1.5),
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              <Ionicons name="calendar-outline" size={19} color={c.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.body, color: c.text }}>
                  {new Date(s.shift_date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
                <Text style={{ ...type.caption, color: c.textMuted }}>
                  {s.start_at ? `${timeOfDay(s.start_at)}–${timeOfDay(s.end_at)}` : s.shift_type}
                </Text>
              </View>
              <Badge label={s.status} color={s.status === 'published' ? c.success : c.textMuted} />
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Away this period</SectionTitle>
      {loading ? (
        <SkeletonCard lines={2} />
      ) : upcomingLeave.length === 0 ? (
        <Card>
          <Text style={{ ...type.body, color: c.textMuted }}>Nobody is on approved leave right now.</Text>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {upcomingLeave.map((l, i) => (
            <View
              key={l.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space(1.5),
                padding: space(1.5),
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
              }}
            >
              <Avatar name={l.employees?.full_name} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                  {l.employees?.full_name ?? 'Unknown'}
                </Text>
                <Text style={{ ...type.caption, color: c.textMuted }}>
                  {shortDate(l.start_date)} – {shortDate(l.end_date)} · {l.leave_type}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle>Team today</SectionTitle>
      {loading ? (
        <SkeletonCard lines={3} />
      ) : team.length === 0 ? (
        <EmptyState icon="—" title="No attendance yet" body="Today's clock-ins will appear here." />
      ) : (
        <>
          <Card style={{ padding: 0 }}>
            {team.slice(0, 8).map((t, i) => (
              <View
                key={t.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space(1.5),
                  padding: space(1.5),
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                }}
              >
                <Avatar name={t.employees?.full_name} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                    {t.employees?.full_name ?? 'Unknown'}
                  </Text>
                  <Text style={{ ...type.caption, color: c.textMuted }}>
                    {t.clock_in ? `${timeOfDay(t.clock_in)} – ${t.clock_out ? timeOfDay(t.clock_out) : '…'}` : '—'}
                  </Text>
                </View>
                <Badge
                  label={STATUS_LABEL[t.status] ?? t.status}
                  color={String(t.status).startsWith('late') ? c.warning : t.status === 'present' ? c.success : c.textMuted}
                />
              </View>
            ))}
          </Card>
          <View style={{ marginTop: space(1), padding: space(1.5), borderRadius: radius.sm, backgroundColor: c.surfaceAlt }}>
            <Text style={{ ...type.caption, color: c.textMuted }}>
              View only. Whoever builds the schedule cannot edit the clock-ins it produces.
            </Text>
          </View>
        </>
      )}

      {can.manageDocuments ? (
        <>
          <SectionTitle>Documents needing action</SectionTitle>
          {loading ? (
            <SkeletonCard lines={2} />
          ) : docs.length === 0 ? (
            <Card>
              <Text style={{ ...type.body, color: c.textMuted }}>Nothing expiring. All documents are current.</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0 }}>
              {docs.map((d, i) => (
                <View
                  key={d.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(1.5),
                    padding: space(1.5),
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                  }}
                >
                  <Ionicons name="document-text-outline" size={19} color={c.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                      {d.file_name ?? 'Document'}
                    </Text>
                    {d.expiry_date ? (
                      <Text style={{ ...type.caption, color: c.textMuted }}>Expires {shortDate(d.expiry_date)}</Text>
                    ) : null}
                  </View>
                  <Badge
                    label={d.expiry_status === 'expiring_soon' ? 'Soon' : 'Urgent'}
                    color={d.expiry_status === 'expiring_soon' ? c.warning : c.danger}
                  />
                </View>
              ))}
            </Card>
          )}
        </>
      ) : null}

      <View style={{ marginTop: space(3) }}>
        <Overline>Not in this role</Overline>
        <Card>
          <Text style={{ ...type.caption, color: c.textMuted }}>
            Operations does not include approving leave, running payroll, scoring KPIs, or issuing warnings. Those sit
            with HR and the company owner.
          </Text>
        </Card>
      </View>
    </Screen>
  )
}
