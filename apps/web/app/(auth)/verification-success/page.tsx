'use client';

import * as React from 'react';
import { CheckCircle2, MailQuestion } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { AppHandoff } from '@/components/app-handoff';
import { clearOutcome, readOutcome, type AuthOutcome } from '@/lib/auth-flow';

/** Shown after the server confirmed a verification. Opened directly, it claims nothing. */
export default function VerificationSuccessPage() {
  const [outcome] = React.useState<AuthOutcome | null>(() => readOutcome(['verified', 'already_verified']));
  React.useEffect(() => clearOutcome(), []);
  return (
    <AuthShell title="Email verification">
      <div className="card p-8 text-center" role="status">
        {outcome ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-brand-600" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">{outcome === 'verified' ? 'Your email is verified' : 'Your email was already verified'}</h2>
            <p className="mt-1 text-sm text-ink-soft">Your CampusCare account is active.</p>
          </>
        ) : (
          <>
            <MailQuestion className="mx-auto h-12 w-12 text-ink-soft" aria-hidden />
            <h2 className="mt-4 text-lg font-semibold">Open the link from your email</h2>
            <p className="mt-1 text-sm text-ink-soft">This page shows the result after you verify. Use the “Verify email” button in the email CampusCare sent you.</p>
          </>
        )}
        <div className="mt-6 text-left"><AppHandoff title="Sign in to CampusCare" message="Open the CampusCare app and sign in with your university email and password." /></div>
      </div>
    </AuthShell>
  );
}
