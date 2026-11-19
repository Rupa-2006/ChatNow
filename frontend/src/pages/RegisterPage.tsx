import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, AtSign, KeyRound, Mail, User } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { AuthLayout } from '@/layouts/AuthLayout';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { extractFieldErrors, normalizeApiError } from '@/utils/errors';
import {
  getPasswordStrength,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validateUsername,
} from '@/utils/validators';

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const addToast = useUiStore((s) => s.addToast);
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = getPasswordStrength(password);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    const dnErr = validateDisplayName(displayName);
    const unErr = validateUsername(username);
    const emErr = validateEmail(email);
    const pwErr = validatePassword(password);

    if (dnErr) errors.displayName = dnErr;
    if (unErr) errors.username = unErr;
    if (emErr) errors.email = emErr;
    if (pwErr) errors.password = pwErr;
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const user = await register({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
      });
      addToast({
        title: 'Account created',
        description: `Welcome to ChatNow, ${user.displayName}!`,
        variant: 'success',
      });
      navigate('/chat', { replace: true });
    } catch (err) {
      const apiErr = normalizeApiError(err);
      setFieldErrors(extractFieldErrors(apiErr));
      setFormError(apiErr.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join ChatNow to message individuals and teams in real time."
      footer={
        <p>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-500 hover:text-brand-600">
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
        {formError && <ErrorState compact message={formError} />}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Input
            label="Display name"
            name="displayName"
            autoComplete="name"
            autoFocus
            placeholder="Alice Johnson"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            error={fieldErrors.displayName}
            leftIcon={<User className="h-4 w-4" />}
          />

          <Input
            label="Username"
            name="username"
            autoComplete="username"
            placeholder="alice_j"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fieldErrors.username}
            leftIcon={<AtSign className="h-4 w-4" />}
          />
        </div>

        <Input
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="alice@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          leftIcon={<Mail className="h-4 w-4" />}
        />

        <div className="space-y-1.5">
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            hint={!fieldErrors.password ? 'Use a passphrase of 10–128 characters (NIST SP 800-63B).' : undefined}
            leftIcon={<KeyRound className="h-4 w-4" />}
            passwordToggle
          />
          {strength.level > 0 && (
            <div className="flex items-center gap-2 pt-0.5">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      'h-1 flex-1 rounded-full transition-colors',
                      strength.level >= step
                        ? strength.level === 1
                          ? 'bg-amber-500'
                          : strength.level === 2
                            ? 'bg-sky-500'
                            : 'bg-emerald-500'
                        : 'bg-border-subtle',
                    )}
                  />
                ))}
              </div>
              <span className="text-[11px] font-medium text-text-muted">{strength.label}</span>
            </div>
          )}
        </div>

        <Input
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword}
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
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
