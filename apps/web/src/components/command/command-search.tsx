'use client';

import { useCommandState } from 'cmdk';
import { Category2, Hierarchy, Setting2 } from 'iconsax-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CommandGroup, CommandItem } from '~/components/ui/command';
import { ScoreBadge } from '~/components/revo/score-badge';
import { usePullRequests } from '~/hooks/prs';
import { useRepos } from '~/hooks/repos';
import { useUiStore } from '~/store/ui.store';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * ⌘K groups for the dashboard: pull requests (searched on the server by
 * title or number; the latest ones when the box is empty) and repos.
 * Rendered inside the command list, so it mounts only while the menu is open.
 */
export function CommandSearch() {
  const router = useRouter();
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const search = useCommandState((s) => s.search).trim();
  const q = useDebounced(search, 200);
  const prs = usePullRequests({ q: q || undefined, pageSize: q ? 8 : 5, sort: 'lastReviewed', dir: 'desc' });
  const repos = useRepos();

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {prs.data && prs.data.items.length > 0 ? (
        <CommandGroup heading={q ? 'Pull requests' : 'Recent pull requests'}>
          {prs.data.items.map((p) => (
            <CommandItem
              key={p.id}
              value={`pr #${p.number} ${p.title} ${p.repo.fullName} ${p.author}`}
              onSelect={() => go(`/prs/${p.id}`)}
            >
              <Hierarchy className="size-4" />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="hidden shrink-0 font-mono text-[0.6875rem] text-muted-foreground sm:inline">
                {p.repo.fullName.split('/')[1]} #{p.number}
              </span>
              <ScoreBadge
                score={p.latestReview?.status === 'done' ? p.latestReview.score : null}
                className="shrink-0 scale-75"
              />
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      {repos.data && repos.data.items.length > 0 ? (
        <CommandGroup heading="Repos">
          {repos.data.items.map((r) => (
            <CommandItem
              key={r.id}
              value={`repo ${r.fullName} pull requests`}
              onSelect={() => go(`/prs?repo=${r.id}`)}
            >
              <Category2 className="size-4" />
              <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
              <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground">pull requests</span>
            </CommandItem>
          ))}
          {repos.data.items.map((r) => (
            <CommandItem
              key={`${r.id}-settings`}
              value={`settings ${r.fullName}`}
              onSelect={() => go(`/repos/${r.id}/settings`)}
            >
              <Setting2 className="size-4" />
              <span className="min-w-0 flex-1 truncate">{r.name} settings</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
    </>
  );
}
