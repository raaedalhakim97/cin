import supabase from './supabase'

export async function logLoginAttempt(email, success) {
  await supabase.rpc('log_login_attempt', { p_email: email, p_success: success })
}

export async function getActiveSessionCount() {
  const { data, error } = await supabase.rpc('get_active_session_count')
  if (error) return 0
  return data ?? 0
}

export async function createUserSession(token) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  await supabase.rpc('create_user_session', {
    p_token: token,
    p_expires_at: expiresAt,
  })
}

export async function endUserSession(token) {
  if (!token) return
  await supabase.rpc('mark_session_inactive', { p_token: token })
}
