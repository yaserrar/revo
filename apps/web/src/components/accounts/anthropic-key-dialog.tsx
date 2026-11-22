'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Key, Refresh } from 'iconsax-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { maskedKey } from '@revo/shared';
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
import { Input } from '~/components/ui/input';
import { useSaveAnthropicKey } from '~/hooks/accounts';
import { AnthropicKeyBodySchema, type AnthropicKeyBody } from '~/schemas/ai-access';
import { ApiError } from '~/services/api/client';

const CONSOLE_KEYS_URL = 'https://platform.claude.com/settings/keys';

/**
 * Add or replace an account's Anthropic API key. The server checks it with
 * Anthropic before saving; the field is cleared on close and the key is never
 * shown again (only its last 4 characters).
 */
export function AnthropicKeyDialog({
  installationId,
  accountLogin,
  replacing,
  trigger,
}: {
  installationId: string;
  accountLogin: string;
  /** Last 4 characters of the key being replaced. */
  replacing: string | null;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const save = useSaveAnthropicKey(installationId);
  const form = useForm<AnthropicKeyBody>({
    resolver: zodResolver(AnthropicKeyBodySchema),
    defaultValues: { apiKey: '' },
  });
  const fieldError = form.formState.errors.apiKey?.message;
  const serverError =
    save.error instanceof ApiError
      ? (save.error.issues?.[0]?.message ?? save.error.message)
      : save.error
        ? 'Something went wrong. Try again.'
        : null;
  const error = fieldError ?? serverError;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      form.reset({ apiKey: '' });
      save.reset();
    }
  };

  const onSubmit = form.handleSubmit((body) =>
    save.mutate(body, {
      onSuccess: (account) => {
        onOpenChange(false);
        toast.success('Key saved', {
          description: `Reviews for ${accountLogin} now use ${maskedKey(account.keyHint ?? '')}, billed by Anthropic to the key's owner.`,
        });
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-6">
          <DialogHeader>
            <span className="mb-1 grid size-10 place-items-center rounded-full bg-accent-brand-soft text-accent-brand-ink">
              <Key className="size-5" />
            </span>
            <DialogTitle className="display text-3xl font-normal">
              {replacing ? 'Replace the API key' : 'Use your own API key'}
            </DialogTitle>
            <DialogDescription>
              Reviews for <span className="font-medium text-foreground">{accountLogin}</span> then run on your
              Anthropic account: every model, no free-tier limits. Each repo&rsquo;s monthly budget still
              applies.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <label htmlFor="anthropic-key" className="text-sm font-medium">
              Anthropic API key
            </label>
            <Input
              id="anthropic-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'anthropic-key-error anthropic-key-help' : 'anthropic-key-help'}
              className="h-10 font-mono"
              {...form.register('apiKey', { onChange: () => save.isError && save.reset() })}
            />
            {error ? (
              <p id="anthropic-key-error" role="alert" className="text-sm text-bad-ink">
                {error}
              </p>
            ) : null}
            <p id="anthropic-key-help" className="text-xs leading-relaxed text-muted-foreground">
              Revo checks it once with Anthropic, then stores it encrypted. It is never shown again, only its
              last 4 characters.{' '}
              <a
                href={CONSOLE_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-accent-brand-ink underline-offset-4 hover:underline"
              >
                Create a key
              </a>
              {replacing ? <> The current key ({maskedKey(replacing)}) is replaced.</> : null}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="accent" disabled={save.isPending}>
              {save.isPending ? <Refresh className="size-4 animate-spin" /> : null}
              {save.isPending ? 'Checking…' : 'Check and save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
