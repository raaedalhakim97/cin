import LegalPage from './LegalPage'

// Terms for the SaaS subscription itself — the agreement between BYOND and the
// employer who signs up. Employee-facing data questions belong in Privacy.
//
// Written against what the product actually does today: a 14-day trial created
// by self_onboard_company, no billing integration yet, no uptime guarantee, and
// backups not yet installed. Where a commitment has not been built, this says
// so rather than promising it.

const CONTACT = 'legal@byondhr.com'
const SUPPORT = 'support@byondhr.com'

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="6 August 2026">
      <p>
        These terms govern use of BYOND, an HR platform operated by SERVA, Dubai, United Arab Emirates
        (&quot;BYOND&quot;, &quot;we&quot;). They form an agreement between BYOND and the organisation that
        creates a workspace (&quot;you&quot;, &quot;the Customer&quot;).
      </p>
      <p>
        If you are an employee using BYOND because your employer provides it, these terms describe the
        arrangement between us and them. How your personal data is handled is set out in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>1. The service</h2>
      <p>
        BYOND provides employee records, attendance and leave management, payroll preparation including WPS
        file generation, KPI scoring and performance review cycles, delivered as a web application and a mobile
        app.
      </p>
      <p>
        We may add, change or remove features. Where a change removes something you rely on, we will give
        reasonable notice.
      </p>

      <h2>2. Free trial</h2>
      <p>
        New workspaces created through self-signup begin a <strong>14-day free trial</strong>. No payment card
        is required to start it. At the end of the trial you may subscribe to continue; if you do not, access to
        the workspace is suspended.
      </p>
      <p>
        Suspension is not deletion. Contact us before your data is removed if you need to export it.
      </p>

      <h2>3. Your account and your people</h2>
      <p>You are responsible for:</p>
      <ul>
        <li>Keeping account credentials secure, and for activity under your workspace</li>
        <li>The accuracy of the employee data you enter</li>
        <li>Having a lawful basis to process the personal data of your employees in BYOND</li>
        <li>Telling your employees that you use BYOND, and what it records — including location at clock-in, where you enable it</li>
      </ul>
      <p>
        That last point is yours, not ours. You are the data controller for your employees&apos; records; we
        process them on your instruction.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You may not use BYOND to:</p>
      <ul>
        <li>Break any applicable law, including UAE labour and data protection law</li>
        <li>Monitor people covertly, or in ways you have not disclosed to them</li>
        <li>Attempt to access another organisation&apos;s workspace or data</li>
        <li>Probe, scan or test the security of the service without our written permission</li>
        <li>Resell or white-label the service without an agreement with us</li>
      </ul>

      <h2>5. What BYOND does not decide for you</h2>
      <p>
        BYOND computes KPI scores, flags attendance patterns and proposes recognition and warnings. These are
        inputs to your decisions, not decisions in themselves.
      </p>
      <p>
        The platform will not issue disciplinary action on its own — warnings are surfaced to your HR team for a
        human to act on, because UAE labour law grants an employee the right to be heard. Employment decisions,
        and their compliance with law and with your own policies, remain yours.
      </p>

      <h2>6. Availability</h2>
      <p>
        We work to keep BYOND available and will give notice of planned maintenance where we can. We do{' '}
        <strong>not currently offer a contractual uptime guarantee or service credits</strong>. If you need one,
        talk to us before you commit to the platform rather than after.
      </p>

      <h2>7. Your data</h2>
      <p>
        The data you put into BYOND remains yours. We claim no ownership of it and do not use it to train
        machine learning models.
      </p>
      <p>
        You can export employee records from within the platform at any time. On termination you may request an
        export; we will provide it in a machine-readable format within a reasonable period, after which the
        workspace and its data may be deleted.
      </p>

      <h2>8. Fees</h2>
      <p>
        Subscription fees, billing period and payment terms are those agreed in writing when you subscribe.
        Fees are exclusive of VAT unless stated otherwise. We will give at least 30 days&apos; notice of a price
        change affecting a renewal.
      </p>

      <h2>9. Termination</h2>
      <p>
        You may stop using BYOND and close your workspace at any time. We may suspend or terminate access if you
        materially breach these terms, do not pay, or use the service in a way that endangers other customers or
        the platform — with notice and an opportunity to fix it, except where the breach is serious enough that
        waiting would cause harm.
      </p>

      <h2>10. Liability</h2>
      <p>
        BYOND is provided without warranties beyond those that cannot lawfully be excluded. To the extent
        permitted by law, our total liability arising out of or in connection with these terms is limited to the
        fees you paid in the twelve months before the claim.
      </p>
      <p>
        We are not liable for indirect or consequential loss, including lost profits, lost business or loss of
        data where you have not maintained your own export. Nothing here excludes liability that cannot be
        excluded under UAE law.
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We may update these terms. For material changes we will give notice to workspace administrators before
        they take effect. Continuing to use BYOND after that means you accept the updated terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These terms are governed by the laws of the United Arab Emirates, and the courts of Dubai have exclusive
        jurisdiction over any dispute.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. For help using the platform:{' '}
        <a href={`mailto:${SUPPORT}`}>{SUPPORT}</a>.
      </p>
    </LegalPage>
  )
}
