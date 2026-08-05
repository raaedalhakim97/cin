// An in-memory stand-in for the Supabase client, covering exactly the surface
// the screens use. It exists so the app runs and can be reviewed before a
// database is wired up — switching to the real thing is a matter of setting
// EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY, with no screen changes.
//
// Writes mutate the seed, so clocking in, requesting leave, self-evaluating,
// reacting and commenting all behave for real within a session. Nothing
// persists across an app restart, which is the point.

import { PERSONAS, buildSeed } from './seed'

let db = buildSeed()
let idCounter = 1000
const nextId = () => `gen-${idCounter++}`

// ── Filter application ──────────────────────────────────────────────────────

function matches(row, filters) {
  return filters.every((f) => {
    const value = row[f.column]
    switch (f.op) {
      case 'eq':
        return String(value) === String(f.value)
      case 'neq':
        return String(value) !== String(f.value)
      case 'in':
        return f.value.map(String).includes(String(value))
      case 'gte':
        return value != null && value >= f.value
      case 'lte':
        return value != null && value <= f.value
      case 'gt':
        return value != null && value > f.value
      case 'lt':
        return value != null && value < f.value
      case 'is':
        return f.value === null ? value == null : value === f.value
      default:
        return true
    }
  })
}

function applyOrder(rows, orders) {
  if (!orders.length) return rows
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const av = a[o.column]
      const bv = b[o.column]
      if (av === bv) continue
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av > bv ? 1 : -1
      return o.ascending ? cmp : -cmp
    }
    return 0
  })
}

// Mirrors the DB's aa_compute_kpi_total trigger: after any write to a score row,
// total_score and rating are recalculated from the weights. The app must never
// compute these itself, so the demo layer owns it the same way Postgres does.
function recomputeKpiRow(row) {
  const w = row.weights_used ?? { attendance: 30, behavior: 25, achievement: 20, manager: 15, self: 10 }
  const total =
    (Number(row.attendance_score || 0) * w.attendance +
      Number(row.behavior_score || 0) * w.behavior +
      Number(row.achievement_score || 0) * w.achievement +
      Number(row.manager_score || 0) * w.manager +
      Number(row.self_score || 0) * w.self) /
    100

  row.total_score = Math.round(total * 10) / 10
  row.rating =
    total >= 90
      ? 'Exceptional'
      : total >= 75
        ? 'High Performer'
        : total >= 60
          ? 'Meets Expectations'
          : total >= 45
            ? 'Needs Improvement'
            : 'Unsatisfactory'
  return row
}

function afterWrite(table, row) {
  if (table === 'kpi_scores') recomputeKpiRow(row)

  // leave_balances.remaining_days is a generated column in Postgres; keep it
  // consistent here so the UI reflects writes.
  if (table === 'leave_balances') {
    row.remaining_days = Number(row.entitled_days || 0) - Number(row.used_days || 0)
  }
  return row
}

// ── Query builder ───────────────────────────────────────────────────────────

class Query {
  constructor(table) {
    this.table = table
    this.filters = []
    this.orders = []
    this._limit = null
    this._single = null
    this._count = false
    this._head = false
    this._mode = 'select'
    this._payload = null
  }

  select(_columns, opts = {}) {
    if (this._mode === 'select') {
      this._count = opts.count === 'exact'
      this._head = !!opts.head
    }
    return this
  }

  insert(payload) {
    this._mode = 'insert'
    this._payload = payload
    return this
  }

  update(payload) {
    this._mode = 'update'
    this._payload = payload
    return this
  }

  delete() {
    this._mode = 'delete'
    return this
  }

