'use client';

import Link from 'next/link';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button } from '@/components/ui/primitives';

/** Entry point for the Super Admin console. Authentication uses the same hardened sign-in flow (Turnstile, lockout, MFA). */
export default function SuperAdminLogin() {
  return (
    <AuthShell title="Super Admin console" subtitle="Platform configuration for authorised university IT administrators.">
      <div className="space-y-4">
        <Alert tone="neutral" icon={<ShieldCheck className="h-4 w-4" />}>
          Super Admin accounts are never created by public sign-up. The first account is created with the one-time bootstrap command on the server; further Super Admins are invited from inside this console. Two-step verification is required.
        </Alert>
        <Button className="w-full" size="lg" asChild><Link href="/login?next=%2Fsuper-admin%2Fdashboard"><KeyRound className="h-4 w-4" /> Continue to secure sign-in</Link></Button>
        <p className="text-center text-xs text-ink-soft">Every action in this console is recorded in the tamper-evident audit log.</p>
      </div>
    </AuthShell>
  );
}
