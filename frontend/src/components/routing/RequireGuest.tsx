import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useAuthStore } from '@/store/authStore';

export function RequireGuest() {
  const status = useAuthStore((s) => s.status);

  if (status === 'bootstrapping') {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg-canvas px-4"
        role="status"
        aria-label="Checking session"
      >
        <BrandLogo size="lg" />
        <Loader2 className="h-4 w-4 animate-spin text-brand-500" aria-hidden="true" />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <Navigate to="/chat" replace />;
  }

  return <Outlet />;
}
