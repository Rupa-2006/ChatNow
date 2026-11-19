import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

type BadgeVariant = 'brand' | 'neutral' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:text-brand-200 ring-1 ring-brand-500/20',
  neutral: 'bg-bg-subtle text-text-secondary ring-1 ring-border-subtle',
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/25',
  warning: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25',
  danger: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25',
};

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
