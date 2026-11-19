import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AtSign, Calendar, Camera, Loader2, Mail, Save, User as UserIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input } from '@/components/ui/Input';
import { uploadMyAvatar } from '@/services/attachments.api';
import { updateMyProfile } from '@/services/users.api';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { extractFieldErrors, normalizeApiError } from '@/utils/errors';
import { formatFullDate } from '@/utils/format';
import { validateBio, validateDisplayName, validateUsername } from '@/utils/validators';

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const addToast = useUiStore((s) => s.addToast);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const updated = await uploadMyAvatar(file);
      setUser(updated);
      addToast({ title: 'Avatar updated', variant: 'success' });
    } catch (err) {
      addToast({ title: 'Avatar upload failed', description: normalizeApiError(err).message, variant: 'error' });
    } finally {
      setUploadingAvatar(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setBio(user.bio ?? '');
  }, [user]);

  if (!user) return null;

  const isDirty =
    displayName.trim() !== user.displayName ||
    username.trim().toLowerCase() !== user.username ||
    bio.trim() !== (user.bio ?? '');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const errors: Record<string, string> = {};
    const dnErr = validateDisplayName(displayName);
    const unErr = validateUsername(username);
    const bioErr = validateBio(bio);
    if (dnErr) errors.displayName = dnErr;
    if (unErr) errors.username = unErr;
    if (bioErr) errors.bio = bioErr;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const updated = await updateMyProfile({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        bio: bio.trim() === '' ? null : bio.trim(),
      });
      setUser(updated);
      addToast({ title: 'Profile updated', description: 'Your changes have been saved.', variant: 'success' });
    } catch (err) {
      const apiErr = normalizeApiError(err);
      setFieldErrors(extractFieldErrors(apiErr));
      setFormError(apiErr.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Your Profile
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Manage how you appear to other people on ChatNow.
          </p>
        </div>

        {/* Profile Overview Card */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <div className="relative">
              <Avatar
                name={user.displayName}
                seed={user.id}
                src={user.avatarUrl}
                size="xl"
                isOnline
                showPresence
              />
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => void handleAvatarChange(e)}
              />
              <button
                type="button"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
                title="Upload profile picture (JPEG/PNG/WebP, max 2 MB)"
                aria-label="Upload profile picture"
                className="absolute -right-1 -bottom-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-bg-surface text-text-secondary shadow-xs hover:text-brand-500 transition-colors cursor-pointer disabled:opacity-60"
              >
                {uploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold text-text-primary">
                  {user.displayName}
                </h2>
                <Badge variant="success">Online</Badge>
              </div>
              <p className="mt-0.5 font-mono text-xs text-text-muted">@{user.username}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" /> {user.email}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" /> Joined {formatFullDate(user.createdAt)}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Edit Form */}
        <section className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-xs">
          <h2 className="font-display text-base font-semibold text-text-primary">Public details</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Your display name, username, and bio are visible in the directory and conversations.
          </p>

          <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4">
            {formError && <ErrorState compact message={formError} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Display name"
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                error={fieldErrors.displayName}
                leftIcon={<UserIcon className="h-4 w-4" />}
              />

              <Input
                label="Username"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={fieldErrors.username}
                leftIcon={<AtSign className="h-4 w-4" />}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="profile-bio" className="text-xs font-medium text-text-secondary">
                  Bio
                </label>
                <span className="font-mono text-[11px] text-text-muted">{bio.length}/280</span>
              </div>
              <textarea
                id="profile-bio"
                rows={3}
                maxLength={280}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Write a short bio about yourself…"
                className="w-full rounded-xl border border-border-subtle bg-bg-input px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-500 focus:bg-bg-surface focus:outline-none focus:ring-3 focus:ring-brand-500/15 transition-colors resize-none"
              />
              {fieldErrors.bio && (
                <p role="alert" className="text-xs text-status-danger">
                  {fieldErrors.bio}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!isDirty || saving}
                onClick={() => {
                  setDisplayName(user.displayName);
                  setUsername(user.username);
                  setBio(user.bio ?? '');
                  setFieldErrors({});
                  setFormError(null);
                }}
              >
                Reset
              </Button>
              <Button
                type="submit"
                size="md"
                loading={saving}
                disabled={!isDirty}
                leftIcon={<Save className="h-4 w-4" />}
              >
                Save changes
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
