import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  compact = false,
  className,
}: ErrorStateProps) {
  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          'flex items-start gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300',
          className,
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">{message}</p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80 cursor-pointer"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/12 text-status-danger ring-1 ring-rose-500/20">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="font-display text-base font-semibold text-text-primary">{title}</h3>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-text-muted">{message}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          Try again
        </Button>
      )}
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error details stay out of the UI; ErrorBoundary offers a safe recovery path.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg-canvas p-6">
          <div className="w-full max-w-md rounded-2xl border border-border-subtle bg-bg-surface shadow-md">
            <ErrorState
              title="ChatNow hit an unexpected error"
              message={this.state.message}
              onRetry={() => window.location.reload()}
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
