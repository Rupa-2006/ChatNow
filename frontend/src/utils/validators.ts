/**
 * Client-side validation rules matching backend/src/validators/*.ts.
 * Always mirrored on the server — client validation only provides fast UX feedback.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'Email is required';
  if (trimmed.length > 254) return 'Email is too long';
  if (!EMAIL_RE.test(trimmed)) return 'Enter a valid email address';
  return null;
}

export function validateUsername(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'Username is required';
  if (!USERNAME_RE.test(trimmed)) {
    return 'Username must be 3–24 characters: letters, numbers or underscores';
  }
  return null;
}

export function validateDisplayName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Display name is required';
  if (trimmed.length > 50) return 'Display name must be at most 50 characters';
  return null;
}

/**
 * Mirrors NIST SP 800-63B policy enforced by backend/src/validators/auth.validators.ts:
 * length (10–128 characters) over arbitrary composition rules.
 */
export function validatePassword(value: string): string | null {
  if (value.length < 10) return 'Password must be at least 10 characters';
  if (value.length > 128) return 'Password must be at most 128 characters';
  return null;
}

export function validateBio(value: string): string | null {
  if (value.trim().length > 280) return 'Bio must be at most 280 characters';
  return null;
}

export function getPasswordStrength(password: string): {
  label: string;
  level: 0 | 1 | 2 | 3;
} {
  if (password.length === 0) return { label: '', level: 0 };
  if (password.length < 10) return { label: `${10 - password.length} more characters needed`, level: 1 };
  if (password.length < 14) return { label: 'Good length', level: 2 };
  return { label: 'Strong passphrase', level: 3 };
}
