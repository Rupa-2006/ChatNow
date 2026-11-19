import { cn } from '@/utils/cn';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', text: 'text-base' },
  md: { box: 'h-9 w-9 rounded-xl', text: 'text-lg' },
  lg: { box: 'h-11 w-11 rounded-2xl', text: 'text-xl' },
};

export function BrandLogo({ size = 'md', showText = true, className }: BrandLogoProps) {
  const cfg = SIZES[size];
  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <div
        className={cn(
          'relative flex shrink-0 items-center justify-center bg-gradient-to-br from-indigo-600 via-indigo-500 to-cyan-500 shadow-sm ring-1 ring-white/20',
          cfg.box,
        )}
        aria-hidden="true"
      >
        <svg viewBox="0 0 36 36" fill="none" className="h-[62%] w-[62%]">
          <path
            d="M5 12.2C5 8.78 7.78 6 11.2 6H24.8C28.22 6 31 8.78 31 12.2V21.8C31 25.22 28.22 28 24.8 28H15.5L8.2 32.8V28H11.2C7.78 28 5 25.22 5 21.8V12.2Z"
            fill="white"
          />
          <circle cx="13.5" cy="17" r="2" fill="#4F46E5" />
          <circle cx="18" cy="17" r="2" fill="#2563EB" />
          <circle cx="22.5" cy="17" r="2" fill="#06B6D4" />
        </svg>
      </div>
      {showText && (
        <span className={cn('font-display font-bold tracking-tight text-text-primary', cfg.text)}>
          Chat<span className="text-brand-500">Now</span>
        </span>
      )}
    </div>
  );
}
