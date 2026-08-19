// Supabase Auth failures, translated for the person reading them.
//
// Auth's messages are written for whoever configured the project, not for the
// employee sitting in front of the screen. The one that prompted this file is
// email_address_invalid: Auth returns it when it will not send to an address, most
// often because the project has no custom SMTP and the built-in mailer only
// delivers to members of the Supabase organisation. The address itself is usually
// perfectly valid, so 'Email address "said@gmail.com" is invalid' sends an HR
// admin hunting a typo that does not exist.
//
// Keyed on error.code rather than on the message text. Codes are a stable API;
// the strings are not, and matching on them breaks silently at the next
// GoTrue release.
//
// Shared by AcceptInvite and Signup deliberately. They are the two places a
// person creates an account, they fail in the same ways, and two copies of this
// table would drift — at which point the same failure would be explained two
// different ways depending on which door you came through.

const MESSAGE = {
  email_address_invalid:
    'We could not create your account because this address was rejected by our email provider. ' +
    'The address is probably fine — this is a setup problem on our side.',
  user_already_exists:
    'An account already exists for this address. Try logging in instead.',
  email_exists:
    'An account already exists for this address. Try logging in instead.',
  weak_password:
    'Choose a stronger password — at least 8 characters, and not a common one.',
  over_email_send_rate_limit:
    'Too many attempts from this address. Please wait a few minutes and try again.',
  over_request_rate_limit:
    'Too many attempts. Please wait a few minutes and try again.',
  signup_disabled:
    'New accounts are currently disabled.',
  email_not_confirmed:
    'Check your inbox and confirm your email address first.',
  validation_failed:
    'Please check the details you entered and try again.',
}

// `suffix` lets the caller add the next step, which differs by context: an
// invited employee should ask HR, while someone signing their own company up has
// nobody to ask and should be pointed at support.
export function authErrorMessage(error, suffix = '') {
  // Falls back to Auth's own text rather than a generic apology. An unrecognised
  // error is more useful shown than hidden — it is what gets pasted into a bug
  // report — and a wall of "Something went wrong" is how real causes get lost.
  const base = MESSAGE[error?.code] ?? error?.message ?? 'Could not create your account.'
  return suffix ? `${base} ${suffix}` : base
}

export default authErrorMessage
