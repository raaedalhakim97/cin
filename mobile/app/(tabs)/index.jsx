import { useCallback, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import { Avatar, Card, Badge, EmptyState, ErrorState, SectionTitle, SkeletonCard, StatTile, useTheme } from '../../src/components/ui'
import { greeting, localDateStr, longDate, shortDate, timeOfDay } from '../../src/lib/format'
import { ratingColor, radius, space, type } from '../../src/theme'

export default function Home() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const employee = useAuthStore((s) => s.employee)
  const isManager = useAuthStore((s) => s.isManager())

  const [state, setState] = useState({ loading: true, error: false })
  const [attendance, setAttendance] = useState(null)
  const [leaveRemaining, setLeaveRemaining] = useState(null)
  const [kpi, setKpi] = useState(null)
  const [shift, setShift] = useState(null)
  const [latestPost, setLatestPost] = useState(null)
  const [pendingApprovals, setPendingApprovals] = useState(0)

  // Mirrors the web EmployeeDashboard's fan-out: every query keyed off
  // employee.id, all in flight at once.
  const load = useCallback(async () => {
    if (!employee?.id) {
      setState({ loading: false, error: false })
      return
    }
    setState((s) => ({ ...s, error: false }))
    const today = localDateStr()
    const year = new Date().getFullYear()

    const [att, balances, kpiRows, shiftRow, post] = await Promise.all([
      supabase.from('attendance').select('clock_in, clock_out, status').eq('employee_id', employee.id).eq('date', today).maybeSingle(),
      supabase.from('leave_balances').select('remaining_days').eq('employee_id', employee.id).eq('year', year),
      supabase
        .from('kpi_scores')
        .select('total_score, rating, period_year, period_month')
        .eq('employee_id', employee.id)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
        .limit(1),
      supabase
        .from('today_schedule')
        .select('start_at, end_at, template_name, shift_type')
        .eq('employee_id', employee.id)
        .order('start_at')
        .limit(1)
        .maybeSingle(),
      supabase
        .from('feed_posts')
        .select('id, title, body, created_at, employees(full_name)')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const failed = att.error || balances.error || kpiRows.error
    if (failed) {
      console.error('[Home] load failed', failed)
      setState({ loading: false, error: true })
      return
    }

    setAttendance(att.data ?? null)
    setLeaveRemaining(
      balances.data?.length ? balances.data.reduce((sum, b) => sum + Number(b.remaining_days || 0), 0) : null
    )
    setKpi(kpiRows.data?.[0] ?? null)
    setShift(shiftRow.data ?? null)
    setLatestPost(post.data ?? null)

    if (isManager) {
      const { count } = await supabase
        .from('leave_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      setPendingApprovals(count ?? 0)
    }

    setState({ loading: false, error: false })
  }, [employee?.id, isManager])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const clockStatus = !attendance?.clock_in
    ? { label: 'Not clocked in', color: c.textMuted }
    : attendance.clock_out
      ? { label: `Clocked out · ${timeOfDay(attendance.clock_out)}`, color: c.info }
      : { label: `Clocked in · ${timeOfDay(attendance.clock_in)}`, color: c.success }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentContainerStyle={{ padding: space(2), paddingTop: insets.top + space(2), paddingBottom: space(4) }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.mint} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginBottom: space(2) }}>
        <Avatar name={employee?.full_name} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...type.h1, color: c.text }} numberOfLines={1}>
            {greeting()}, {employee?.full_name?.split(' ')[0] ?? 'there'}
          </Text>
          <Text style={{ ...type.caption, color: c.textMuted }}>{longDate()}</Text>
        </View>
      </View>

      {state.loading ? (
        <View style={{ gap: space(1.5) }}>
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
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: space(1.5) }}>
            <StatTile
              value={kpi?.total_score ? Math.round(kpi.total_score) : '—'}
              label="KPI score"
              hint={kpi?.rating ?? 'Not scored yet'}
              color={ratingColor[kpi?.rating] ?? c.text}
            />
            <StatTile value={leaveRemaining ?? '—'} label="Leave days" hint="Remaining" />
          </View>

          <SectionTitle>Today</SectionTitle>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...type.label, color: clockStatus.color }}>{clockStatus.label}</Text>
                <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>
                  {shift
                    ? `${shift.template_name ?? 'Shift'} · ${timeOfDay(shift.start_at)}–${timeOfDay(shift.end_at)}`
                    : 'No shift scheduled'}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push('/attendance')}
                style={{
                  paddingHorizontal: space(2),
                  paddingVertical: space(1),
                  borderRadius: radius.sm,
                  backgroundColor: c.mint,
                }}
              >
                <Text style={{ ...type.label, color: c.onMint }}>
                  {attendance?.clock_in && !attendance?.clock_out ? 'Clock out' : 'Clock in'}
                </Text>
              </Pressable>
            </View>
          </Card>

          {isManager ? (
            <>
              <SectionTitle>Manager</SectionTitle>
              <Pressable onPress={() => router.push('/approvals')}>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                    <Ionicons name="checkmark-done-outline" size={22} color={c.mint} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }}>Leave approvals</Text>
                      <Text style={{ ...type.caption, color: c.textMuted }}>
                        {pendingApprovals > 0
                          ? `${pendingApprovals} request${pendingApprovals === 1 ? '' : 's'} waiting`
                          : 'Nothing waiting'}
                      </Text>
                    </View>
                    {pendingApprovals > 0 ? <Badge label={String(pendingApprovals)} color={c.warning} /> : null}
                    <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
                  </View>
                </Card>
              </Pressable>
            </>
          ) : null}

          <SectionTitle action="See all" onAction={() => router.push('/feed')}>
            Announcements
          </SectionTitle>
          {latestPost ? (
            <Pressable onPress={() => router.push('/feed')}>
              <Card>
                <Text style={{ ...type.label, color: c.text }} numberOfLines={2}>
                  {latestPost.title || 'Untitled post'}
                </Text>
                <Text style={{ ...type.body, color: c.textMuted, marginTop: 4 }} numberOfLines={2}>
                  {latestPost.body}
                </Text>
                <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1) }}>
                  {latestPost.employees?.full_name ?? 'HR'} · {shortDate(latestPost.created_at)}
                </Text>
              </Card>
            </Pressable>
          ) : (
            <Card>
              <Text style={{ ...type.body, color: c.textMuted }}>No announcements yet.</Text>
            </Card>
          )}
        </>
      )}
    </ScrollView>
  )
}
