-- Notifications: the table, who may read it, and who may write it.
--
-- Asked for on 11 August: "add notification for each access to receive attendance
-- and news feed and updates". Deferred through the Frankfurt migration; this is the
-- foundation, and 17 adds the triggers that actually create the rows.
--
-- Three decisions worth stating, because they shape everything after.
--
-- 1. Written by database triggers, not by client code.
--
--    A punch can arrive from the website, from the Android APK, or from an HR user
--    editing someone's attendance by hand. A notification raised in JavaScript would
--    fire for whichever client happened to implement it and stay silent for the other
--    two, and the silence would look like "no notification was warranted".
--
-- 2. Nobody can write their own notifications.
--
--    Same reasoning as audit_logs in migration 14. The rows are inserted by a
--    SECURITY DEFINER function owned by the table owner, so no end-user grant is
--    needed — and with the grant removed, a signed-in user cannot manufacture a
--    notification that appears to come from HR.
--
-- 3. A notification must never be able to break the thing it is about.
--
--    This is the one that would hurt. Every trigger in migration 17 wraps its work in
--    an exception handler, so a bug in notification code cannot stop someone clocking
--    in at 6am. The business write always wins; a failed notification degrades to a
--    warning in the Postgres log. That is the correct trade: a missed notification is
--    an annoyance, a refused clock-in is someone not being paid correctly.

CREATE TABLE IF NOT EXISTS public.notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.company(id)   ON DELETE CASCADE,
  -- The recipient. Notifications are addressed to a person, not to a role: roles
  -- decide who gets one, and that resolution happens when the event fires.
  employee_id   uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,

  kind          text NOT NULL,
  title         text NOT NULL,
  body          text,
  -- Where tapping it should go, as an in-app route rather than a URL, so the same
  -- row works for the website and the mobile app.
  link          text,

  -- What it is about, for de-duplication and for opening the right record.
  subject_table text,
  subject_id    uuid,
  -- Who caused it. NULL for anything raised by a scheduled job, which is why this is
  -- nullable rather than NOT NULL.
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- An enumerated kind rather than free text. A typo in a trigger would otherwise
  -- create a notification the UI has no label for, and it would surface as a blank
  -- row rather than as an error.
  CONSTRAINT notifications_kind_check CHECK (kind IN (
    'attendance_late',
    'attendance_absent',
    'attendance_missing_clockout',
    'attendance_team_late',
    'feed_post',
    'leave_submitted',
    'leave_manager_approved',
    'leave_approved',
    'leave_rejected',
    'leave_cancelled',
    'shift_published',
    'shift_day_off'
  )),
  CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT notifications_body_len  CHECK (body IS NULL OR char_length(body) <= 1000)
);

-- The bell asks one question constantly: what is unread for me, newest first. A
-- partial index on read_at IS NULL keeps that cheap as the table grows, because read
-- notifications are the overwhelming majority over time and none of them belong in
-- this index.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
  ON public.notifications (employee_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_employee_created_idx
  ON public.notifications (employee_id, created_at DESC);

-- For de-duplication in the triggers: "has this person already been told about this
-- record?" without a sequential scan.
CREATE INDEX IF NOT EXISTS notifications_subject_idx
  ON public.notifications (subject_table, subject_id, employee_id, kind);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ── Who may read ──────────────────────────────────────────────────────────
--
-- Only the recipient. Deliberately not readable by HR or super_admin: a
-- notification list is a record of what someone has been told and when they read it,
-- which is closer to their inbox than to their personnel file. The underlying events
-- are all separately visible to HR through attendance, leave and the audit trail, so
-- nothing is lost by keeping this private.
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid())
    )
  );

