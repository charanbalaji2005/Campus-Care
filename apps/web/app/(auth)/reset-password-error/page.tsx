'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { XCircle } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/primitives';
import { AppHandoff } from '@/components/app-handoff';
import { linkProblem, linkProblemText } from '@/lib/auth-flow';

/** A reset link that cannot be used (expired, used or invalid), with a way to request a new one. */
export default function ResetPasswordErrorPage() {
  const reason = linkProblem(useSearchParams().get('reason'));
  const text = linkProblemText('reset', reason);
  return (
    <AuthShell title="Password reset">
      <div className="card p-8 text-center">
        <XCircle className="mx-auto h-12 w-12 text-rose-600" aria-hidden />
        <h2 className="mt-4 text-lg font-semibold" role="alert">{text.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{text.body}</p>
        <Button asChild size="lg" className="mt-6 w-full"><Link href="/forgot-password">Request a new reset link</Link></Button>
        <div className="mt-6 text-left"><AppHandoff title="Remembered your password?" message="Open the CampusCare app and sign in with your university email and password." /></div>
      </div>
    </AuthShell>
  );
}
