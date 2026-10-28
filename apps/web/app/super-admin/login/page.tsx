'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button } from '@/components/ui/primitives';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.27v3.15C3.25 21.31 7.31 24 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.27A7.18 7.18 0 0 1 4.9 12c0-.79.14-1.57.38-2.27V6.58H1.27A11.97 11.97 0 0 0 0 12c0 1.92.45 3.74 1.27 5.42l4.01-3.15Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.69 1.27 6.58l4.01 3.15c.95-2.83 3.6-4.98 6.72-4.98Z" />
    </svg>
  );
}

/** Entry point for the Super Admin console. Authentication uses the same hardened sign-in flow (Turnstile, lockout, MFA). */
export default function SuperAdminLogin() {
  const params = useSearchParams();
  const isExpired = params.get('reason') === 'expired' || params.get('error') === 'session_expired';
  const nextParam = params.get('next') || '/super-admin/dashboard';

  return (
    <AuthShell title="Super Admin console" subtitle="Platform configuration for authorised university IT administrators.">
      <div className="space-y-4">
        {isExpired && (
          <Alert tone="amber" icon={<AlertCircle className="h-4 w-4" />}>
            <span role="alert">Your session expired. Please sign in again.</span>
          </Alert>
        )}

        <Alert tone="neutral" icon={<ShieldCheck className="h-4 w-4" />}>
          Super Admin accounts are never created by public sign-up. The first account is created with the one-time bootstrap command on the server; further Super Admins are invited from inside this console. Two-step verification is required.
        </Alert>

        <Button variant="outline" size="lg" className="w-full flex items-center justify-center gap-2.5 font-semibold shadow-sm hover:bg-slate-50 border-slate-300 transition-colors" asChild>
          <a href="/api/v1/auth/google">
            <GoogleIcon />
            Continue with Google
          </a>
        </Button>

        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <div className="h-px flex-1 bg-line" />
          <span className="font-medium text-ink-muted">or sign in with password</span>
          <div className="h-px flex-1 bg-line" />
        </div>

        <Button className="w-full" size="lg" asChild>
          <Link href={`/login?${isExpired ? 'reason=expired&' : ''}next=${encodeURIComponent(nextParam)}`}>
            <KeyRound className="h-4 w-4" /> Sign in with Email &amp; Password
          </Link>
        </Button>
        <p className="text-center text-xs text-ink-soft">Every action in this console is recorded in the tamper-evident audit log.</p>
      </div>
    </AuthShell>
  );
}
