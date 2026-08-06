import supabase from './supabase'

// Login attempts are logged for every outcome — Art. 26.5 requires an audit
// trail per session. The RPC is the same one the web app calls.
export async function logLoginAttempt(email, success) {
  const { error } = await supabase.rpc('log_login_attempt', { p_email: email, p_success: success })
  if (error) console.warn('[sessionService] log_login_attempt failed', error.message)
}

// NOTE: the web app also calls create_user_session(p_token) with the raw JWT and
// enforces its 2-session cap client-side (Login.jsx) — both of which are
// bypassable and store a replayable credential in the database. That is
// deliberately not ported here. Concurrent-session limits belong in the RPC, and
// the session row should key off a hash, not the token itself.