-- ── Who may mark as read ──────────────────────────────────────────────────
--
-- The recipient, and only read_at. Without the guard below, the UPDATE policy would
-- also allow rewriting the title and body of a notification you had received — which
-- would let someone edit what HR appears to have told them.
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM public.employees WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.notifications_only_read_at_is_editable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The service role and the trigger functions bypass this by having no auth.uid().
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.id            := OLD.id;
  NEW.company_id    := OLD.company_id;
  NEW.employee_id   := OLD.employee_id;
  NEW.kind          := OLD.kind;
  NEW.title         := OLD.title;
  NEW.body          := OLD.body;
  NEW.link          := OLD.link;
  NEW.subject_table := OLD.subject_table;
  NEW.subject_id    := OLD.subject_id;
  NEW.actor_user_id := OLD.actor_user_id;
  NEW.created_at    := OLD.created_at;

  -- read_at is a latch: it can be set, and it can be cleared to mark something
  -- unread again, but it cannot be moved to a time of the reader's choosing.
  IF NEW.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
    NEW.read_at := now();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notifications_freeze_content ON public.notifications;
CREATE TRIGGER notifications_freeze_content
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_only_read_at_is_editable();

-- ── Who may write ─────────────────────────────────────────────────────────
--
-- No INSERT policy and no DELETE policy, so RLS refuses both for every end user.
-- notify_employee below is SECURITY DEFINER and owned by the table owner, so it
-- inserts without needing either.
--
-- The grants are revoked as well. With RLS alone, the table would be one
-- accidentally permissive policy away from letting people invent notifications from
-- HR — the same defence in depth applied to audit_logs in migration 14.
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
REVOKE INSERT, DELETE ON public.notifications FROM authenticated;
REVOKE ALL ON public.notifications FROM anon;

-- ── The one way a notification gets created ────────────────────────────────
--
-- Deliberately silent about recipients who cannot receive: an employee row with no
-- user_id is someone invited but not yet signed up, and a terminated employee should
-- not accumulate a queue. Both are skipped rather than raising, because the callers
-- are triggers on business tables.
--
-- p_dedupe_window suppresses a repeat about the same record within a period. Editing
-- a shift five times in a minute is one piece of news, not five.
CREATE OR REPLACE FUNCTION public.notify_employee(
  p_company_id    uuid,
  p_employee_id   uuid,
  p_kind          text,
  p_title         text,
  p_body          text DEFAULT NULL,
  p_link          text DEFAULT NULL,
  p_subject_table text DEFAULT NULL,
  p_subject_id    uuid DEFAULT NULL,
  p_dedupe_window interval DEFAULT '5 minutes'
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id     uuid;
  v_usable boolean;
BEGIN
  IF p_employee_id IS NULL OR p_company_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT (e.user_id IS NOT NULL AND e.status = 'active')
    INTO v_usable
    FROM employees e
   WHERE e.id = p_employee_id;

  IF NOT COALESCE(v_usable, false) THEN
    RETURN NULL;
  END IF;

  IF p_subject_id IS NOT NULL AND p_dedupe_window IS NOT NULL THEN
    PERFORM 1 FROM notifications
     WHERE employee_id = p_employee_id
       AND kind = p_kind
       AND subject_table IS NOT DISTINCT FROM p_subject_table
       AND subject_id = p_subject_id
       AND created_at > now() - p_dedupe_window
     LIMIT 1;
    IF FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO notifications (company_id, employee_id, kind, title, body, link,
                             subject_table, subject_id, actor_user_id)
  VALUES (p_company_id, p_employee_id, p_kind, p_title, p_body, p_link,
          p_subject_table, p_subject_id, (SELECT auth.uid()))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- End users never call this directly; the triggers do. Leaving it executable would
-- let anyone address a notification to anybody in their company.
REVOKE ALL ON FUNCTION public.notify_employee(uuid,uuid,text,text,text,text,text,uuid,interval)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.notifications_only_read_at_is_editable()
  FROM PUBLIC, anon, authenticated;

-- ── Mark as read, in bulk ─────────────────────────────────────────────────
--
-- "Mark all read" as one statement rather than one UPDATE per row from the client.
-- Runs as the caller, so RLS confines it to their own rows; the freeze trigger above
-- still applies.
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  UPDATE notifications
     SET read_at = now()
   WHERE read_at IS NULL
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
