import { Avatar, AvatarFallback, AvatarImage } from '~/components/ui/avatar';
import { cn } from '~/lib/utils';

export function initials(nameOrLogin: string): string {
  const parts = nameOrLogin
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : nameOrLogin.slice(0, 2)).toUpperCase();
}

export function UserAvatar({
  login,
  name,
  src,
  size = 'default',
  className,
}: {
  login: string;
  name?: string | null;
  src?: string | null;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback
        className={cn('bg-paper-sunken font-mono text-[0.625rem] font-medium text-muted-foreground')}
      >
        {initials(name || login)}
      </AvatarFallback>
    </Avatar>
  );
}
