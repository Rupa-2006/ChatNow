import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';

const VARIANT_STYLES = {
  success: {
    icon: CheckCircle2,
    border: 'border-emerald-500/30',
    iconColor: 'text-emerald-500',
  },
  error: {
    icon: XCircle,
    border: 'border-rose-500/30',
    iconColor: 'text-rose-500',
  },
  info: {
    icon: Info,
    border: 'border-brand-500/30',
    iconColor: 'text-brand-500',
  },
};

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
    >
      {toasts.map((toast) => {
        const style = VARIANT_STYLES[toast.variant];
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start gap-3 rounded-xl border bg-bg-elevated p-3.5 shadow-md transition-all',
              style.border,
            )}
          >
            <Icon className={cn('h-4.5 w-4.5 shrink-0 mt-0.5', style.iconColor)} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-xs text-text-muted">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="rounded-md p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
