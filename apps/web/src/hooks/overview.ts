import { useQuery } from '@tanstack/react-query';
import { qk } from '~/lib/query-keys';
import { overviewApi } from '~/services/api/overview';

export const useOverview = () => useQuery({ queryKey: qk.overview(), queryFn: overviewApi.get });
