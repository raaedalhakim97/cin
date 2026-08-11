-- Day Off could never be saved.
--
-- Reported from the Schedule page: "Add Day Off" always failed with "Something
-- went wrong saving this shift." Reproduced against the live database:
--
--   INSERT INTO shifts (... shift_type 'off', 00:00 -> 23:59 ...)
--   FAILED [23514] violates check constraint "shifts_duration_sane"
--
-- The constraint is:
--
--   CHECK ((end_at - start_at) <= '16:00:00'::interval)
--
-- and a day off is stored as a full-day span, 00:00 to 23:59 — 23h59m. So every
-- day off ever attempted was rejected. Not an edge case: the feature has never
-- worked once.
--
-- The 16-hour cap is right for a WORK shift. It catches the ordinary typo where
-- an 08:00 start is given an 08:00 end and silently becomes a 24-hour shift
-- feeding 16 hours of overtime into payroll. It has no business applying to a
-- marker that means "this person is not working today", which by definition
-- occupies the whole day.
--
-- So the guard is scoped rather than loosened. Work shifts keep the 16-hour
-- ceiling exactly as before; 'off' rows are exempt. shifts_end_after_start
-- still applies to both, so an off row cannot be zero-length or inverted.

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_duration_sane;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_duration_sane
  CHECK (
    shift_type <> 'work'
    OR (end_at - start_at) <= '16:00:00'::interval
  );

-- A day off still has to stay inside a sane span, or a bad client could write a
-- month-long "off" row and quietly suppress attendance scoring for weeks.
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_off_within_one_day;

ALTER TABLE public.shifts
  ADD CONSTRAINT shifts_off_within_one_day
  CHECK (
    shift_type <> 'off'
    OR (end_at - start_at) <= '24:00:00'::interval
  );
