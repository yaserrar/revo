import type { AiAccessBody, AnthropicKeyBody } from '~/schemas/ai-access';
import type { AccountAiAccessDto, AccountsDto } from '~/types/account';
import { api } from './client';

export const accountsApi = {
  list: () => api.get<AccountsDto>('/accounts'),
  saveKey: (id: string, body: AnthropicKeyBody) =>
    api.put<AccountAiAccessDto>(`/accounts/${id}/anthropic-key`, body),
  removeKey: (id: string) => api.delete<AccountAiAccessDto>(`/accounts/${id}/anthropic-key`),
  setAccess: (id: string, body: AiAccessBody) =>
    api.patch<AccountAiAccessDto>(`/accounts/${id}/ai-access`, body),
};
