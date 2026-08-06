-- Make the neutral-approved-absence correction in 06 actually take effect.
--
-- calculate_attendance_score only treats approved absence as neutral when the
-- company has NOT priced it explicitly. Both tenants carried the shipped
-- default, which prices it at 80 — so without this, correction 2 in 06 is
-- inert.
--
-- The key is removed from the column default and from every row still holding
-- the untouched default. A company that has deliberately set its own value
-- keeps it: that is a policy choice, and this migration must not overwrite one.
ALTER TABLE public.kpi_settings
  ALTER COLUMN attendance_point_values
  SET DEFAULT '{"present":100,"late_minor":85,"late_moderate":70,"late_major":50,"absent_unauthorized":0}'::jsonb;

UPDATE public.kpi_settings
   SET attendance_point_values = attendance_point_values - 'absent_approved'
 WHERE attendance_point_values = '{"present":100,"late_major":50,"late_minor":85,"late_moderate":70,"absent_approved":80,"absent_unauthorized":0}'::jsonb;
