/** "Install on GitHub" link for the App (spec 3.1), or null when the slug is not configured. */
export function installUrlFor(slug: string | undefined): string | null {
  return slug ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new` : null;
}
