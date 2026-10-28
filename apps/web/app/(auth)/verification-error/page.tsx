'use client';

import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { AppHandoff } from '@/components/app-handoff';
import { ResendVerification } from '@/components/resend-verification';
import { linkProblem, linkProblemText } from '@/lib/auth-flow';

/** A verification link that cannot be used (expired, used or invalid), with a way to get a new one. */
export default function VerificationErrorPage() {
  const reason = linkProblem(useSearchParams().get('reason'));
  const text = linkProblemText('verify', reason);
  return (
    <AuthShell title="Email verification">
      <div className="card p-8 text-center">
        <XCircle className="mx-auto h-12 w-12 text-rose-600" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold" role="alert">{text.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{text.body}</p>
        <div className="mt-6 text-left"><ResendVerification /></div>
        <div className="mt-6 text-left"><AppHandoff title="Already verified?" message="Open the CampusCare app and sign in with your university email and password." /></div>
      </div>
    </AuthShell>
  );
}
