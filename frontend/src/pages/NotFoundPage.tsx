import { Link } from 'react-router-dom';
import { ArrowLeft, Compass } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-canvas px-4">
      <div className="max-w-md rounded-2xl border border-border-subtle bg-bg-surface p-8 text-center shadow-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500">
          <Compass className="h-6 w-6" />
        </div>
        <p className="font-mono text-xs font-semibold text-brand-500">404</p>
        <h1 className="mt-1 font-display text-2xl font-bold text-text-primary">Page not found</h1>
        <p className="mt-2 text-sm text-text-muted">
          The page you are looking for doesn&apos;t exist or has been moved.
        </p>
        <Link to="/chat" className="mt-6 inline-block">
          <Button leftIcon={<ArrowLeft className="h-4 w-4" />}>Back to ChatNow</Button>
        </Link>
      </div>
    </main>
  );
}
