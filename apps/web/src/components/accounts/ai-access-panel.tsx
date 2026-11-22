'use client';

import { Crown1, Gift, Key, Monitor, Trash } from 'iconsax-react';
import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  EFFECTIVE_AI_ACCESS_LABELS,
  FREE_PAUSED_TEXT,
  freeLimitText,
  formatUtcDate,
  maskedKey,
  SUBSCRIPTION_TERMS_NOTE,
  type EffectiveAiAccess,
} from '@revo/shared';
import { Meter } from '~/components/revo/stat-card';
import { ErrorState } from '~/components/shared/error-state';
import { UserAvatar } from '~/components/shared/user-avatar';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useAccounts, useRemoveAnthropicKey, useSetAiAccess } from '~/hooks/accounts';
import { formatDateTime } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { AccountAiAccessDto } from '~/types/account';
import { AnthropicKeyDialog } from './anthropic-key-dialog';

const ACCESS_ICON: Record<EffectiveAiAccess, ComponentType<{ className?: string }>> = {
  free: Gift,
  owner: Crown1,
  own_key: Key,
  subscription: Monitor,
};

function Note({
  tone = 'neutral',
  id,
  children,
}: {
  tone?: 'neutral' | 'warn' | 'bad';
  id?: string;
  children: ReactNode;
}) {
  return (
    <p
      id={id}
      className={cn(
        'rounded-2xl px-3.5 py-2.5 text-sm',
        tone === 'neutral' && 'bg-paper-sunken text-ink-soft',
        tone === 'warn' && 'bg-warn-soft text-warn-ink',
        tone === 'bad' && 'bg-bad-soft text-bad-ink',
      )}
    >
      {children}
    </p>
  );
}

function FreeTierUsage({ account }: { account: AccountAiAccessDto }) {
  const free = account.freeTier!;
  const resets = formatUtcDate(new Date(free.resetsAt));
  const usedUp = free.used >= free.limit;
  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        <p className="flex items-baseline gap-2">
          {/* Runs from before the free tier existed can push the count past the limit. */}
          <span className="display tabular text-4xl leading-none">{Math.min(free.used, free.limit)}</span>
          <span className="text-sm text-muted-foreground">of {free.limit} free reviews used this month</span>
        </p>
        <Meter
          value={Math.min(free.used, free.limit)}
          max={free.limit}
          kind="budget"
          label={`Free reviews used by ${account.installation.accountLogin} this month`}
        />
        <p className="font-mono text-[0.6875rem] text-muted-foreground">
          Resets on {resets} · Haiku and Sonnet only
        </p>
      </div>
      {usedUp ? (
        <Note tone="bad">{freeLimitText(account.installation.accountLogin, new Date(free.resetsAt))}</Note>
      ) : free.paused ? (
        <Note tone="warn">{FREE_PAUSED_TEXT}</Note>
      ) : null}
    </div>
  );
}

function AccessBody({
  account,
  subscriptionAllowed,
}: {
  account: AccountAiAccessDto;
  subscriptionAllowed: boolean;
}) {
  switch (account.effective) {
    case 'free':
      return <FreeTierUsage account={account} />;
    case 'owner':
      return (
        <p className="text-sm text-muted-foreground">
          An owner account of this server: reviews use Revo&rsquo;s key with no free-tier limits.
        </p>
      );
    case 'own_key':
      return (
        <div className="space-y-2">
          <p className="font-mono text-lg tracking-tight">{maskedKey(account.keyHint ?? '')}</p>
          <p className="text-sm text-muted-foreground">
            Every model, no Revo limits. Anthropic bills the key&rsquo;s owner; each repo&rsquo;s monthly
            budget still applies.
          </p>
        </div>
      );
    case 'subscription':
      return (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Reviews run through Claude Code with the Claude subscription logged in on the machine running
            Revo. Tokens are recorded; the cost shows as $0.
          </p>
          {subscriptionAllowed ? <Note>{SUBSCRIPTION_TERMS_NOTE}.</Note> : null}
        </div>
      );
  }
}

