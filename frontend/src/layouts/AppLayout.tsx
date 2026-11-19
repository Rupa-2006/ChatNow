import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, MessageSquare, Moon, Settings, Sun, User as UserIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuthStore } from '@/store/authStore';
import { useChatStore } from '@/store/chatStore';
import { useUiStore } from '@/store/uiStore';
import { useUsersStore } from '@/store/usersStore';
import { cn } from '@/utils/cn';

const NAV_ITEMS = [
  { to: '/chat', label: 'Messages', icon: MessageSquare },
  { to: '/profile', label: 'Profile', icon: UserIcon },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const initRealtime = useChatStore((s) => s.initRealtime);
  const teardownRealtime = useChatStore((s) => s.teardownRealtime);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const loadNotifications = useChatStore((s) => s.loadNotifications);
  const resetChat = useChatStore((s) => s.reset);
  const resetUi = useUiStore((s) => s.resetUi);
  const resetUsers = useUsersStore((s) => s.reset);
  const addToast = useUiStore((s) => s.addToast);
  const { resolvedTheme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!user) return;
    initRealtime();
    void loadConversations();
    void loadNotifications();
    return () => {
      teardownRealtime();
    };
  }, [user?.id, initRealtime, teardownRealtime, loadConversations, loadNotifications]);

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      resetChat();
      resetUi();
      resetUsers();
      addToast({ title: 'Signed out', description: 'Your session has been closed.', variant: 'info' });
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg-canvas md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-brand-500 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

      {/* Desktop Left Navigation Rail */}
      <nav
        aria-label="Primary navigation"
        className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-border-subtle bg-bg-surface py-4 md:flex"
      >
        <div className="flex flex-col items-center gap-5">
          <NavLink to="/chat" aria-label="ChatNow home" className="rounded-xl">
            <BrandLogo size="sm" showText={false} />
          </NavLink>

          <div className="flex flex-col items-center gap-1.5">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={label}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-500 ring-1 ring-brand-500/20'
                      : 'text-text-muted hover:bg-bg-hover hover:text-text-primary',
                  )
                }
              >
                <Icon className="h-5 w-5" />
              </NavLink>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </button>

          <button
            type="button"
            onClick={handleLogout}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-text-muted hover:bg-rose-500/10 hover:text-status-danger transition-colors cursor-pointer disabled:opacity-50"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>

          {user && (
            <NavLink
              to="/profile"
              title={`${user.displayName} (@${user.username})`}
              aria-label="Your profile"
              className="mt-1 rounded-full"
            >
              <Avatar
                name={user.displayName}
                seed={user.id}
                src={user.avatarUrl}
                size="sm"
                isOnline
                showPresence
              />
            </NavLink>
          )}
        </div>
      </nav>

      {/* Main Content Area */}
      <div id="main-content" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="flex h-14 shrink-0 items-center justify-around border-t border-border-subtle bg-bg-surface px-2 md:hidden"
      >
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1 text-[11px] font-medium transition-colors',
                isActive ? 'text-brand-500' : 'text-text-muted hover:text-text-primary',
              )
            }
          >
            <Icon className="h-4.5 w-4.5" />
            <span>{label}</span>
          </NavLink>
        ))}

        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary cursor-pointer"
        >
          {resolvedTheme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          <span>Theme</span>
        </button>

        <button
          type="button"
          onClick={handleLogout}
          disabled={signingOut}
          aria-label="Sign out"
          className="flex flex-col items-center justify-center gap-0.5 rounded-lg px-3 py-1 text-[11px] font-medium text-text-muted hover:text-status-danger cursor-pointer"
        >
          <LogOut className="h-4.5 w-4.5" />
          <span>Sign out</span>
        </button>
      </nav>
    </div>
  );
}
