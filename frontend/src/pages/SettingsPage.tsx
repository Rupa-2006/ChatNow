import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ban,
  Bell,
  KeyRound,
  Laptop,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Shield,
  Sun,
  Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import * as authApi from '@/services/auth.api';
import { updateMyProfile } from '@/services/users.api';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import type { NotificationPrefs, SessionInfo } from '@/types/api';
import { cn } from '@/utils/cn';
import { normalizeApiError } from '@/utils/errors';
import { formatRelativeTime, parseUserAgent } from '@/utils/format';
import { validatePassword } from '@/utils/validators';

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const addToast = useUiStore((s) => s.addToast);
  const resetUi = useUiStore((s) => s.resetUi);
  const resetUsers = useUsersStore((s) => s.reset);
  const blockedUsers = useUsersStore((s) => s.blockedUsers);
  const blockedLoading = useUsersStore((s) => s.blockedLoading);
  const loadBlockedUsers = useUsersStore((s) => s.loadBlockedUsers);
  const unblockUser = useUsersStore((s) => s.unblockUser);
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();

  // Notification prefs
  const [savingPref, setSavingPref] = useState(false);

  // Change password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [changingPw, setChangingPw] = useState(false);

  // Sessions
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const list = await authApi.fetchSessions();
      setSessions(list);
    } catch (err) {
      setSessionsError(normalizeApiError(err).message);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadBlockedUsers();
  }, [loadSessions, loadBlockedUsers]);

  const handleTogglePref = async (key: keyof NotificationPrefs, value: boolean) => {
    if (!user || savingPref) return;
    setSavingPref(true);
    try {
      const updated = await updateMyProfile({
        notificationPrefs: { [key]: value },
      });
      setUser(updated);
      addToast({ title: 'Preferences saved', variant: 'success' });
    } catch (err) {
      addToast({ title: 'Update failed', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setSavingPref(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);

    if (!currentPassword) {
      setPwError('Enter your current password.');
      return;
    }
    const nextErr = validatePassword(newPassword);
    if (nextErr) {
      setPwError(nextErr);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }

    setChangingPw(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      addToast({
        title: 'Password changed',
        description: 'All other active sessions have been signed out.',
        variant: 'success',
      });
      void loadSessions();
    } catch (err) {
      setPwError(normalizeApiError(err).message);
    } finally {
      setChangingPw(false);
    }
  };

  const handleRevokeSession = async (session: SessionInfo) => {
    setRevokingId(session.id);
    try {
      await authApi.revokeSessionById(session.id);
      if (session.current) {
        useAuthStore.getState().clearSession();
        resetUi();
        resetUsers();
        navigate('/login', { replace: true });
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      addToast({ title: 'Session revoked', variant: 'info' });
    } catch (err) {
      addToast({ title: 'Could not revoke session', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setRevokingId(null);
    }
  };

  const handleLogoutAll = async () => {
    setLoggingOutAll(true);
    try {
      await logoutAll();
      resetUi();
      resetUsers();
      addToast({ title: 'Signed out everywhere', description: 'All sessions were revoked.', variant: 'info' });
      navigate('/login', { replace: true });
    } finally {
      setLoggingOutAll(false);
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-3xl space-y-6 pb-8">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Settings
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Appearance, notifications, password security, active sessions, and blocked accounts.
          </p>
        </div>

        {/* Appearance */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex items-center gap-2">
            <Palette className="h-4.5 w-4.5 text-brand-500" />
            <h2 className="font-display text-base font-semibold text-text-primary">Appearance</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Choose a theme or sync automatically with your Windows appearance setting.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Theme">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = preference === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreference(value)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-all cursor-pointer',
                    active
                      ? 'border-brand-500 bg-brand-50 text-brand-600 dark:text-brand-200 ring-1 ring-brand-500/20'
                      : 'border-border-subtle bg-bg-subtle text-text-secondary hover:border-border-strong hover:text-text-primary',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Notifications */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex items-center gap-2">
            <Bell className="h-4.5 w-4.5 text-brand-500" />
            <h2 className="font-display text-base font-semibold text-text-primary">Notifications</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Synced to your account across devices.
          </p>

          <div className="mt-4 divide-y divide-border-subtle">
            <Switch
              label="Browser notifications"
              description="Show desktop alerts when new messages arrive in background tabs."
              checked={user.notificationPrefs.browser}
              disabled={savingPref}
              onChange={(v) => void handleTogglePref('browser', v)}
            />
            <Switch
              label="Notification sounds"
              description="Play a subtle chime on incoming messages."
              checked={user.notificationPrefs.sound}
              disabled={savingPref}
              onChange={(v) => void handleTogglePref('sound', v)}
            />
            <Switch
              label="Message previews"
              description="Display sender message snippets inside notification popups."
              checked={user.notificationPrefs.messagePreview}
              disabled={savingPref}
              onChange={(v) => void handleTogglePref('messagePreview', v)}
            />
          </div>
        </section>

        {/* Password Security */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4.5 w-4.5 text-brand-500" />
            <h2 className="font-display text-base font-semibold text-text-primary">
              Change password
            </h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Changing your password immediately revokes every other signed-in device.
          </p>

          <form onSubmit={handleChangePassword} noValidate className="mt-4 space-y-3.5">
            {pwError && <ErrorState compact message={pwError} />}

            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              passwordToggle
            />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Input
                label="New password"
                type="password"
                autoComplete="new-password"
                placeholder="10–128 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                passwordToggle
              />
              <Input
                label="Confirm new password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                passwordToggle
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" loading={changingPw}>
                Update password
              </Button>
            </div>
          </form>
        </section>

        {/* Active Sessions */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Shield className="h-4.5 w-4.5 text-brand-500" />
                <h2 className="font-display text-base font-semibold text-text-primary">
                  Active sessions
                </h2>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Every signed-in browser holds a rotating HttpOnly refresh token family.
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              loading={loggingOutAll}
              onClick={() => void handleLogoutAll()}
              leftIcon={<LogOut className="h-3.5 w-3.5" />}
              className="text-status-danger border-rose-500/30 hover:bg-rose-500/8"
            >
              Sign out all devices
            </Button>
          </div>

          <div className="mt-4 space-y-2.5">
            {sessionsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : sessionsError ? (
              <ErrorState compact message={sessionsError} onRetry={() => void loadSessions()} />
            ) : sessions.length === 0 ? (
              <p className="text-xs text-text-muted">No active sessions found.</p>
            ) : (
              sessions.map((session) => {
                const { browser, os } = parseUserAgent(session.userAgent);
                return (
                  <div
                    key={session.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-bg-surface text-text-secondary ring-1 ring-border-subtle">
                        <Laptop className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-text-primary">
                            {browser} on {os}
                          </p>
                          {session.current && <Badge variant="success">This device</Badge>}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                          {session.ipAddress ?? 'Unknown IP'} · Active {formatRelativeTime(session.lastActiveAt)}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="xs"
                      loading={revokingId === session.id}
                      onClick={() => void handleRevokeSession(session)}
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                      className="shrink-0 text-status-danger hover:bg-rose-500/10 hover:text-status-danger"
                    >
                      Revoke
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Blocked Users */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex items-center gap-2">
            <Ban className="h-4.5 w-4.5 text-status-danger" />
            <h2 className="font-display text-base font-semibold text-text-primary">Blocked users</h2>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Blocked accounts cannot message you directly or view your online status.
          </p>

          <div className="mt-4 space-y-2">
            {blockedLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : blockedUsers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border-subtle bg-bg-subtle/60 px-4 py-4 text-center text-xs text-text-muted">
                You haven&apos;t blocked anyone.
              </p>
            ) : (
              blockedUsers.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-3.5 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={person.displayName} seed={person.id} src={person.avatarUrl} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{person.displayName}</p>
                      <p className="truncate font-mono text-xs text-text-muted">@{person.username}</p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={async () => {
                      await unblockUser(person.id);
                      addToast({ title: `Unblocked ${person.displayName}`, variant: 'info' });
                    }}
                  >
                    Unblock
                  </Button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
