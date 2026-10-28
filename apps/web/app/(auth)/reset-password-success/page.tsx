'use client';

import * as React from 'react';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { AppHandoff } from '@/components/app-handoff';
import { clearOutcome, readOutcome } from '@/lib/auth-flow';

/** Shown after the server confirmed a password change. Opened directly, it claims nothing. */
export default function ResetPasswordSuccessPage() {
  const [done] = React.useState(() => readOutcome(['password_reset']) !== null);
  React.useEffect(() => clearOutcome(), []);
  return (
    <AuthShell title="Password reset">
      <div className="card p-8 text-center" role="status">
        {done ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Your password was changed</h2>
            <p className="mt-1 text-sm text-ink-soft">Every signed-in device was signed out. Sign in again with your new password (two-step verification still applies).</p>
          </>
        ) : (
          <>
            <KeyRound className="mx-auto h-12 w-12 text-ink-soft" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Open the link from your email</h2>
            <p className="mt-1 text-sm text-ink-soft">This page shows the result after you choose a new password from the reset email.</p>
          </>
        )}
        <div className="mt-6 text-left"><AppHandoff title="Sign in to CampusCare" message="Open the CampusCare app and sign in with your university email and password." /></div>
      </div>
    </AuthShell>
  );
}
