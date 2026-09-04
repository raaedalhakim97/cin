// Features that are built but not switched on yet.
//
// Raaed, on payroll: "I might not add this feature to the demo app for less headache,
// postponed — I want to run the app without payroll at the beginning."
//
// So payroll is turned off here rather than deleted. Everything behind it still exists and
// still works — the tables, the maker-checker approval, the country bank files, the payslip
// PDF, the tests. Flipping this one constant to true brings the whole thing back with no
// code to rewrite, which is the difference between postponing a feature and losing it.
//
// What the flag hides: the sidebar entry, the /payroll route, the payroll tab on an
// employee's record, the payroll cards on the HR and operations dashboards, the "view
// payslip" shortcut, the manager-salary-visibility setting, and the payroll rows in the
// permissions matrix. What it does NOT touch: the database. No table is dropped and no
// row is deleted, so a company that starts without payroll and turns it on later keeps
// whatever history was already there.
//
// One thing this flag cannot do, and it is the reason finding 1 of the logic audit still
// stands: employees.basic_salary lives on the employee record, not in the payroll tables,
// so turning payroll off does not stop the auditor and operations roles reading salaries.
// That is a database fix, not a switch.

export const FEATURES = {
  payroll: false,
}
