-- The custom KPI system, part 1 of 3: what can be measured, and what each level means.
--
-- Replaces five fixed score columns (attendance, behavior, achievement, manager, self)
-- with a per-company library of criteria that HR defines. The existing columns are left
-- alone — 129 rows of history hang off them — and the new system runs alongside until it
-- has real data of its own.
--
-- ── The shape ──────────────────────────────────────────────────────────────
--
--   kpi_definitions        one criterion: "Punctuality", "Quality of Work"
--   kpi_anchors            the fixed comments HR writes, several per level
--   kpi_auto_thresholds    for automated criteria: what number becomes what level
--
-- ── Why anchors ────────────────────────────────────────────────────────────
--
-- A bare 1-5 means nothing: one manager's 3 is another's 4, and an employee told "you got
-- a 2" learns nothing they can act on. An anchor is a sentence HR writes in advance for
-- each level — "misses deadlines without warning" versus "delivers on time, flags risks
-- early" — so the rater picks a description rather than a number, and the employee reads
-- what to do differently. This is a behaviourally-anchored rating scale, and it is the
-- established answer to both problems.
--
-- Several anchors per level, not one, so the rater can pick the sentence that actually
-- happened instead of the nearest available.

-- ── Level points: fixed, and in one place ──────────────────────────────────
-- 20/40/60/80/100 rather than HR-settable. If one company can make "Meets" worth 90 and
-- another 55, nothing is comparable — not between employees, not between departments, and
-- not for us when a customer asks why the number moved. The weight is where a company
-- expresses what it cares about; the scale stays still.
CREATE OR REPLACE FUNCTION public.kpi_level_points(p_level smallint)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE p_level
           WHEN 1 THEN 20    -- Poor
           WHEN 2 THEN 40    -- Below expectations
           WHEN 3 THEN 60    -- Meets expectations
           WHEN 4 THEN 80    -- Exceeds expectations
           WHEN 5 THEN 100   -- Outstanding
         END::numeric;
$function$;

COMMENT ON FUNCTION public.kpi_level_points(smallint) IS
  'The 5-level scale, fixed platform-wide so scores stay comparable. Weight is where a company expresses priority, not the scale.';

-- ── 1. The criteria ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_definitions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  uuid NOT NULL REFERENCES public.company(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  category    text NOT NULL DEFAULT 'general',
  -- 'manual'    a human picks a level
  -- 'automated' the app computes a number and kpi_auto_thresholds turns it into a level
  source      text NOT NULL DEFAULT 'manual',
  -- Which measurement feeds an automated criterion. Names a metric this product already
  -- computes; NULL for manual ones.
  metric      text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CONSTRAINT kpi_definitions_source   CHECK (source IN ('manual', 'automated')),
  CONSTRAINT kpi_definitions_metric   CHECK (
    (source = 'automated' AND metric IS NOT NULL) OR
    (source = 'manual'    AND metric IS NULL)),
  -- Only metrics the product actually computes. A criterion pointing at a measurement
  -- that does not exist would score everyone NULL forever and nobody would know why.
  CONSTRAINT kpi_definitions_known_metric CHECK (
    metric IS NULL OR metric IN
      ('attendance_pct', 'punctuality_pct', 'late_count', 'absence_count', 'early_leave_count')),
  CONSTRAINT kpi_definitions_category CHECK (category IN
    ('general', 'quality', 'productivity', 'behaviour', 'attendance', 'leadership', 'sales', 'safety'))
);

-- ── 2. The anchors ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kpi_anchors (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  definition_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  level         smallint NOT NULL,
  -- The sentence the rater picks and the employee reads. This is the product.
  comment       text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kpi_anchors_level   CHECK (level BETWEEN 1 AND 5),
  CONSTRAINT kpi_anchors_comment CHECK (btrim(comment) <> '')
);

-- ── 3. Automated criteria: number in, level out ────────────────────────────
-- One row per level, holding the minimum value that reaches it. Level 1 should sit at a
-- floor low enough that nothing falls through — a value below every threshold produces no
-- level, and this system does not invent one.
CREATE TABLE IF NOT EXISTS public.kpi_auto_thresholds (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  definition_id uuid NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
  level         smallint NOT NULL,
  min_value     numeric NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, level),
  CONSTRAINT kpi_auto_thresholds_level CHECK (level BETWEEN 1 AND 5)
);

