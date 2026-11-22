import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '~/lib/query-keys';
import type { AiAccessBody, AnthropicKeyBody } from '~/schemas/ai-access';
import { accountsApi } from '~/services/api/accounts';
import type { AccountAiAccessDto, AccountsDto } from '~/types/account';

export const useAccounts = () => useQuery({ queryKey: qk.accounts(), queryFn: accountsApi.list });

/** Puts the saved account in the list, then refreshes what depends on who pays (settings, PR detail). */
function useAccountUpdate() {
  const qc = useQueryClient();
  return {
    onSuccess: (account: AccountAiAccessDto) =>
      qc.setQueryData<AccountsDto>(qk.accounts(), (list) =>
        list
          ? {
              ...list,
              items: list.items.map((a) => (a.installation.id === account.installation.id ? account : a)),
            }
          : list,
      ),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.accounts() });
      void qc.invalidateQueries({ queryKey: qk.repos.all() });
      void qc.invalidateQueries({ queryKey: qk.prs.all() });
    },
  };
}

/** Errors show in the dialog, not as a toast. */
export const useSaveAnthropicKey = (id: string) =>
  useMutation({
    mutationFn: (body: AnthropicKeyBody) => accountsApi.saveKey(id, body),
    meta: { silent: true },
    ...useAccountUpdate(),
  });

export const useRemoveAnthropicKey = (id: string) =>
  useMutation({ mutationFn: () => accountsApi.removeKey(id), ...useAccountUpdate() });

export const useSetAiAccess = (id: string) =>
  useMutation({ mutationFn: (body: AiAccessBody) => accountsApi.setAccess(id, body), ...useAccountUpdate() });
