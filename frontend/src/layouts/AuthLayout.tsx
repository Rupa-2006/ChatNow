import type { ReactNode } from 'react';
import { CheckCheck, Lock, Moon, Radio, Server, Sun } from 'lucide-react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useTheme } from '@/contexts/ThemeContext';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <div className="grid min-h-dvh bg-bg-canvas lg:grid-cols-[1.08fr_1fr]">
      {/* Brand / Architecture showcase panel (desktop) */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-10 text-white lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-28 -left-24 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.28) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2.5">
            <BrandLogo size="md" showText={false} />
            <span className="font-display text-lg font-bold tracking-tight text-white">
              Chat<span className="text-cyan-400">Now</span>
            </span>
          </div>
        </div>

        <div className="relative z-10 my-auto max-w-lg py-10">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-200 backdrop-blur-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Real-time distributed messaging platform
          </p>

          <h1 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            Instant messaging engineered for speed and security.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            Built with stateful WebSockets, Redis cross-instance Pub/Sub, Argon2id password
            protection, and rotating HttpOnly refresh sessions.
          </p>

          {/* Compact UI preview card */}
          <div className="mt-8 rounded-2xl border border-white/12 bg-slate-900/75 p-4 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-cyan-500 text-xs font-semibold">
                  AR
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">Architecture Sync</p>
                  <p className="text-[11px] text-emerald-400">3 members online</p>
                </div>
              </div>
              <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                WSS · Redis
              </span>
            </div>
            <div className="mt-3 space-y-2.5 text-xs">
              <div className="max-w-[82%] rounded-2xl rounded-tl-sm border border-white/10 bg-white/6 px-3.5 py-2 text-slate-200">
                Session rotation and token-reuse detection just passed all 20 integration tests.
              </div>
              <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-sm bg-gradient-to-r from-indigo-600 to-indigo-500 px-3.5 py-2 text-white">
                <p>Awesome — deploying to both API instances behind Nginx next.</p>
                <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-indigo-100">
                  <span>10:24 AM</span>
                  <CheckCheck className="h-3 w-3 text-cyan-300" />
                </div>
              </div>
            </div>
          </div>

          <dl className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Radio className="h-3.5 w-3.5 text-cyan-400" /> Real-time
              </dt>
              <dd className="mt-1 text-[11px] text-slate-400">Live presence, typing &amp; read ticks</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Lock className="h-3.5 w-3.5 text-indigo-400" /> Hardened
              </dt>
              <dd className="mt-1 text-[11px] text-slate-400">In-memory JWT &amp; HttpOnly rotation</dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Server className="h-3.5 w-3.5 text-emerald-400" /> Scalable
              </dt>
              <dd className="mt-1 text-[11px] text-slate-400">Multi-node Redis adapter &amp; ELK</dd>
            </div>
          </dl>
        </div>

        <p className="relative z-10 text-xs text-slate-400">
          Traffic protected in transit with HTTPS/WSS. ChatNow does not claim end-to-end encryption.
        </p>
      </aside>

      {/* Form column */}
      <main className="relative flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border-subtle bg-bg-surface text-text-secondary shadow-xs hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>

        <div className="w-full max-w-[420px]">
          <div className="mb-7 lg:hidden">
            <BrandLogo size="md" />
          </div>

          <div className="rounded-2xl border border-border-subtle bg-bg-surface p-6 shadow-md sm:p-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold tracking-tight text-text-primary">
                {title}
              </h2>
              <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>
            </div>

            {children}
          </div>

          <div className="mt-5 text-center text-sm text-text-secondary">{footer}</div>
        </div>
      </main>
    </div>
  );
}
