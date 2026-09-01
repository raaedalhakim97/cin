// The five levels, in one place, mirroring the database's kpi_level_points().
//
// The points are fixed platform-wide on purpose (migration 40): if one company can make
// "Meets" worth 90 and another 55, no two scores mean the same thing. A company expresses
// what it cares about through the weights, not by moving the scale. So this file is a
// mirror of a database function, not a configuration — if it ever disagrees with
// kpi_level_points, the database is right.

export const LEVELS = [
  { level: 1, label: 'Poor',                short: 'Poor',    points: 20,
    hex: '#FF4D4D', note: 'Well below what the role needs.' },
  { level: 2, label: 'Below expectations',  short: 'Below',   points: 40,
    hex: '#FF8C42', note: 'Falls short in a way that needs fixing.' },
  { level: 3, label: 'Meets expectations',  short: 'Meets',   points: 60,
    hex: '#4D9FFF', note: 'The standard the role is held to.' },
  { level: 4, label: 'Exceeds expectations', short: 'Exceeds', points: 80,
    hex: '#00D4A0', note: 'Consistently better than the standard.' },
  { level: 5, label: 'Outstanding',         short: 'Outstanding', points: 100,
    hex: '#A78BFA', note: 'The example others are pointed at.' },
]

export const LEVEL_BY_NUMBER = Object.fromEntries(LEVELS.map((l) => [l.level, l]))

export function levelLabel(level) {
  return LEVEL_BY_NUMBER[level]?.label ?? 'Not rated'
}

export function levelHex(level) {
  return LEVEL_BY_NUMBER[level]?.hex ?? '#A0A0A0'
}

export function levelPoints(level) {
  return LEVEL_BY_NUMBER[level]?.points ?? null
}

// The categories and metrics the database will accept. Both are CHECK constraints on
// kpi_definitions, so anything not listed here is rejected by Postgres — this list exists
// so the form offers the same set rather than letting someone discover it by getting a
// constraint violation.
export const CATEGORIES = [
  'general', 'quality', 'productivity', 'behaviour',
  'attendance', 'leadership', 'sales', 'safety',
]

export const METRICS = [
  { id: 'attendance_pct',    label: 'Attendance %',      note: 'Share of scheduled days actually attended.' },
  { id: 'punctuality_pct',   label: 'Punctuality %',     note: 'Share of shifts started on time.' },
  { id: 'late_count',        label: 'Late arrivals',     note: 'Count in the period. Fewer is better.' },
  { id: 'absence_count',     label: 'Unapproved absences', note: 'Count in the period. Fewer is better.' },
  { id: 'early_leave_count', label: 'Early departures',  note: 'Count in the period. Fewer is better.' },
]

// A weight total is only valid at exactly 100 — the database refuses to approve anything
// else. This turns the number into the sentence the screen shows.
export function weightVerdict(total) {
  const n = Number(total || 0)
  if (n === 100) return { ok: true, text: 'Weights add up to 100%.' }
  if (n === 0) return { ok: false, text: 'No criteria added yet.' }
  if (n < 100) return { ok: false, text: `${(100 - n).toFixed(2).replace(/\.00$/, '')}% still unassigned.` }
  return { ok: false, text: `${(n - 100).toFixed(2).replace(/\.00$/, '')}% over.` }
}
