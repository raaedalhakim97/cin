import { useCallback, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Pressable, TextInput, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../src/lib/supabase'
import useAuthStore from '../src/store/authStore'
import { approveRequest, rejectRequest, STATUS_META, typeLabel } from '../src/lib/leave'
import { STATUS_LABEL } from '../src/lib/attendance'
import { Avatar, Badge, Button, Card, EmptyState, SectionTitle, SkeletonCard, useTheme } from '../src/components/ui'
import { localDateStr, shortDate, timeOfDay } from '../src/lib/format'
import { radius, space, type } from '../src/theme'

export default function Approvals() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const can = useAuthStore((s) => s.caps)

  // "Leave — approve final" is F only for super_admin and hr_manager; a
  // department_manager has step one only (B).
  const isHR = can.approveLeaveFinal
  const isManager = can.approveLeaveStep1

  const [requests, setRequests] = useState([])
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [message, setMessage] = useState('')
  const [rejecting, setRejecting] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    // A department_manager sees 'pending' (step 1); HR also sees
    // 'manager_approved' waiting on final sign-off. RLS scopes rows to the
    // caller's own team, so no client-side department filter is needed.
    const statuses = isHR ? ['pending', 'manager_approved'] : ['pending']

    const [reqs, todayAttendance] = await Promise.all([
      supabase
        .from('leave_requests')
        .select('id, employee_id, leave_type, start_date, end_date, days_requested, status, reason, employees(full_name)')
        .in('status', statuses)
        .order('created_at', { ascending: true })
        .limit(50),
      supabase
        .from('attendance')
        .select('id, employee_id, clock_in, clock_out, status, employees(full_name)')
        .eq('date', localDateStr())
        .order('clock_in', { ascending: true })
        .limit(50),
    ])

    if (reqs.error) console.error('[Approvals] leave load failed', reqs.error)
    setRequests(reqs.data ?? [])
    setTeam(todayAttendance.data ?? [])
    setLoading(false)
  }, [isHR])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  async function onApprove(req) {
    setBusyId(req.id)
    setMessage('')
    const res = await approveRequest({ request: req, isHR })
    setBusyId(null)
    // The aa_leave_transition trigger throws on an invalid transition; its
    // message is the most accurate thing to show, so it's surfaced verbatim.
    if (res.error) setMessage(res.error)
    else {
      setMessage(res.status === 'manager_approved' ? 'Approved — sent to HR for final sign-off' : 'Approved')
      load()
    }
  }

  async function onReject() {
    if (!rejecting) return
    setBusyId(rejecting.id)
    setMessage('')
    const res = await rejectRequest({ request: rejecting, reason: rejectReason })
    setBusyId(null)
    setRejecting(null)
    setRejectReason('')
    if (res.error) setMessage(res.error)
    else {
      setMessage('Rejected — leave days returned to balance')
      load()
    }
  }

  if (!isManager) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top + space(2) }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: space(2) }}>
          <Ionicons name="chevron-back" size={24} color={c.text} />
        </Pressable>
        <EmptyState icon="!" title="Not available" body="Only managers and HR can review approvals." />
      </View>
    )
  }

  const presentCount = team.filter((t) => t.clock_in && !t.clock_out).length

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={{ padding: space(2), paddingTop: insets.top + space(2), paddingBottom: space(4) }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.mint} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1), marginBottom: space(0.5) }}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={24} color={c.text} />
          </Pressable>
          <Text style={{ ...type.h1, color: c.text }}>Approvals</Text>
        </View>
        <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>
          {isHR ? 'Final sign-off and step-one review' : 'Step-one review for your team'}
        </Text>

        {message ? (
          <View style={{ padding: space(1.5), borderRadius: radius.sm, backgroundColor: c.mint + '1A', marginBottom: space(1.5) }}>
            <Text style={{ ...type.body, color: c.mint }}>{message}</Text>
          </View>
        ) : null}

        <SectionTitle>Leave requests</SectionTitle>
        {loading ? (
          <SkeletonCard lines={3} />
        ) : requests.length === 0 ? (
          <EmptyState icon="—" title="Nothing waiting" body="Leave requests needing your review will show up here." />
        ) : (
          <View style={{ gap: space(1) }}>
            {requests.map((r) => {
              const meta = STATUS_META[r.status] ?? { label: r.status, tone: 'muted' }
              const busy = busyId === r.id
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                    <Avatar name={r.employees?.full_name} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }} numberOfLines={1}>
                        {r.employees?.full_name ?? 'Unknown'}
                      </Text>
                      <Text style={{ ...type.caption, color: c.textMuted }}>
                        {typeLabel(r.leave_type)} · {r.days_requested}{' '}
                        {Number(r.days_requested) === 1 ? 'day' : 'days'}
                      </Text>
                    </View>
                    <Badge
                      label={meta.label}
                      color={{ warning: c.warning, info: c.info, success: c.success, danger: c.danger, muted: c.textMuted }[meta.tone]}
                    />
                  </View>

                  <Text style={{ ...type.body, color: c.text, marginTop: space(1.5) }}>
                    {shortDate(r.start_date)} – {shortDate(r.end_date)}
                  </Text>
                  {r.reason ? (
                    <Text style={{ ...type.caption, color: c.textMuted, marginTop: 4 }}>{r.reason}</Text>
                  ) : null}

                  <View style={{ flexDirection: 'row', gap: space(1), marginTop: space(2) }}>
                    <Button
                      label={isHR || r.status === 'manager_approved' ? 'Approve' : 'Approve (step 1)'}
                      onPress={() => onApprove(r)}
                      loading={busy}
                      style={{ flex: 1 }}
                    />
                    <Button
                      label="Reject"
                      variant="danger"
                      onPress={() => {
                        setRejecting(r)
                        setRejectReason('')
                      }}
                      disabled={busy}
                      style={{ flex: 1 }}
                    />
                  </View>
                </Card>
              )
            })}
          </View>
        )}

        <SectionTitle>Team today</SectionTitle>
        {loading ? (
          <SkeletonCard lines={3} />
        ) : team.length === 0 ? (
          <EmptyState icon="—" title="No attendance yet" body="Your team's clock-ins for today will appear here." />
        ) : (
          <>
            <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(1) }}>
              {presentCount} currently clocked in · {team.length} record{team.length === 1 ? '' : 's'}
            </Text>
            <Card style={{ padding: 0 }}>
              {team.map((t, i) => (
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
          </>
        )}
      </ScrollView>

      <Modal visible={!!rejecting} transparent animationType="fade" onRequestClose={() => setRejecting(null)}>
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: space(3) }}>
          <Card>
            <Text style={{ ...type.h2, color: c.text }}>Reject request</Text>
            <Text style={{ ...type.body, color: c.textMuted, marginTop: space(0.5) }}>
              {rejecting?.employees?.full_name} · {typeLabel(rejecting?.leave_type)}
            </Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Reason (shown to the employee)"
              placeholderTextColor={c.textFaint}
              multiline
              style={{
                ...type.body,
                color: c.text,
                backgroundColor: c.surfaceAlt,
                borderRadius: radius.sm,
                padding: space(1.5),
                marginTop: space(1.5),
                minHeight: space(8),
                textAlignVertical: 'top',
              }}
            />
            <View style={{ flexDirection: 'row', gap: space(1), marginTop: space(2) }}>
              <Button label="Cancel" variant="secondary" onPress={() => setRejecting(null)} style={{ flex: 1 }} />
              <Button label="Reject" variant="danger" onPress={onReject} style={{ flex: 1 }} />
            </View>
          </Card>
        </View>
      </Modal>
    </>
  )
}
