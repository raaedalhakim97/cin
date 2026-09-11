-- Raaed created a company for a friend to try, closed the screen, and could not get the
-- owner's invite link back. Her next move was to read it out of the database by hand,
-- which is the correct workaround and a bad sign.
--
-- ── What was actually missing ──────────────────────────────────────────────
--
-- The link is shown once, at creation, by the InviteLink block on /platform, with a
-- comment explaining why: there is no SMTP on this project, so the link is displayed for
-- the operator to send through whatever channel they already use. That is a reasonable
-- answer to "we cannot email it". It is not an answer to "I closed the tab".
--
-- The company file lists the pending invite and offers to REVOKE it, so the one thing the
-- screen will do with an invite is destroy it. platform_company_access returns invite_id
-- and deliberately no token, so the interface could not rebuild the link even if it tried.
-- PendingInvitesModal does copy links, but it lives in a company's own employee list,
-- behind that company's RLS — unreachable for a tenant the platform owner is setting up.
--
-- So: an operator who looks away loses the only route into a new customer's workspace, and
-- the recovery is to revoke, re-invite, and hope nobody had already been sent the first
-- one.
--
-- ── Why a function rather than widening platform_company_access ────────────
--
-- The token is the credential. Whoever holds it sets the owner's password, which is why it
-- was left out of the access listing in the first place, and that instinct was right: that
-- listing is read on page load, for every row, every time the company file is opened.
-- Handing out live credentials as a side effect of looking at a page is how they end up in
-- logs, in screenshots and in browser history.
--
-- This is a separate, deliberate act instead. It is called when somebody presses a button
-- that says what it does, it returns one invite, and it refuses anything that is not still
-- pending — an accepted invite's token is spent, and a revoked one is revoked.

CREATE OR REPLACE FUNCTION public.platform_invite_link(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token   text;
  v_email   text;
  v_expires timestamptz;
BEGIN
  IF NOT public.is_platform_owner((SELECT auth.uid())) THEN
    RAISE EXCEPTION 'Only BYOND platform owners can read an invite link';
  END IF;

  SELECT token, email, expires_at
    INTO v_token, v_email, v_expires
    FROM employee_invites
   WHERE id = p_invite_id
     AND status = 'pending';

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'That invite is not pending — it may already be accepted, revoked or expired';
  END IF;

  -- Expiry is reported rather than enforced. A link that expired an hour ago is still the
  -- right thing to look at when working out what a customer was sent, and refusing to
  -- show it would send the operator back to the database, which is the whole problem.
  RETURN jsonb_build_object(
    'token',      v_token,
    'email',      v_email,
    'expires_at', v_expires,
    'expired',    v_expires IS NOT NULL AND v_expires < now()
  );
END;
$function$;

COMMENT ON FUNCTION public.platform_invite_link(uuid) IS
  'The invite link for one pending invite, for a platform owner who needs to send it again. Separate from platform_company_access on purpose: the token is a credential and must be fetched by a deliberate act, not returned to every page load.';

REVOKE EXECUTE ON FUNCTION public.platform_invite_link(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.platform_invite_link(uuid) TO authenticated;
