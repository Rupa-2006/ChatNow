import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  passwordToggle?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    leftIcon,
    rightSlot,
    passwordToggle = false,
    type = 'text',
    id: explicitId,
    className,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const id = explicitId ?? autoId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const [showPassword, setShowPassword] = useState(false);

  const resolvedType = passwordToggle && type === 'password' ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-xs font-medium tracking-wide text-text-secondary">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted"
            aria-hidden="true"
          >
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type={resolvedType}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            'w-full h-10 rounded-xl border bg-bg-input px-3.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-150',
            'focus:bg-bg-surface focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15',
            error
              ? 'border-status-danger focus:border-status-danger focus:ring-rose-500/15'
              : 'border-border-subtle hover:border-border-strong',
            leftIcon && 'pl-9',
            (passwordToggle || rightSlot) && 'pr-10',
            props.disabled && 'opacity-60 cursor-not-allowed',
            className,
          )}
          {...props}
        />
        {passwordToggle && type === 'password' && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-1.5 flex items-center px-2 text-text-muted hover:text-text-primary transition-colors cursor-pointer"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        {!passwordToggle && rightSlot && (
          <div className="absolute inset-y-0 right-2 flex items-center">{rightSlot}</div>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-status-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
