#!/usr/bin/env bash
# Fails the build if a real credential is tracked in git.
#
# Matches key SHAPES, not the words. An earlier version grepped for
# "service_role" and flagged .env.example and a migration comment that merely
# explain what not to commit — a check that cries wolf gets switched off.
set -uo pipefail
fail=0

if git ls-files | grep -qE '(^|/)\.env$'; then
  echo "::error::a .env file is tracked in git"
  git ls-files | grep -E '(^|/)\.env$'
  fail=1
fi

# A Supabase secret key.
if git grep -nIE 'sb_secret_[A-Za-z0-9_-]{20,}' -- . >/dev/null 2>&1; then
  echo "::error::a Supabase secret key appears in tracked source"
  git grep -nIE 'sb_secret_[A-Za-z0-9_-]{20,}' -- .
  fail=1
fi

# Any JWT. The anon key is a JWT too, but it belongs in host env vars and
# eas.json — never inlined in source.
if git grep -nIE 'eyJhbGciOi[A-Za-z0-9_-]{30,}' -- . ':!*.md' >/dev/null 2>&1; then
  echo "::error::a JWT appears in tracked source"
  git grep -nIE 'eyJhbGciOi[A-Za-z0-9_-]{30,}' -- . ':!*.md'
  fail=1
fi

# A Postgres URI with a real password.
if git grep -nIE 'postgres(ql)?://[^:]+:[^@[:space:]]{8,}@' -- . ':!*.md' ':!ops/*' >/dev/null 2>&1; then
  echo "::error::a database connection string with a password appears in tracked source"
  git grep -nIE 'postgres(ql)?://[^:]+:[^@[:space:]]{8,}@' -- . ':!*.md' ':!ops/*'
  fail=1
fi

# An account password written into a tracked file.
#
# Every check above matches a machine-generated key format. None of them caught
# `ByondTest#2026` — a working super_admin password for the live database —
# sitting in docs/deployment.md while this repository was public.
#
# Passwords people invent have no distinctive shape, so this matches on context
# instead: the word "password" on the same line as a quoted literal that has the
# character mix a password has. The two lookaheads require an uppercase letter
# and a digit inside the literal, which is what keeps it off ordinary code like
# register('password', …) and prose like "Password is required".
PW_RE='(?i)password.{0,60}[`'"'"'"](?=[^`'"'"'"]*[A-Z])(?=[^`'"'"'"]*[0-9])[A-Za-z0-9@#$%^&*_+.!?-]{8,}[`'"'"'"]'
if git grep -nIP "$PW_RE" -- . ':!scripts/check-secrets.sh' >/dev/null 2>&1; then
  echo "::error::an account password appears in tracked source — rotate it, then remove it"
  git grep -nIP "$PW_RE" -- . ':!scripts/check-secrets.sh'
  fail=1
fi

[[ $fail -eq 0 ]] && echo "no tracked .env, no keys, connection strings or passwords in source"
exit $fail
