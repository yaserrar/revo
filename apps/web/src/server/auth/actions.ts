'use server';

import { redirect } from 'next/navigation';
import { DEFAULT_AFTER_SIGN_IN } from '~/lib/safe-callback';
import { signIn } from '~/server/auth/auth';
import { githubSignInEnabled } from '~/server/config/env';

/**
 * Starts the GitHub sign-in straight from a public page (one click, no stop on
 * /sign-in). Without GitHub credentials configured, /sign-in explains what is missing.
 */
export async function signInWithGithub() {
  if (!githubSignInEnabled) redirect('/sign-in');
  await signIn('github', { redirectTo: DEFAULT_AFTER_SIGN_IN });
}
