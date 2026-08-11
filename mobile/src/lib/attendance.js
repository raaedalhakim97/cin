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

// Haversine, metres. Mirrors public.distance_metres() in the database — the
// database is the authority (it re-measures and can reject), this copy exists
// so the screen can tell you you're too far *before* you press the button.
export function distanceMetres(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(a))
}

// Nearest active work location to a fix, with whether it's inside the radius.
// Returns null when the company hasn't defined any — a tenant with no
// locations is never fenced, on the client or in the trigger.
export function nearestLocation(coords, locations) {
  if (!coords || !locations?.length) return null
  let best = null
  for (const l of locations) {
    const d = distanceMetres(coords.latitude, coords.longitude, l.latitude, l.longitude)
    if (!best || d < best.distance) best = { location: l, distance: d, within: d <= l.radius_metres }
  }
  return best
}

export async function loadClockSettings(companyId) {
  const [shiftRes, kpiRes, companyRes, locRes] = await Promise.all([
    supabase
      .from('shift_settings')
      .select(
        'late_grace_minutes, require_shift_to_clock_in, require_gps_clock_in, enforce_geofence, early_checkout_grace_minutes'
      )
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('kpi_settings').select('late_grace_minutes').eq('company_id', companyId).maybeSingle(),
    supabase.from('company').select('work_start_time, work_end_time').eq('id', companyId).maybeSingle(),
    supabase
      .from('work_locations')
      .select('id, name, latitude, longitude, radius_metres')
      .eq('company_id', companyId)
      .eq('active', true),
  ])

  return {
    shiftLateGrace: shiftRes.data?.late_grace_minutes ?? 15,
    kpiLateGrace: kpiRes.data?.late_grace_minutes ?? 15,
    requireShift: !!shiftRes.data?.require_shift_to_clock_in,
    // Defaults to on, matching the web app — GPS-off is the deliberate opt-out.
    requireGps: shiftRes.data?.require_gps_clock_in ?? true,
    enforceGeofence: !!shiftRes.data?.enforce_geofence,
    earlyGrace: shiftRes.data?.early_checkout_grace_minutes ?? 5,
    workStart: companyRes.data?.work_start_time ?? '08:00',
    workEnd: companyRes.data?.work_end_time ?? '17:00',
    locations: locRes.data ?? [],
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
// (or the geofence, which cannot work without a fix) is on, a failed lookup
// blocks the punch; when off, we still try (so the screen can show a pin) but
// never block on it.
async function resolveCoords(settings) {
  const mustHave = settings.requireGps || (settings.enforceGeofence && settings.locations.length > 0)
  try {
    return { coords: await getPosition(), error: null }
  } catch (err) {
    if (mustHave) return { coords: null, error: err }
    return { coords: null, error: null }
  }
}

function gpsFailureMessage(err, verb) {
  return err.code === 'PERMISSION_DENIED'
    ? `Location permission is required to clock ${verb}. Enable it for BYOND HR in your device settings.`
    : "Couldn't get your location. Move somewhere with a clearer signal and try again."
}

// The trigger raises these as P0001 with text already written for the person
// reading it, so they're shown as-is rather than replaced with a generic line.
function dbMessage(error, fallback) {
  if (error?.message?.startsWith('Clock-in blocked:') || error?.message?.startsWith('Clock-out blocked:')) {
    return error.message
  }
  return fallback
}

// Today's published work shift, looked up the same way aa_autolink_shift does
// (same-day, work, published/completed, earliest start) so the status we send
// matches the shift the trigger will attach afterwards.
async function todayShiftFor(employeeId, date) {
  const { data } = await supabase
    .from('shifts')
    .select('id, start_at, end_at')
    .eq('employee_id', employeeId)
    .eq('shift_date', date)
    .eq('shift_type', 'work')
    .in('status', ['published', 'completed'])
    .order('start_at')
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// When is this person supposed to finish today? The linked shift's end_at if
// there is one, otherwise the company's fixed hours read in the phone's own
// timezone — which is the same instant the DB computes from company.timezone
// for anyone actually working in the country they're employed in.
export function scheduledEnd({ shift, settings, date = new Date() }) {
  if (shift?.end_at) return new Date(shift.end_at)
  const [h, m] = String(settings.workEnd).split(':').map(Number)
  if (Number.isNaN(h)) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m || 0, 0, 0)
}

// The early-checkout check the screen runs *before* writing anything, so the
// employee gets a question rather than a surprise. Returns null when they're
// finishing on time or late.
export async function checkEarlyCheckout({ employeeId, settings, now = new Date() }) {
  const shift = await todayShiftFor(employeeId, localDateStr(now))
  const end = scheduledEnd({ shift, settings, date: now })
  if (!end) return null

  const minutes = Math.ceil((end - now) / 60000)
  if (minutes <= settings.earlyGrace) return null

  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return {
    minutes,
    endsAt: end,
    label: hours > 0 ? `${hours}h ${rem}m` : `${rem}m`,
    endLabel: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    fromShift: !!shift?.end_at,
  }
}

export async function clockIn({ employeeId, companyId, settings }) {
  const { coords, error: gpsError } = await resolveCoords(settings)
  if (gpsError) return { error: gpsFailureMessage(gpsError, 'in') }

  const today = localDateStr()

  // Fence check before the round trip, so the message names the distance the
  // employee can actually act on. The trigger re-checks server-side.
  if (settings.enforceGeofence) {
    const near = nearestLocation(coords, settings.locations)
    if (near && !near.within) {
      return {
        error: `You're ${Math.round(near.distance)}m from ${near.location.name}. Clock-in is only accepted within ${near.location.radius_metres}m.`,
      }
    }
  }

  const todayShift = await todayShiftFor(employeeId, today)

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

  // clock_in and status are both sent, and the server overrides both for a
  // self-punch: attendance_guard stamps the time from its own clock and grades
  // the lateness itself (migration 14). Before that it stored whatever arrived,
  // so an edited client could clock in three hours late and record 'present'.
  //
  // They are still sent because the row is read back immediately after this
  // insert, and keeping the shapes identical means the optimistic value and the
  // stored one agree for every honest punch. Do not start relying on them: the
  // stored values are the server's, and if these two ever disagree with it, the
  // server is right.
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
    return { error: dbMessage(error, 'Something went wrong clocking in. Please try again.') }
  }
  return { error: null }
}

// `reason` is whatever the employee typed when they confirmed an early
// checkout; it is stored so the shortfall is explained in the record rather
// than only visible as a number on someone's report.
export async function clockOut({ recordId, settings, reason = null }) {
  const { coords, error: gpsError } = await resolveCoords(settings)
  if (gpsError) return { error: gpsFailureMessage(gpsError, 'out') }

  if (settings.enforceGeofence) {
    const near = nearestLocation(coords, settings.locations)
    if (near && !near.within) {
      return {
        error: `You're ${Math.round(near.distance)}m from ${near.location.name}. Clock-out is only accepted within ${near.location.radius_metres}m.`,
      }
    }
  }

  const { error } = await supabase
    .from('attendance')
    .update({
      clock_out: new Date().toISOString(),
      clock_out_lat: coords?.latitude ?? null,
      clock_out_lng: coords?.longitude ?? null,
      early_reason: reason?.trim() || null,
    })
    .eq('id', recordId)

  if (error) {
    console.error('[attendance] clockOut failed', error)
    return { error: dbMessage(error, 'Something went wrong clocking out. Please try again.') }
  }
  return { error: null }
}

// Keys match the attendance_status_check constraint exactly. 'absent' and
// 'on_leave' were in this map but are not values the column can hold — an
// approved leave day is stored as absent_approved by the attendance_guard
// trigger.
export const STATUS_LABEL = {
  present: 'Present',
  late_minor: 'Late — minor',
  late_moderate: 'Late — moderate',
  late_major: 'Late — major',
  absent_approved: 'Approved absence',
  absent_unauthorized: 'Unauthorised absence',
}
