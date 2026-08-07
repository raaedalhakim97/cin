-- Stop the geofence setting from lying.
--
-- Found by audit. Both tenants had require_gps_clock_in = true,
-- enforce_geofence = false and zero rows in work_locations — a coherent state:
-- coordinates recorded, nothing enforced.
--
-- The problem is the state next door. Demonstrated in a rolled-back
-- transaction: set enforce_geofence = true with no work_locations, then punch
-- in from an arbitrary coordinate:
--
--     PUNCH ACCEPTED
--
-- attendance_guard() measures the distance to the nearest active work location
-- and refuses when it is out of range. With no locations there is no nearest
-- one, so there is nothing to be out of range of, and every punch passes. HR
-- ticks "enforce geofence", the dashboard says it is on, and clock-ins from
-- anywhere in the world are accepted unchecked. A control that reports itself
-- as active while doing nothing is worse than one that is plainly off — the
-- whole point of the feature is that someone trusts it.
--
-- Fail-closed is not the answer either. Refusing every punch because a setting
-- was ticked before any location was added locks an entire company out of
-- clocking in, which is a worse morning than an unchecked punch.
--
-- So neither behaviour is chosen: the invalid combination is made unreachable.
-- Enforcement cannot be switched on without somewhere to enforce, and the last
-- location cannot be removed while enforcement is on.

-- ── 1. Cannot switch enforcement on without a location ──────────────────────

CREATE OR REPLACE FUNCTION public.geofence_requires_a_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.enforce_geofence
     AND NOT EXISTS (SELECT 1 FROM work_locations w
                     WHERE w.company_id = NEW.company_id AND w.active) THEN
    RAISE EXCEPTION
      'Add at least one active work location before enforcing the geofence. With none defined every clock-in is accepted without being checked, so the setting would report protection that is not there.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geofence_requires_a_location ON public.shift_settings;
CREATE TRIGGER geofence_requires_a_location
  BEFORE INSERT OR UPDATE OF enforce_geofence ON public.shift_settings
  FOR EACH ROW EXECUTE FUNCTION public.geofence_requires_a_location();

-- ── 2. Cannot remove the last location while enforcement is on ──────────────
--
-- The same silent failure arrives from the other direction: enforcement is on
-- and correct, then someone deletes the only site or unticks its `active` flag.
-- Enforcement stays on, has nothing to check, and quietly stops enforcing.

CREATE OR REPLACE FUNCTION public.last_work_location_is_protected()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid := COALESCE(OLD.company_id, NEW.company_id);
  v_remaining int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shift_settings s
                 WHERE s.company_id = v_company AND s.enforce_geofence) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT count(*) INTO v_remaining
  FROM work_locations w
  WHERE w.company_id = v_company
    AND w.active
    AND w.id <> COALESCE(OLD.id, NEW.id);

  -- An UPDATE that leaves the row active still counts as a remaining location.
  IF TG_OP = 'UPDATE' AND NEW.active THEN
    v_remaining := v_remaining + 1;
  END IF;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION
      'This is the only active work location and the geofence is being enforced. Removing it would leave enforcement switched on with nothing to check, so every clock-in would be accepted. Add another location first, or turn off geofence enforcement.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS last_work_location_is_protected ON public.work_locations;
CREATE TRIGGER last_work_location_is_protected
  BEFORE UPDATE OR DELETE ON public.work_locations
  FOR EACH ROW EXECUTE FUNCTION public.last_work_location_is_protected();

-- Trigger functions are not API surface. Same treatment as migration 05.
REVOKE EXECUTE ON FUNCTION public.geofence_requires_a_location()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.last_work_location_is_protected()   FROM anon, authenticated;
