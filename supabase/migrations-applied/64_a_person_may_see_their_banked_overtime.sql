-- Overtime is a time count, not a pay run. The company decides whether to pay it or keep it
-- as a record, so the product's job is only to total it honestly and show it where the
-- employee already looks at their time — the Leave section.
--
-- A narrow SECURITY DEFINER reader, the same shape as my_manager() and my_workspace(): it
-- answers one question about the caller — "how many overtime hours have I banked this year" —
-- and cannot be pointed at anyone else, because it resolves the employee from auth.uid()
-- rather than taking an id. Attendance RLS would already let a person read their own rows and
-- sum them client-side; this is the same answer without shipping every row to do it.
--
-- Applied to production 2026-09-24.
CREATE OR REPLACE FUNCTION public.my_overtime_hours(p_year integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(a.overtime_hours), 0)
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
   WHERE e.user_id = (SELECT auth.uid())
     AND EXTRACT(YEAR FROM a.date) = p_year;
$function$;

COMMENT ON FUNCTION public.my_overtime_hours(integer) IS
  'Total overtime hours the calling user has banked in a year. A record, not a payment — the company decides separately whether to pay it out.';

REVOKE EXECUTE ON FUNCTION public.my_overtime_hours(integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.my_overtime_hours(integer) TO authenticated;
