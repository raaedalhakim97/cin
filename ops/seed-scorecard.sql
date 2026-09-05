-- Starter scorecard for a new company.
--
-- OPTIONAL. This is content, not schema — no migration depends on it, and a company that
-- writes its own criteria from the Criteria screen never needs to run it.
--
-- It exists because the KPI system ships deliberately empty. Nothing is seeded by the
-- migrations: a starter library would be this product guessing what a company measures,
-- and the level sentences are the one thing that has to be in the customer's own words,
-- because they are what a person is told about their work. But an empty library also means
-- the Evaluation screen shows nothing at all until somebody has written twenty-five
-- sentences, which is a poor way to meet a product. So: a first draft, in the box, meant
-- to be edited rather than accepted.
--
-- ── How to run ─────────────────────────────────────────────────────────────
--
--   psql "$PGURL" -v company="'<company-uuid>'" -v owner="'<owner-user-uuid>'" \
--        -f ops/seed-scorecard.sql
--
-- The owner uuid is an auth user id belonging to a super_admin of that company. It is
-- needed because approving a scorecard is an owner's act and the transition trigger checks
-- who is asking — the same rule a person clicking the button goes through.
--
-- Safe to re-run: the criteria are keyed on (company_id, code) and skipped if present.
-- It will NOT create a second template on a second run; check before re-running if you
-- have edited the first one.
--
-- ── What it creates ────────────────────────────────────────────────────────
--
--   5 criteria, 25 level sentences
--   1 scorecard "General Scorecard", weighted 30/25/20/15/10, taken to approved
--   1 active assignment per active employee
--
-- It does NOT open a review cycle. That is HR's decision about a real quarter, and opening
-- one writes a review for every employee — not something a seed script should do behind
-- somebody's back.
--
-- ── On the sentences themselves ────────────────────────────────────────────
--
-- They describe behaviour, not character. "Work is regularly returned for rework" is
-- something an employee can argue with, act on, and be shown evidence for. "Poor attitude"
-- is not. That is the whole reason the levels carry sentences instead of numbers, and it is
-- worth keeping when these get edited.

BEGIN;

-- The approval chain reads auth.uid(), so the script has to say who is running it.
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :owner, 'role', 'authenticated')::text, true);

INSERT INTO kpi_definitions (company_id, code, name, description, category, sort_order) VALUES
  (:company,'quality','Quality of Work',
   'Accuracy and finish of the work itself.','quality',1),
  (:company,'reliability','Reliability',
   'Being where you said you would be, and warning people when you cannot.','behaviour',2),
  (:company,'teamwork','Teamwork',
   'How the work of the people around them goes.','behaviour',3),
  (:company,'care','Customer and Colleague Care',
   'How people are treated, inside and outside the company.','behaviour',4),
  (:company,'initiative','Initiative and Ownership',
   'What happens to a problem nobody assigned.','leadership',5)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO kpi_anchors (definition_id, level, comment)
SELECT d.id, v.level, v.comment
FROM kpi_definitions d
JOIN (VALUES
  ('quality',1,'Work is regularly returned for rework; mistakes reach the customer.'),
  ('quality',2,'Needs checking more often than the role should require; small errors repeat.'),
  ('quality',3,'Meets the agreed standard with normal supervision; errors are rare and caught.'),
  ('quality',4,'Needs no rework; others reuse their work as a reference.'),
  ('quality',5,'Sets the standard others are trained against.'),

  ('reliability',1,'Frequently absent or late without warning; the team plans around it.'),
  ('reliability',2,'Late or absent often enough that others cover; warns after the fact.'),
  ('reliability',3,'Present and on time; tells the manager in advance when something changes.'),
  ('reliability',4,'Consistently prepared early; covers gaps without being asked.'),
  ('reliability',5,'The person the schedule is built around; never leaves a shift uncovered.'),

  ('teamwork',1,'Works around colleagues; disputes need a manager to settle.'),
  ('teamwork',2,'Does their own part but leaves problems for the next person.'),
  ('teamwork',3,'Reliable in a team; asks for help before something is late.'),
  ('teamwork',4,'Actively unblocks other people''s work; shares what they know.'),
  ('teamwork',5,'Makes the team better — new people get up to speed faster because of them.'),

  ('care',1,'Complaints result from how they handle people.'),
  ('care',2,'Correct but cold; customers ask for someone else.'),
  ('care',3,'Handles people politely and follows the process.'),
  ('care',4,'Turns difficult situations around; customers ask for them by name.'),
  ('care',5,'Sets the tone others copy; brings back customers the company had lost.'),

  ('initiative',1,'Waits to be told; problems are reported, not solved.'),
  ('initiative',2,'Does what is asked, nothing beyond it.'),
  ('initiative',3,'Solves problems in their own area without being chased.'),
  ('initiative',4,'Improves how the work is done and brings the idea, not just the complaint.'),
  ('initiative',5,'Takes on problems nobody assigned them and closes them.')
) AS v(code, level, comment) ON v.code = d.code
WHERE d.company_id = :company
  AND NOT EXISTS (SELECT 1 FROM kpi_anchors a
                   WHERE a.definition_id = d.id AND a.level = v.level);

-- The scorecard. Weights total 100 because the chain refuses to accept anything else.
WITH t AS (
  INSERT INTO kpi_templates (company_id, name, description)
  VALUES (:company, 'General Scorecard',
          'The standard five criteria every role is measured on. Departments can be given their own scorecard later.')
  RETURNING id
)
INSERT INTO kpi_template_lines (template_id, definition_id, weight)
SELECT t.id, d.id, v.weight
FROM t
JOIN (VALUES ('quality',30),('reliability',25),('teamwork',20),('care',15),('initiative',10))
  AS v(code, weight) ON true
JOIN kpi_definitions d ON d.code = v.code AND d.company_id = :company;

-- Through the chain rather than around it: submitted, then approved by the owner. The
-- trigger stamps both signatures and refuses if the weights do not total 100.
UPDATE kpi_templates SET status = 'pending_hr'
 WHERE company_id = :company AND name = 'General Scorecard' AND status = 'draft';
UPDATE kpi_templates SET status = 'approved'
 WHERE company_id = :company AND name = 'General Scorecard' AND status = 'pending_hr';

-- Everyone active gets it. Nobody has to be reviewed against nothing.
INSERT INTO employee_scorecards (company_id, employee_id, template_id, assigned_by)
SELECT :company, e.id, t.id, (SELECT id FROM employees WHERE user_id = :owner LIMIT 1)
  FROM employees e
  CROSS JOIN (SELECT id FROM kpi_templates
               WHERE company_id = :company AND name = 'General Scorecard' LIMIT 1) t
 WHERE e.company_id = :company
   AND e.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM employee_scorecards s
                    WHERE s.employee_id = e.id AND s.status <> 'archived');

COMMIT;