-- Resolve a measured value to a level. Highest threshold the value clears wins. Returns
-- NULL when it clears none — "we could not place this" rather than a bottom score the
-- employee did not earn.
CREATE OR REPLACE FUNCTION public.kpi_level_for_value(p_definition_id uuid, p_value numeric)
RETURNS smallint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.level
    FROM kpi_auto_thresholds t
   WHERE t.definition_id = p_definition_id
     AND p_value >= t.min_value
   ORDER BY t.min_value DESC
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.kpi_level_for_value(uuid, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.kpi_level_for_value(uuid, numeric) TO authenticated;

-- ── Timestamps ─────────────────────────────────────────────────────────────
CREATE TRIGGER kpi_definitions_updated_at BEFORE UPDATE ON public.kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER kpi_anchors_updated_at BEFORE UPDATE ON public.kpi_anchors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── Indexes ────────────────────────────────────────────────────────────────
-- company_id first: it is what every RLS policy filters on. The foreign-key indexes are
-- here from birth rather than being found by a linter in six months (see migration 38).
CREATE INDEX IF NOT EXISTS idx_kpi_definitions_company_id     ON public.kpi_definitions (company_id);
CREATE INDEX IF NOT EXISTS idx_kpi_anchors_definition_id      ON public.kpi_anchors (definition_id);
CREATE INDEX IF NOT EXISTS idx_kpi_auto_thresholds_definition_id ON public.kpi_auto_thresholds (definition_id);

-- ── Access ─────────────────────────────────────────────────────────────────
ALTER TABLE public.kpi_definitions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_anchors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_auto_thresholds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kpi_definitions, public.kpi_anchors, public.kpi_auto_thresholds FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.kpi_definitions, public.kpi_anchors, public.kpi_auto_thresholds TO authenticated;

-- Everyone in the company reads the criteria and every anchor, including the levels they
-- did not get. That is not a courtesy — it is the mechanism. An employee who cannot see
-- what "Exceeds" looks like has been given a grade and no way to act on it, and the
-- promise that they can fix it by the next evaluation is empty.
CREATE POLICY kpi_definitions_read ON public.kpi_definitions
  FOR SELECT TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid())));

CREATE POLICY kpi_definitions_write ON public.kpi_definitions
  FOR ALL TO authenticated
  USING (company_id = get_user_company_id((SELECT auth.uid()))
         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager'))
  WITH CHECK (company_id = get_user_company_id((SELECT auth.uid()))
              AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager'));

CREATE POLICY kpi_anchors_read ON public.kpi_anchors
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_definitions d
                  WHERE d.id = definition_id
                    AND d.company_id = get_user_company_id((SELECT auth.uid()))));

CREATE POLICY kpi_anchors_write ON public.kpi_anchors
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_definitions d
                  WHERE d.id = definition_id
                    AND d.company_id = get_user_company_id((SELECT auth.uid()))
                    AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM kpi_definitions d
                       WHERE d.id = definition_id
                         AND d.company_id = get_user_company_id((SELECT auth.uid()))
                         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')));

CREATE POLICY kpi_auto_thresholds_read ON public.kpi_auto_thresholds
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_definitions d
                  WHERE d.id = definition_id
                    AND d.company_id = get_user_company_id((SELECT auth.uid()))));

CREATE POLICY kpi_auto_thresholds_write ON public.kpi_auto_thresholds
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM kpi_definitions d
                  WHERE d.id = definition_id
                    AND d.company_id = get_user_company_id((SELECT auth.uid()))
                    AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM kpi_definitions d
                       WHERE d.id = definition_id
                         AND d.company_id = get_user_company_id((SELECT auth.uid()))
                         AND get_user_role((SELECT auth.uid())) IN ('super_admin', 'hr_manager')));

-- Nothing is seeded. A starter library would be this product guessing what a company
-- measures, and the anchors are the one thing that must be in the customer's own words —
-- they are what an employee is told they did wrong. Migration 42 adds the screen; the
-- first company to use it writes its own.
