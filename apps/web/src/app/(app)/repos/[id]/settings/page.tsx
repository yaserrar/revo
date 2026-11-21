import type { Metadata } from 'next';
import { RepoSettingsView } from '~/components/repos/repo-settings-view';

export const metadata: Metadata = { title: 'Repo settings' };

export default async function RepoSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RepoSettingsView id={id} />;
}
