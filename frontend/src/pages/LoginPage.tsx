import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound, Mail } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { extractFieldErrors, normalizeApiError } from '@/utils/errors';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTo =
    (location.state as { from?: string } | null)?.from &&
    (location.state as { from?: string }).from !== '/login'
      ? (location.state as { from: string }).from
      : '/chat';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    if (!identifier.trim()) errors.identifier = 'Enter your email or username';
    if (!password) errors.password = 'Enter your password';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const user = await login({ identifier: identifier.trim(), password });
      addToast({
        title: `Welcome back, ${user.displayName}`,
        description: 'Signed in securely.',
        variant: 'success',
      });
      navigate(redirectTo, { replace: true });
    } catch (err) {
      const apiErr = normalizeApiError(err);
      const nextFields = extractFieldErrors(apiErr);
      setFieldErrors(nextFields);
      setFormError(apiErr.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in to ChatNow"
      subtitle="Enter your email or username to continue where you left off."
      footer={
        <p>
          New to ChatNow?{' '}
          <Link to="/register" className="font-semibold text-brand-500 hover:text-brand-600">
            Create an account
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError && <ErrorState compact message={formError} />}

        <Input
          label="Email or username"
          name="identifier"
          type="text"
          autoComplete="username"
          autoFocus
          placeholder="alice@example.com or alice"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          error={fieldErrors.identifier}
          leftIcon={<Mail className="h-4 w-4" />}
        />

        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          leftIcon={<KeyRound className="h-4 w-4" />}
          passwordToggle
        />

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          rightIcon={<ArrowRight className="h-4 w-4" />}
          className="mt-2 w-full"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
