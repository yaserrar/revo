// Product analytics (PostHog). Off when NEXT_PUBLIC_POSTHOG_KEY is not set at
// build time, so local dev, the e2e build and anyone self-hosting without a key
// send nothing.
//
// Events go through /ingest on Revo's own domain (rewritten to PostHog in
// next.config.ts), so ad blockers don't drop them. The library loads after the
// page, in its own chunk.
//
// The dashboard shows other people's code, pull request titles and repo names,
// so none of it leaves the browser: no session recordings, no element text or
// attributes in autocaptured clicks, and no query strings in URLs (filters and
// searches). Pages are identified by their path, whose ids say nothing.

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/** `https://revo.example.com/prs?q=fix` → `https://revo.example.com/prs`. */
function withoutQuery(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

if (key) {
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init(key, {
      api_host: '/ingest',
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || 'https://us.posthog.com',
      // Pageviews on client-side navigation too, page leaves, autocaptured clicks.
      defaults: '2026-08-30',
      // Visitors are anonymous: no person profiles until someone is identified.
      person_profiles: 'identified_only',
      disable_session_recording: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      before_send: (event) => {
        if (!event) return event;
        for (const name of [
          '$current_url',
          '$referrer',
          '$prev_pageview_url',
          '$prev_pageview_pathname',
          '$pathname',
        ]) {
          if (name in event.properties) event.properties[name] = withoutQuery(event.properties[name]);
        }
        return event;
      },
    });
  });
}
