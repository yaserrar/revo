import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactLine, LegalPage, LegalSection } from '~/components/marketing/legal-page';
import { SOURCE_URL } from '~/constants/site';
import { getSessionUser } from '~/server/auth/session';
import { env } from '~/server/config/env';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms of the hosted Revo: the free tier, your own API key, acceptable use.',
  robots: { index: true, follow: true },
};

export default async function TermsPage() {
  const signedIn = Boolean(await getSessionUser());
  return (
    <LegalPage
      eyebrow="Terms"
      title="Plain terms for the hosted Revo."
      intro="By installing the GitHub App or signing in, you accept these terms. They are short on purpose."
      signedIn={signedIn}
    >
      <LegalSection n="01" title="The free tier">
        <p>
          Each GitHub account gets {env.FREE_REVIEWS_PER_MONTH} free reviews a month on Claude Haiku and
          Sonnet, paid for by Revo. The free tier is best effort: it can pause when its monthly budget is
          spent, and its limits may change or end.
        </p>
      </LegalSection>

      <LegalSection n="02" title="Your own API key">
        <p>
          When an account saves its own Anthropic API key, its reviews run on that key. Anthropic bills the
          key&rsquo;s owner for that usage under Anthropic&rsquo;s own terms. Revo shows the cost of each
          review and applies each repository&rsquo;s monthly budget, but you remain responsible for the key
          and its spend.
        </p>
      </LegalSection>

      <LegalSection n="03" title="No warranty">
        <p>
          Revo is provided as is, without warranty of any kind. An AI review can miss problems or be wrong. It
          helps a human review; it does not replace one. Revo is not liable for damage caused by relying on
          its reviews or by an interruption of the service.
        </p>
      </LegalSection>

      <LegalSection n="04" title="Acceptable use">
        <ul>
          <li>Install Revo only on repositories you are allowed to share with GitHub and Anthropic.</li>
          <li>
            Do not use it to break the law, to attack Revo or others, or to get around the free tier&rsquo;s
            limits.
          </li>
          <li>Accounts that abuse the service may be blocked.</li>
        </ul>
        <p>
          How data is handled is in the <Link href="/privacy">privacy policy</Link>.
        </p>
      </LegalSection>

      <LegalSection n="05" title="Open source">
        <p>
          Revo&rsquo;s code is open source under the MIT license. You can run your own copy:{' '}
          <a href={SOURCE_URL}>source on GitHub</a>.
        </p>
      </LegalSection>

      <LegalSection n="06" title="Contact">
        <ContactLine email={env.CONTACT_EMAIL} issuesUrl={`${SOURCE_URL}/issues`} />
      </LegalSection>
    </LegalPage>
  );
}