  eq(column, value) {
    this.filters.push({ op: 'eq', column, value })
    return this
  }
  neq(column, value) {
    this.filters.push({ op: 'neq', column, value })
    return this
  }
  in(column, value) {
    this.filters.push({ op: 'in', column, value })
    return this
  }
  gte(column, value) {
    this.filters.push({ op: 'gte', column, value })
    return this
  }
  lte(column, value) {
    this.filters.push({ op: 'lte', column, value })
    return this
  }
  gt(column, value) {
    this.filters.push({ op: 'gt', column, value })
    return this
  }
  lt(column, value) {
    this.filters.push({ op: 'lt', column, value })
    return this
  }
  is(column, value) {
    this.filters.push({ op: 'is', column, value })
    return this
  }
  or() {
    // Not used by any mobile screen; ignored rather than silently mis-filtering.
    return this
  }
  order(column, opts = {}) {
    this.orders.push({ column, ascending: opts.ascending !== false })
    return this
  }
  limit(n) {
    this._limit = n
    return this
  }
  range(from, to) {
    this._from = from
    this._limit = to - from + 1
    return this
  }
  maybeSingle() {
    this._single = 'maybe'
    return this
  }
  single() {
    this._single = 'strict'
    return this
  }

  _run() {
    const rows = (db[this.table] = db[this.table] ?? [])

    if (this._mode === 'insert') {
      const list = Array.isArray(this._payload) ? this._payload : [this._payload]
      const created = list.map((p) => afterWrite(this.table, { id: nextId(), created_at: new Date().toISOString(), ...p }))
      rows.push(...created)
      return { data: created, error: null, count: created.length }
    }

    const selected = rows.filter((r) => matches(r, this.filters))

    if (this._mode === 'update') {
      for (const row of selected) {
        Object.assign(row, this._payload)
        afterWrite(this.table, row)
      }
      return { data: selected, error: null, count: selected.length }
    }

    if (this._mode === 'delete') {
      db[this.table] = rows.filter((r) => !selected.includes(r))
      return { data: selected, error: null, count: selected.length }
    }

    let out = applyOrder(selected, this.orders)
    if (this._from != null) out = out.slice(this._from)
    if (this._limit != null) out = out.slice(0, this._limit)

    if (this._head) return { data: null, error: null, count: selected.length }
    if (this._single) {
      if (out.length === 0) {
        return this._single === 'maybe'
          ? { data: null, error: null }
          : { data: null, error: { code: 'PGRST116', message: 'No rows found' } }
      }
      return { data: out[0], error: null }
    }
    return { data: out, error: null, count: this._count ? selected.length : null }
  }

  // Thenable, so `await supabase.from(...)...` works exactly as it does with
  // postgrest-js.
  then(resolve, reject) {
    try {
      // Small delay so skeleton loaders actually render — otherwise the demo
      // hides the loading states we want to review.
      return new Promise((r) => setTimeout(() => r(this._run()), 180)).then(resolve, reject)
    } catch (err) {
      return Promise.resolve({ data: null, error: { message: String(err) } }).then(resolve, reject)
    }
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────

let session = null
const listeners = new Set()

function emit(event) {
  for (const cb of listeners) cb(event, session)
}

function sessionFor(persona) {
  return {
    access_token: `demo-token-${persona.userId}`,
    user: { id: persona.userId, email: personaEmail(persona) },
  }
}

function personaEmail(persona) {
  return `${persona.label.split(' ')[0].toLowerCase()}@company.com`
}

export const demoPersonas = PERSONAS.map((p) => ({ ...p, email: personaEmail(p) }))

const auth = {
  getSession: async () => ({ data: { session }, error: null }),

  signInWithPassword: async ({ email }) => {
    const persona = demoPersonas.find((p) => p.email.toLowerCase() === String(email).trim().toLowerCase())
    if (!persona) {
      return {
        data: { session: null },
        error: { message: 'No demo account for that email. Pick one of the accounts listed below.' },
      }
    }
    session = sessionFor(persona)
    emit('SIGNED_IN')
    return { data: { session, user: session.user }, error: null }
  },

  signOut: async () => {
    session = null
    emit('SIGNED_OUT')
    return { error: null }
  },

  onAuthStateChange: (cb) => {
    listeners.add(cb)
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
  },
}

// ── Client ──────────────────────────────────────────────────────────────────

const demoClient = {
  from: (table) => new Query(table),
  auth,
  rpc: async (name) => {
    // No mobile screen depends on an RPC's return value; log_login_attempt is
    // fire-and-forget and the rest are admin-side.
    if (name === 'log_login_attempt') return { data: null, error: null }
    return { data: null, error: null }
  },
  // Lets the demo be reset from the UI if a session gets messy.
  __resetDemo: () => {
    db = buildSeed()
  },
}

export default demoClient
