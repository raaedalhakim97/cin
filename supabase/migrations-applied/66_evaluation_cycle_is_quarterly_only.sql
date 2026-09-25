-- BYOND runs one performance cycle: quarterly. Every company was already on 3 months (the
-- column default), but the KPI Config screen offered Monthly / Semi-annual / Annual too, and
-- the API would accept them. The choice is removed from the screen; this makes the database
-- agree, so no path can set anything else. The anchor month stays a choice — it decides which
-- months the quarters close on, which is a real fiscal-year question.
--
-- Applied to production 2026-09-25. All three companies were already at 3; no data changed.
ALTER TABLE public.kpi_settings
  ADD CONSTRAINT kpi_settings_evaluation_is_quarterly
  CHECK (evaluation_frequency_months = 3);
