import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useAuthStore } from '@/store/authStore';

export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();

  if (status === 'bootstrapping') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-canvas px-4"
        role="status"
        aria-label="Restoring your session"
      >
        <BrandLogo size="lg" />
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden="true" />
          <span>Restoring secure session…</span>
        </div>
      </div>
    );
  }

  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
