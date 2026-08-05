import * as Location from 'expo-location'
import supabase from './supabase'
import { localDateStr } from './format'

// Ported verbatim from the web's Attendance.jsx classifyClockIn. These status
// values feed calculate_attendance_score() in the DB, which averages per-day
// points into attendance_score — so getting the classification wrong here
// silently corrupts the automated KPI. present=100, late_minor=85,
// late_moderate=70, late_major=50.
export function classifyClockIn(now, expectedStart, graceMinutes) {
  const diffMin = (now - expectedStart) / 60000
  if (diffMin <= graceMinutes) return 'present'
  const lateMin = diffMin - graceMinutes
  if (lateMin <= 30) return 'late_minor'
  if (lateMin <= 60) return 'late_moderate'
  return 'late_major'
}

export async function loadClockSettings(companyId) {
  const [shiftRes, kpiRes, companyRes] = await Promise.all([
    supabase
      .from('shift_settings')
      .select('late_grace_minutes, require_shift_to_clock_in, require_gps_clock_in')
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('kpi_settings').select('late_grace_minutes').eq('company_id', companyId).maybeSingle(),
    supabase.from('company').select('work_start_time').eq('id', companyId).maybeSingle(),
  ])

  return {
    shiftLateGrace: shiftRes.data?.late_grace_minutes ?? 15,
    kpiLateGrace: kpiRes.data?.late_grace_minutes ?? 15,
    requireShift: !!shiftRes.data?.require_shift_to_clock_in,
    // Defaults to on, matching the web app — GPS-off is the deliberate opt-out.
    requireGps: shiftRes.data?.require_gps_clock_in ?? true,
    workStart: companyRes.data?.work_start_time ?? '08:00',
  }
}

// Native permission flow, which the web version can't do: ask explicitly, and
// distinguish "user said no" from "lookup failed" so the caller can explain.
async function getPosition() {
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') {
    const err = new Error('Location permission denied')
    err.code = 'PERMISSION_DENIED'
    throw err
  }
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
}

// GPS first, same required/optional split as the web: when require_gps_clock_in
// is on, a failed lookup blocks the punch; when off, we still try (so the screen
// can show a pin) but never block on it.
async function resolveCoords(requireGps) {
  try {
    return { coords: await getPosition(), error: null }
  } catch (err) {
    if (requireGps) return { coords: null, error: err }
    return { coords: null, error: null }
  }
}

export async function clockIn({ employeeId, companyId, settings }) {
  const { coords, error: gpsError } = await resolveCoords(settings.requireGps)
  if (gpsError) {
    return {
      error:
        gpsError.code === 'PERMISSION_DENIED'
          ? 'Location permission is required to clock in. Enable it for BYOND HR in your device settings.'
          : "Couldn't get your location. Move somewhere with a clearer signal and try again.",
    }
  }

  const today = localDateStr()

  // Read-only lookahead that mirrors the DB's aa_autolink_shift trigger
  // (same-day, work, published/completed, earliest start) so the status we send
  // matches the shift the trigger will attach afterwards.
  const { data: todayShift } = await supabase
    .from('shifts')
    .select('id, start_at')
    .eq('employee_id', employeeId)
    .eq('shift_date', today)
    .eq('shift_type', 'work')
    .in('status', ['published', 'completed'])
    .order('start_at')
    .limit(1)
    .maybeSingle()

  if (settings.requireShift && !todayShift) {
    return { error: 'You have no published shift today, and your company requires one to clock in.' }
  }

  const at = new Date()
  let expectedStart
  let grace
  if (todayShift) {
    expectedStart = new Date(todayShift.start_at)
    grace = settings.shiftLateGrace
  } else {
    const [h, m] = String(settings.workStart).split(':').map(Number)
    expectedStart = new Date(at.getFullYear(), at.getMonth(), at.getDate(), h || 0, m || 0, 0, 0)
    grace = settings.kpiLateGrace
  }

  const { error } = await supabase.from('attendance').insert({
    company_id: companyId,
    employee_id: employeeId,
    date: today,
    clock_in: at.toISOString(),
    status: classifyClockIn(at, expectedStart, grace),
    clock_in_lat: coords?.latitude ?? null,
    clock_in_lng: coords?.longitude ?? null,
  })

  if (error) {
    console.error('[attendance] clockIn failed', error)
    return { error: 'Something went wrong clocking in. Please try again.' }
  }
  return { error: null }
}

export async function clockOut({ recordId, settings }) {
  const { coords, error: gpsError } = await resolveCoords(settings.requireGps)
  if (gpsError) {
    return {
      error:
        gpsError.code === 'PERMISSION_DENIED'
          ? 'Location permission is required to clock out. Enable it for BYOND HR in your device settings.'
          : "Couldn't get your location. Move somewhere with a clearer signal and try again.",
    }
  }

  const { error } = await supabase
    .from('attendance')
    .update({
      clock_out: new Date().toISOString(),
      clock_out_lat: coords?.latitude ?? null,
      clock_out_lng: coords?.longitude ?? null,
    })
    .eq('id', recordId)

  if (error) {
    console.error('[attendance] clockOut failed', error)
    return { error: 'Something went wrong clocking out. Please try again.' }
  }
  return { error: null }
}

export const STATUS_LABEL = {
  present: 'Present',
  late_minor: 'Late — minor',
  late_moderate: 'Late — moderate',
  late_major: 'Late — major',
  absent: 'Absent',
  on_leave: 'On leave',
}
