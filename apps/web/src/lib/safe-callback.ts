/** Where sign-in leads when no (valid) return address is given. */
export const DEFAULT_AFTER_SIGN_IN = '/overview';

/**
 * The return address after sign-in, kept only when it is a path on this site.
 * Parsed the way a browser would (so `/\evil.test` or a tab-split `/\t/evil`
 * resolve to another host and are refused); returns path + query + hash.
 */
export function safeCallbackPath(value: string | string[] | undefined, appUrl: string): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_AFTER_SIGN_IN;
  try {
    const base = new URL(appUrl);
    const url = new URL(raw, base);
    if (url.origin !== base.origin) return DEFAULT_AFTER_SIGN_IN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
}
