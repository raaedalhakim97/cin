import { useCallback, useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import useModeStore from '../../src/store/modeStore'
import Screen from '../../src/components/Screen'
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Overline,
  QuickAction,
  SectionTitle,
  SkeletonCard,
  StatTile,
  useTheme,
} from '../../src/components/ui'
import { greeting, localDateStr, shortDate, timeOfDay } from '../../src/lib/format'
import { ratingColor, radius, space, type } from '../../src/theme'

export default function Home() {
  const { c } = useTheme()
  const router = useRouter()
  const employee = useAuthStore((s) => s.employee)
  const can = useAuthStore((s) => s.caps)
  const second = useAuthStore((s) => s.second)
  const mode = useModeStore((s) => s.mode)
  // Two possible second surfaces: 'manager' (approvals, team) for
  // super_admin/hr_manager/department_manager, and 'ops' (shifts, documents) for
  // admin. employee and read_only have neither.
  const managerView = mode === 'manager' && second === 'manager'
  const opsView = mode === 'ops' && second === 'ops'

  const [state, setState] = useState({ loading: true, error: false })
  const [attendance, setAttendance] = useState(null)
  const [leaveRemaining, setLeaveRemaining] = useState(null)
  const [kpi, setKpi] = useState(null)
  const [shift, setShift] = useState(null)
  const [posts, setPosts] = useState([])
  const [team, setTeam] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])

  const load = useCallback(async () => {
    if (!employee?.id) {
      setState({ loading: false, error: false })
      return
    }
    setState((s) => ({ ...s, error: false }))
    const today = localDateStr()
    const year = new Date().getFullYear()

    const [att, balances, kpiRows, shiftRow, feed] = await Promise.all([
      supabase.from('attendance').select('clock_in, clock_out, status').eq('employee_id', employee.id).eq('date', today).maybeSingle(),
      supabase.from('leave_balances').select('remaining_days').eq('employee_id', employee.id).eq('year', year),
      supabase
        .from('kpi_scores')
        .select('total_score, rating')
        .eq('employee_id', employee.id)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(1),
      supabase
        .from('today_schedule')
        .select('start_at, end_at, template_name')
        .eq('employee_id', employee.id)
        .order('start_at')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('feed_posts')
        .select('id, title, body, created_at, employees!feed_posts_author_employee_id_fkey(full_name)')
        .order('created_at', { ascending: false })
        .limit(2),
    ])

    if (att.error || balances.error || kpiRows.error) {
      console.error('[Home] load failed', att.error || balances.error || kpiRows.error)
      setState({ loading: false, error: true })
      return
    }

    setAttendance(att.data ?? null)
    setLeaveRemaining(
      balances.data?.length ? balances.data.reduce((sum, b) => sum + Number(b.remaining_days || 0), 0) : null
    )
    setKpi(kpiRows.data?.[0] ?? null)
    setShift(shiftRow.data ?? null)
    setPosts(feed.data ?? [])

    if (can.viewTeamAttendance) {
      const [todayTeam, reqs] = await Promise.all([
        supabase.from('attendance').select('id, employee_id, clock_in, clock_out, status, employees!attendance_employee_id_fkey(full_name)').eq('date', today).limit(30),
        // Only a role that can approve needs the queue; an ops coordinator
        // reads attendance to schedule around it but never approves leave.
        can.approveLeaveStep1
          ? supabase
              .from('leave_requests')
              .select('id, leave_type, days_requested, status, employees!leave_requests_employee_id_fkey(full_name)')
              .in('status', ['pending', 'manager_approved'])
              .limit(10)
          : Promise.resolve({ data: [] }),
      ])
      setTeam(todayTeam.data ?? [])
      setPendingRequests(reqs.data ?? [])
    }

    setState({ loading: false, error: false })
  }, [employee?.id, can.viewTeamAttendance, can.approveLeaveStep1])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const clockedIn = !!attendance?.clock_in && !attendance?.clock_out
  const done = !!attendance?.clock_out

  // Labels stay short enough to sit on one or two lines in a 96px tile — longer
  // ones wrap mid-word and read as broken.
  const QUICK_ACTIONS = (
    managerView
      ? [
          { icon: 'checkmark-done-outline', label: 'Approvals', to: '/approvals', tint: c.mint, show: can.approveLeaveStep1 },
          { icon: 'people-outline', label: 'Team today', to: '/approvals', tint: c.success, show: can.viewTeamAttendance },
          { icon: 'trending-up-outline', label: 'Team KPI', to: '/(tabs)/kpi', tint: c.warning, show: can.evaluateOthers },
          { icon: 'megaphone-outline', label: 'News', to: '/feed', tint: c.purple, show: true },
        ]
      : opsView
        ? [
            { icon: 'calendar-number-outline', label: 'Shifts', to: '/operations', tint: c.mint, show: can.manageShifts },
            { icon: 'folder-open-outline', label: 'Documents', to: '/operations', tint: c.info, show: can.manageDocuments },
            { icon: 'people-outline', label: 'Team today', to: '/operations', tint: c.success, show: can.viewTeamAttendance },
            { icon: 'megaphone-outline', label: 'News', to: '/feed', tint: c.purple, show: true },
          ]
        : [
            { icon: 'time-outline', label: clockedIn ? 'Clock out' : 'Clock in', to: '/(tabs)/attendance', tint: c.mint, show: can.clockInOut },
            { icon: 'umbrella-outline', label: 'Request leave', to: '/(tabs)/leave', tint: c.success, show: can.requestLeave },
            { icon: 'document-text-outline', label: 'My payslip', to: '/(tabs)/profile', tint: c.purple, show: can.viewOwnPayslip },
            { icon: 'trending-up-outline', label: 'My KPI', to: '/(tabs)/kpi', tint: c.warning, show: can.selfEvaluate },
            { icon: 'megaphone-outline', label: 'News', to: '/feed', tint: c.info, show: true },
          ]
  ).filter((a) => a.show)

  const presentCount = team.filter((t) => t.clock_in).length
  const lateCount = team.filter((t) => String(t.status).startsWith('late')).length

  return (
    <Screen title={managerView ? 'Team' : opsView ? 'Operations' : 'Home'} onRefresh={load}>
      {/* Quick actions — horizontally scrolling tiles, bleeding to the screen
          edge so it reads as a scrollable row rather than a clipped grid. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -space(2), marginBottom: space(1) }}
        contentContainerStyle={{ paddingHorizontal: space(2), gap: space(1) }}
      >
        {QUICK_ACTIONS.map((a) => (
          <QuickAction
            key={a.label}
            label={a.label}
            tint={a.tint}
            icon={<Ionicons name={a.icon} size={19} color={a.tint} />}
            onPress={() => router.push(a.to)}
          />
        ))}
      </ScrollView>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginTop: space(2) }}>
        <Avatar name={employee?.full_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.h2, color: c.text }} numberOfLines={1}>
            {greeting()}, {employee?.full_name?.split(' ')[0] ?? 'there'}
          </Text>
          <Text style={{ ...type.caption, color: c.textMuted }}>
            {managerView
              ? 'Manager view · your team'
              : opsView
                ? 'Operations view · scheduling and documents'
                : `Personal view · ${can.label}`}
          </Text>
        </View>
      </View>

      {state.loading ? (
        <View style={{ gap: space(1.5), marginTop: space(2) }}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </View>
      ) : state.error ? (
        <ErrorState onRetry={load} />
      ) : !employee?.id ? (
        <EmptyState
          icon="?"
          title="No employee record"
          body="Your account isn't linked to an employee profile yet. Ask HR to send you an invite."
        />
      ) : managerView ? (
        <>
          <SectionTitle>Today</SectionTitle>
          <View style={{ flexDirection: 'row', gap: space(1.5) }}>
            <StatTile value={presentCount} label="Clocked in" hint={`of ${team.length}`} color={c.success} />
            <StatTile value={lateCount} label="Late" color={lateCount ? c.warning : undefined} />
            <StatTile value={pendingRequests.length} label="To approve" color={pendingRequests.length ? c.cyan : undefined} />
          </View>

          <SectionTitle action="Review" onAction={() => router.push('/approvals')}>
            Waiting on you
          </SectionTitle>
          {pendingRequests.length === 0 ? (
            <Card>
              <Text style={{ ...type.body, color: c.textMuted }}>Nothing waiting. Your team is all clear.</Text>
            </Card>
          ) : (
            <Card style={{ padding: 0 }}>
              {pendingRequests.map((r, i) => (
                <View
                  key={r.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space(1.5),
                    padding: space(1.5),
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: c.border,
                  }}
                >
                  <Avatar name={r.employees?.full_name} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...type.body, color: c.text }} numberOfLines={1}>
                      {r.employees?.full_name ?? 'Unknown'}
                    </Text>
                    <Text style={{ ...type.caption, color: c.textMuted }}>
                      {r.leave_type} · {r.days_requested} {Number(r.days_requested) === 1 ? 'day' : 'days'}
                    </Text>
                  </View>
                  <Badge
                    label={r.status === 'manager_approved' ? 'Final' : 'Step 1'}
                    color={r.status === 'manager_approved' ? c.info : c.warning}
                  />
                </View>
              ))}
            </Card>
          )}
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space(1.5), marginTop: space(2) }}>
            <StatTile
              value={kpi?.total_score ? Math.round(kpi.total_score) : '—'}
              label="KPI score"
              hint={kpi?.rating ?? 'Not scored yet'}
              color={ratingColor[kpi?.rating] ?? c.text}
            />
            <StatTile value={leaveRemaining ?? '—'} label="Leave days" hint="Remaining" />
          </View>

          {/* Hidden entirely for a role with no own-attendance access — per
              §4.10, don't offer what RLS would reject. */}
          {can.viewOwnAttendance ? (
            <>
          <SectionTitle>Today</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(1) }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.label, color: done ? c.info : clockedIn ? c.success : c.textMuted }}>
                  {done
                    ? `Clocked out · ${timeOfDay(attendance.clock_out)}`
                    : clockedIn
                      ? `Clocked in · ${timeOfDay(attendance.clock_in)}`
                      : 'Not clocked in'}
                </Text>
                <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>
                  {shift
                    ? `${shift.template_name ?? 'Shift'} · ${timeOfDay(shift.start_at)}–${timeOfDay(shift.end_at)}`
                    : 'No shift scheduled'}
                </Text>
              </View>
              {!done && can.clockInOut ? (
                <Pressable
                  onPress={() => router.push('/(tabs)/attendance')}
                  style={{
                    paddingHorizontal: space(2),
                    paddingVertical: space(1.25),
                    borderRadius: radius.sm,
                    backgroundColor: c.mint,
                  }}
                >
                  <Text style={{ ...type.label, color: c.onMint }}>{clockedIn ? 'Clock out' : 'Clock in'}</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
            </>
          ) : null}
        </>
      )}

      <SectionTitle action="See all" onAction={() => router.push('/feed')}>
        Announcements
      </SectionTitle>
      {posts.length === 0 ? (
        <Card>
          <Text style={{ ...type.body, color: c.textMuted }}>No announcements yet.</Text>
        </Card>
      ) : (
        <View style={{ gap: space(1) }}>
          {posts.map((p) => (
            <Pressable key={p.id} onPress={() => router.push('/feed')}>
              <Card>
                <Overline>{p.employees?.full_name ?? 'HR'}</Overline>
                <Text style={{ ...type.label, color: c.text }} numberOfLines={2}>
                  {p.title || 'Untitled post'}
                </Text>
                <Text style={{ ...type.body, color: c.textMuted, marginTop: 4 }} numberOfLines={2}>
                  {p.body}
                </Text>
                <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1) }}>
                  {shortDate(p.created_at)}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  )
}
