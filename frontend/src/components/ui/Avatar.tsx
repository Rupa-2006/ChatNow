import { cn } from '@/utils/cn';
import { getAvatarGradient, getInitials } from '@/utils/format';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;
  seed?: string;
  src?: string | null;
  size?: AvatarSize;
  isOnline?: boolean;
  showPresence?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<AvatarSize, { box: string; text: string; dot: string }> = {
  xs: { box: 'h-7 w-7', text: 'text-[10px]', dot: 'h-2 w-2 ring-[1.5px]' },
  sm: { box: 'h-9 w-9', text: 'text-xs', dot: 'h-2.5 w-2.5 ring-2' },
  md: { box: 'h-10 w-10', text: 'text-sm', dot: 'h-2.5 w-2.5 ring-2' },
  lg: { box: 'h-12 w-12', text: 'text-base', dot: 'h-3 w-3 ring-2' },
  xl: { box: 'h-20 w-20', text: 'text-2xl', dot: 'h-4 w-4 ring-[3px]' },
};

export function Avatar({
  name,
  seed,
  src,
  size = 'md',
  isOnline = false,
  showPresence = false,
  className,
}: AvatarProps) {
  const cfg = SIZE_CLASSES[size];
  const gradient = getAvatarGradient(seed ?? name);

  return (
    <div className={cn('relative inline-flex shrink-0 select-none', className)}>
      {src ? (
        <img
          src={src}
          alt={name}
          className={cn('rounded-full object-cover ring-1 ring-border-subtle', cfg.box)}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-xs',
            gradient,
            cfg.box,
            cfg.text,
          )}
        >
          {getInitials(name)}
        </div>
      )}
      {showPresence && (
        <span
          title={isOnline ? 'Online' : 'Offline'}
          aria-label={isOnline ? 'Online' : 'Offline'}
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-bg-surface',
            isOnline ? 'bg-status-online' : 'bg-slate-400 dark:bg-slate-600',
            cfg.dot,
          )}
        />
      )}
    </div>
  );
}