function RemoveKeyDialog({ account }: { account: AccountAiAccessDto }) {
  const remove = useRemoveAnthropicKey(account.installation.id);
  const login = account.installation.accountLogin;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-bad-ink hover:text-bad-ink">
          <Trash className="size-4" />
          Remove key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="display text-3xl font-normal">Remove the API key?</DialogTitle>
          <DialogDescription>
            Revo deletes {maskedKey(account.keyHint ?? '')} for {login}.
            {account.effective === 'own_key'
              ? ' Reviews go back to the free tier: Haiku and Sonnet, with a monthly limit.'
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep it</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(undefined, {
                  onSuccess: () =>
                    toast.success('Key removed', { description: `${login} is on the free tier.` }),
                })
              }
            >
              Remove key
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Actions({
  account,
  subscriptionAllowed,
}: {
  account: AccountAiAccessDto;
  subscriptionAllowed: boolean;
}) {
  const setAccess = useSetAiAccess(account.installation.id);
  const login = account.installation.accountLogin;
  const offerSubscription = subscriptionAllowed && account.effective !== 'subscription';
  const termsId = `subscription-terms-${account.installation.id}`;
  const change = (aiAccess: 'free' | 'own_key' | 'subscription', title: string) =>
    setAccess.mutate(
      { aiAccess },
      { onSuccess: () => toast.success(title, { description: `For ${login}.` }) },
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AnthropicKeyDialog
          installationId={account.installation.id}
          accountLogin={login}
          replacing={account.keyHint}
          trigger={
            <Button variant={account.keyHint ? 'outline' : 'accent'} size="sm">
              <Key className="size-4" />
              {account.keyHint ? 'Replace key' : 'Add API key'}
            </Button>
          }
        />
        {account.keyHint && account.effective !== 'own_key' ? (
          <Button
            variant="outline"
            size="sm"
            disabled={setAccess.isPending}
            onClick={() => change('own_key', 'Using your API key')}
          >
            Use saved key
          </Button>
        ) : null}
        {offerSubscription ? (
          <Button
            variant="outline"
            size="sm"
            disabled={setAccess.isPending}
            aria-describedby={termsId}
            onClick={() => change('subscription', 'Using the Claude subscription')}
          >
            <Monitor className="size-4" />
            Use Claude subscription
          </Button>
        ) : null}
        {account.effective === 'subscription' ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={setAccess.isPending}
            onClick={() => change('free', 'Back on the free tier')}
          >
            Use free tier
          </Button>
        ) : null}
        {account.keyHint ? <RemoveKeyDialog account={account} /> : null}
      </div>
      {/* Anthropic's terms go with the option, before anyone switches to it. */}
      {offerSubscription ? <Note id={termsId}>{SUBSCRIPTION_TERMS_NOTE}.</Note> : null}
    </div>
  );
}

function AccountCard({
  account,
  subscriptionAllowed,
}: {
  account: AccountAiAccessDto;
  subscriptionAllowed: boolean;
}) {
  const { installation } = account;
  const Icon = ACCESS_ICON[account.effective];
  const unusedKey = account.keyHint && account.effective !== 'own_key';
  const subscriptionOff = account.aiAccess === 'subscription' && !subscriptionAllowed;
  return (
    <li className="flex min-w-0 flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar login={installation.accountLogin} src={installation.accountAvatarUrl} />
          <div className="min-w-0">
            <p className="truncate font-medium">{installation.accountLogin}</p>
            <p className="eyebrow text-[0.625rem]">
              {installation.accountType === 'Organization' ? 'Organisation' : 'Account'}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-brand-soft px-3 py-1 text-xs font-medium text-accent-brand-ink">
          <Icon className="size-3.5" />
          {EFFECTIVE_AI_ACCESS_LABELS[account.effective]}
        </span>
      </div>

      <AccessBody account={account} subscriptionAllowed={subscriptionAllowed} />

      {unusedKey ? <Note>A saved key ({maskedKey(account.keyHint!)}) is not in use.</Note> : null}
      {subscriptionOff ? (
        <Note tone="warn">This server does not offer the Claude subscription, so the free tier is used.</Note>
      ) : null}

      <div className="mt-auto space-y-3 border-t border-border pt-4">
        {account.canEdit ? (
          <Actions account={account} subscriptionAllowed={subscriptionAllowed} />
        ) : (
          <p className="text-sm text-muted-foreground">
            View only. Changing this needs the Admin role on one of {installation.accountLogin}&rsquo;s repos
            on GitHub.
          </p>
        )}
        {account.updatedAt ? (
          <p className="font-mono text-[0.6875rem] text-muted-foreground">
            Changed {formatDateTime(account.updatedAt)}
            {account.updatedBy ? ` by ${account.updatedBy}` : ''}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Links to /repos#ai-access land before the accounts (and the repo list above
 * them) have loaded, when the section is short and higher up. Once the data is
 * there, scroll to it again, once per visit.
 */
function useScrollToHashOnce(id: string, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    if (window.location.hash !== `#${id}`) return;
    // After this render's layout, so the lists above have their final height.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  }, [id, ready]);
}

/**
 * "AI access" on the Repos page: per GitHub account, who pays for Claude
 * (Revo's free tier, the account's own Anthropic key, or the Claude
 * subscription where the server offers it), with the free-tier usage.
 */
export function AiAccessPanel() {
  const { data, isPending, isError, error, refetch } = useAccounts();
  // Ready once every list on the page has loaded (the repo list above sets where the section sits).
  const fetching = useIsFetching();
  useScrollToHashOnce('ai-access', data !== undefined && fetching === 0);
  if (isPending)
    return (
      <div aria-busy="true" aria-label="Loading AI access" className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} />;
  if (data.items.length === 0) return null;

  return (
    <section aria-labelledby="ai-access-title" className="space-y-5">
      <div className="max-w-2xl space-y-2">
        <p className="eyebrow">AI access</p>
        <h2 id="ai-access-title" className="display text-3xl">
          Who pays for Claude
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">
          Every account starts on Revo&rsquo;s free tier: {data.freeReviewsPerMonth} reviews a month on Haiku
          or Sonnet. Add your own Anthropic API key for unlimited reviews on every model.
        </p>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {data.items.map((account) => (
          <AccountCard
            key={account.installation.id}
            account={account}
            subscriptionAllowed={data.subscriptionAllowed}
          />
        ))}
      </ul>
    </section>
  );
}
