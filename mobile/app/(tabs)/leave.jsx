import { useCallback, useState } from 'react'
import { View, Text, ScrollView, TextInput, Pressable, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import supabase from '../../src/lib/supabase'
import useAuthStore from '../../src/store/authStore'
import Screen from '../../src/components/Screen'
import { LEAVE_TYPES, STATUS_META, dayCount, submitRequest, typeLabel } from '../../src/lib/leave'
import { Badge, Button, Card, EmptyState, SectionTitle, SkeletonCard, useTheme } from '../../src/components/ui'
import { localDateStr, shortDate } from '../../src/lib/format'
import { radius, space, type } from '../../src/theme'

function toneColor(c, tone) {
  return { warning: c.warning, info: c.info, success: c.success, danger: c.danger, muted: c.textMuted }[tone] ?? c.textMuted
}

export default function Leave() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const employee = useAuthStore((s) => s.employee)
  const companyId = useAuthStore((s) => s.companyId)
  const can = useAuthStore((s) => s.caps)

  const [balances, setBalances] = useState([])
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const [leaveType, setLeaveType] = useState('annual')
  const [startDate, setStartDate] = useState(localDateStr())
  const [endDate, setEndDate] = useState(localDateStr())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const canRequest = can.requestLeave

  const load = useCallback(async () => {
    if (!employee?.id) {
      setLoading(false)
      return
    }
    const year = new Date().getFullYear()
    const [bal, reqs] = await Promise.all([
      supabase
        .from('leave_balances')
        .select('id, leave_type, total_days, used_days, remaining_days')
        .eq('employee_id', employee.id)
        .eq('year', year),
      supabase
        .from('leave_requests')
        .select('id, leave_type, start_date, end_date, days_requested, status, reason, rejection_reason')
        .eq('employee_id', employee.id)
        .order('created_at', { ascending: false })
        .limit(25),
    ])
    setBalances(bal.data ?? [])
    setRequests(reqs.data ?? [])
    setLoading(false)
  }, [employee?.id])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

  const days = dayCount(startDate, endDate)

  async function onSubmit() {
    setSaving(true)
    setFormError('')
    const res = await submitRequest({
      employeeId: employee.id,
      companyId,
      leaveType,
      startDate,
      endDate,
      reason,
    })
    setSaving(false)
    if (res.error) {
      setFormError(res.error)
      return
    }
    setOpen(false)
    setReason('')
    load()
  }

  const dateInput = {
    ...type.body,
    color: c.text,
    backgroundColor: c.surfaceAlt,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    paddingHorizontal: space(1.5),
    paddingVertical: space(1),
    flex: 1,
  }

  if (!can.viewOwnLeave) {
    return (
      <Screen title="Leave">
        <EmptyState
          icon="!"
          title="No leave record"
          body="Read-only accounts cannot request or hold leave. An auditor who also needs to book leave requires a separate employee account."
        />
      </Screen>
    )
  }

  return (
    <>
      <Screen title="Leave" onRefresh={load}>
        <Text style={{ ...type.caption, color: c.textMuted, marginBottom: space(2) }}>
          Balance, requests and approval status
        </Text>

        {canRequest ? <Button label="+ Request leave" onPress={() => setOpen(true)} /> : null}

        <SectionTitle>My balance</SectionTitle>
        {loading ? (
          <SkeletonCard lines={3} />
        ) : balances.length === 0 ? (
          <Card>
            <Text style={{ ...type.body, color: c.textMuted }}>
              No balances set for this year yet. HR allocates these when your entitlement is configured.
            </Text>
          </Card>
        ) : (
          <View style={{ gap: space(1) }}>
            {balances.map((b) => {
              const total = Number(b.total_days || 0)
              const used = Number(b.used_days || 0)
              const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0
              return (
                <Card key={b.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ ...type.label, color: c.text }}>{typeLabel(b.leave_type)}</Text>
                    <Text style={{ ...type.body, color: c.mint, fontWeight: '700' }}>
                      {Number(b.remaining_days ?? total - used)} left
                    </Text>
                  </View>
                  <View style={{ height: 6, backgroundColor: c.surfaceAlt, borderRadius: 3, marginTop: space(1), overflow: 'hidden' }}>
                    <View style={{ width: `${pct}%`, height: '100%', backgroundColor: c.mint }} />
                  </View>
                  <Text style={{ ...type.caption, color: c.textMuted, marginTop: 6 }}>
                    {used} of {total} days used
                  </Text>
                </Card>
              )
            })}
          </View>
        )}

        <SectionTitle>My requests</SectionTitle>
        {loading ? (
          <SkeletonCard lines={3} />
        ) : requests.length === 0 ? (
          <EmptyState
            icon="—"
            title="No requests yet"
            body="Your leave requests and their approval progress will show up here."
            actionLabel={canRequest ? 'Request leave' : undefined}
            onAction={() => setOpen(true)}
          />
        ) : (
          <View style={{ gap: space(1) }}>
            {requests.map((r) => {
              const meta = STATUS_META[r.status] ?? { label: r.status, tone: 'muted' }
              return (
                <Card key={r.id}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: space(1) }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ ...type.label, color: c.text }}>{typeLabel(r.leave_type)}</Text>
                      <Text style={{ ...type.caption, color: c.textMuted, marginTop: 2 }}>
                        {shortDate(r.start_date)} – {shortDate(r.end_date)} · {r.days_requested}{' '}
                        {Number(r.days_requested) === 1 ? 'day' : 'days'}
                      </Text>
                    </View>
                    <Badge label={meta.label} color={toneColor(c, meta.tone)} />
                  </View>

                  {/* Employee → Manager → HR, per Art. 10.1 */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space(1.5) }}>
                    {[
                      { label: 'Submitted', done: true },
                      { label: 'Manager', done: r.status === 'manager_approved' || r.status === 'approved' },
                      { label: 'HR', done: r.status === 'approved' },
                    ].map((step, i) => (
                      <View key={step.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {i > 0 ? <View style={{ width: 14, height: 1, backgroundColor: c.border }} /> : null}
                        <Ionicons
                          name={step.done ? 'checkmark-circle' : 'ellipse-outline'}
                          size={14}
                          color={step.done ? c.success : c.textFaint}
                        />
                        <Text style={{ ...type.caption, color: step.done ? c.text : c.textFaint }}>{step.label}</Text>
                      </View>
                    ))}
                  </View>

                  {r.status === 'rejected' && r.rejection_reason ? (
                    <Text style={{ ...type.caption, color: c.danger, marginTop: space(1) }}>
                      Reason: {r.rejection_reason}
                    </Text>
                  ) : null}
                </Card>
              )
            })}
          </View>
        )}
      </Screen>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: c.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space(2), paddingBottom: insets.bottom + space(2) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) }}>
              <Text style={{ ...type.h2, color: c.text }}>New leave request</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={c.textMuted} />
              </Pressable>
            </View>

            <Text style={{ ...type.label, color: c.text, marginBottom: space(1) }}>Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {LEAVE_TYPES.map((t) => {
                const active = t.value === leaveType
                return (
                  <Pressable
                    key={t.value}
                    onPress={() => setLeaveType(t.value)}
                    style={{
                      paddingHorizontal: space(1.5),
                      paddingVertical: space(1),
                      borderRadius: radius.pill,
                      backgroundColor: active ? c.mint : c.surface,
                      borderWidth: 1,
                      borderColor: active ? c.mint : c.border,
                    }}
                  >
                    <Text style={{ ...type.caption, fontWeight: '700', color: active ? c.onMint : c.textMuted }}>
                      {t.label}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            <Text style={{ ...type.label, color: c.text, marginTop: space(2), marginBottom: space(1) }}>Dates</Text>
            <View style={{ flexDirection: 'row', gap: space(1), alignItems: 'center' }}>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={c.textFaint}
                style={dateInput}
              />
              <Text style={{ color: c.textMuted }}>→</Text>
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={c.textFaint}
                style={dateInput}
              />
            </View>
            <Text style={{ ...type.caption, color: days > 0 ? c.mint : c.textFaint, marginTop: 6 }}>
              {days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : 'Pick a valid range'}
            </Text>

            <Text style={{ ...type.label, color: c.text, marginTop: space(2), marginBottom: space(1) }}>Reason</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Family vacation"
              placeholderTextColor={c.textFaint}
              multiline
              style={{ ...dateInput, flex: undefined, minHeight: space(8), textAlignVertical: 'top', padding: space(1.5) }}
            />

            {formError ? (
              <Text style={{ ...type.caption, color: c.danger, marginTop: space(1) }}>{formError}</Text>
            ) : null}

            <Text style={{ ...type.caption, color: c.textFaint, marginTop: space(1.5) }}>
              Art. 7.2 — annual leave should be requested at least 7 days ahead.
            </Text>

            <Button
              label="Submit request"
              onPress={onSubmit}
              loading={saving}
              disabled={days <= 0}
              style={{ marginTop: space(2) }}
            />
          </View>
        </View>
      </Modal>
    </>
  )
}
