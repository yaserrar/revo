import type { Metadata } from 'next';
import { ContactLine, LegalPage, LegalSection } from '~/components/marketing/legal-page';
import { SOURCE_URL } from '~/constants/site';
import { getSessionUser } from '~/server/auth/session';
import { env } from '~/server/config/env';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Revo receives, what it stores, for how long, and who processes it.',
  robots: { index: true, follow: true },
};

export default async function PrivacyPage() {
  const signedIn = Boolean(await getSessionUser());
  return (
    <LegalPage
      eyebrow="Privacy"
      title="What Revo sees, and what it keeps."
      intro="Revo reviews pull requests for the GitHub accounts that install it. This page covers the hosted Revo; if you run Revo on your own server, you decide all of this."
      signedIn={signedIn}
    >
      <LegalSection n="01" title="What Revo receives">
        <ul>
          <li>
            <strong>Pull requests</strong> of the repositories you give the GitHub App: their diffs, title and
            description, and the files Revo needs for context (the changed files and the code they import or
            call). They are sent to Anthropic&rsquo;s Claude only to review that pull request.
          </li>
          <li>
            <strong>Your GitHub profile</strong> when you sign in: login, name and avatar, and which of the
            App&rsquo;s repositories you can access and with which role.
          </li>
        </ul>
      </LegalSection>

      <LegalSection n="02" title="What Revo stores">
        <ul>
          <li>
            Pull request details: number, title, description, author (login and avatar), branches, state and
            commits reviewed.
          </li>
          <li>
            Review results: findings, scores, code excerpts of at most 30 lines around each finding, token
            counts and costs, and the feedback you give (&ldquo;Useful&rdquo; or &ldquo;Wrong&rdquo;, with an
            optional note).
          </li>
          <li>
            Secrets, encrypted (AES-256-GCM): your GitHub sign-in token and, if an account adds one, its
            Anthropic API key. Only the key&rsquo;s last 4 characters are kept in clear, to show which key is
            saved.
          </li>
        </ul>
        <p>Revo never stores whole files or whole repositories.</p>
      </LegalSection>

      <LegalSection n="03" title="How long">
        <p>
          Review data is kept while the GitHub App is installed on the account. Uninstalling the App deletes
          that account&rsquo;s repositories, pull requests, reviews, findings, feedback, costs and saved API
          key.
        </p>
        <p>
          One thing stays after an uninstall: a usage counter for the free tier, so its monthly limits still
          apply. Per free review it holds the GitHub account&rsquo;s id and login, the cost and the date, with
          no code and no review content, and it is deleted once the following month ends.
        </p>
      </LegalSection>

      <LegalSection n="04" title="Who processes it">
        <ul>
          <li>
            <strong>GitHub</strong>: sign-in, repository access, and where reviews are posted.
          </li>
          <li>
            <strong>Anthropic</strong>: runs the reviews. With your own API key, the request goes to Anthropic
            under your account.
          </li>
          <li>
            <strong>Amazon Web Services (AWS)</strong>: hosts the server and the database.
          </li>
          <li>
            <strong>PostHog</strong>: anonymous page analytics, without session recordings, page text or query
            strings.
          </li>
        </ul>
        <p>Nothing is sold or shared with anyone else.</p>
      </LegalSection>

      <LegalSection n="05" title="Contact">
        <ContactLine email={env.CONTACT_EMAIL} issuesUrl={`${SOURCE_URL}/issues`} />
      </LegalSection>
    </LegalPage>
  );
}
