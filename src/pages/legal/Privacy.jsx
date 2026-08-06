import LegalPage from './LegalPage'

// Written against the actual schema, not from a template.
//
// Every category listed below was read off information_schema for this project:
// employees (national_id, iban, bank_account, basic_salary, labour_card_number),
// attendance (clock_in_lat/lng, clock_out_lat/lng, distances), hr_documents,
// audit_logs, user_sessions, login_attempts, demo_requests. If a column is
// added that collects something new, this page is part of the change.
//
// Framed for UAE Federal Decree-Law 45/2021 (PDPL): BYOND is the processor and
// the employer is the controller, which is what actually determines who owes
// the data subject a response.

const CONTACT = 'privacy@byondhr.com'

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="6 August 2026">
      <p>
        BYOND is an HR platform operated by SERVA, Dubai, United Arab Emirates. This policy explains what
        personal data the platform holds, why, and what you can do about it. It is written to align with
        UAE Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL).
      </p>

      <h2>Who is responsible for your data</h2>
      <p>
        If you are an employee using BYOND, <strong>your employer is the data controller</strong>. They decide
        what is collected about you and why. BYOND is the <strong>processor</strong>: we operate the software and
        store the data on their instruction.
      </p>
      <p>
        This matters when you want something done. Requests to see, correct or delete your employment records
        should go to your employer&apos;s HR team first — they hold the authority to act on them. We support them
        in carrying it out, and you can contact us directly if they do not respond.
      </p>

      <h2>What the platform collects</h2>

      <h3>Identity and employment records</h3>
      <ul>
        <li>Name, work email, phone number and profile photo</li>
        <li>Emirates ID number and labour card number</li>
        <li>Job title, department, contract type and dates, probation and hire dates</li>
        <li>Basic salary, allowances, bank account details and IBAN</li>
        <li>Documents uploaded by you or your employer — passports, visas, contracts, certificates</li>
      </ul>
      <p>
        Salary and bank details exist to run payroll and produce WPS files. Emirates ID and labour card
        numbers exist because UAE employment records require them.
      </p>

      <h3>Attendance and location</h3>
      <p>
        When you clock in or out, BYOND records the time and, where your employer has enabled it,
        <strong> the GPS coordinates of that moment and the distance to the assigned work location</strong>.
      </p>
      <p>
        Two things about this are worth stating plainly. It captures a location <em>at the instant you punch</em> —
        the platform does not track your position continuously, in the background, or outside working hours.
        And your employer chooses whether to enforce it at all; where geofencing is off, coordinates are recorded
        but no punch is refused for being out of range.
      </p>

      <h3>Leave, performance and conduct</h3>
      <ul>
        <li>Leave requests, including the reason you give and the approval decision</li>
        <li>KPI scores, quarterly self-assessments, manager assessments and review comments</li>
        <li>Recognition awards and any warnings recorded against you</li>
      </ul>

      <h3>Security and technical records</h3>
      <ul>
        <li>Sign-in attempts, successful and failed, with IP address and browser</li>
        <li>Active sessions and device information</li>
        <li>An audit log of changes to records, including who made each change and when</li>
      </ul>
      <p>
        The audit log exists to protect you as much as your employer: it is what makes an altered attendance
        record or a changed salary figure traceable to a person.
      </p>

      <h3>If you contact us about buying BYOND</h3>
      <p>
        Demo requests store the company name, your name, work email, phone, country, headcount and any message
        you write. This is used to respond to you and for nothing else.
      </p>

      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell personal data, and we do not share it with advertisers</li>
        <li>We do not use your data to train machine learning models</li>
        <li>We do not read your documents or messages except where necessary to operate or support the service</li>
        <li>We do not track location outside of a clock-in or clock-out event</li>
      </ul>

      <h2>Where your data is stored</h2>
      <p>
        BYOND runs on Supabase, which hosts the database and file storage. Data is currently stored in the
        <strong> Asia Pacific (Mumbai) region</strong>. Under the PDPL, transfers outside the UAE require an
        adequate level of protection in the destination jurisdiction or appropriate contractual safeguards.
      </p>
      <p>
        We state the region here rather than leaving it vague because an employer processing Emirates ID
        numbers and salaries needs to know it in order to meet their own obligations.
      </p>

      <h2>How long it is kept</h2>
      <p>
        Employment records are retained for as long as you are employed and afterwards for the period UAE
        labour and tax law requires. Attendance, leave and payroll records are kept on the same basis. Sign-in
        and audit records are kept for security investigation. When your employer deletes an employee record,
        associated personal data is removed or anonymised.
      </p>

      <h2>Your rights</h2>
      <p>Under the PDPL you may:</p>
      <ul>
        <li>Ask what personal data is held about you and receive a copy</li>
        <li>Have inaccurate data corrected</li>
        <li>Ask for data to be deleted, where no legal obligation requires keeping it</li>
        <li>Object to or restrict certain processing</li>
        <li>Withdraw consent where processing relies on consent</li>
      </ul>
      <p>
        BYOND includes an export function so your employer can produce your full record, and an anonymisation
        function for when a record must be erased. Start with your HR team; if you cannot get a response,
        write to us at <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Security</h2>
      <p>
        Access is enforced in the database itself rather than only in the application, so a person can only read
        the records their role permits. Traffic is encrypted in transit. Sign-in attempts are rate-limited, and
        changes to sensitive records are written to an audit log that the people being audited cannot erase.
      </p>
      <p>
        No system is perfectly secure, and we would rather say so than imply otherwise. If you believe an account
        or record has been compromised, contact us immediately.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        If what we collect changes, this page changes with it and the date at the top is updated. Material
        changes affecting employees will be communicated to the employer operating your workspace.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy, or about data held on you:{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>, or write to BYOND by SERVA, Dubai, United Arab Emirates.
      </p>
    </LegalPage>
  )
}
