import { useQuery } from '@tanstack/react-query';
import { qk } from '~/lib/query-keys';
import { meApi } from '~/services/api/me';

export const useMe = () => useQuery({ queryKey: qk.me(), queryFn: meApi.get, staleTime: 5 * 60_000 });
