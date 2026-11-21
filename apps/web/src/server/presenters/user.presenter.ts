import 'server-only';
import type { UserDto } from '@revo/shared';

type UserRow = { id: string; githubId: bigint; login: string; name: string | null; avatarUrl: string | null };

export function presentUser(u: UserRow): UserDto {
  return { id: u.id, githubId: Number(u.githubId), login: u.login, name: u.name, avatarUrl: u.avatarUrl };
}
