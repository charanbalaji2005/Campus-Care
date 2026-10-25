'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { HeartHandshake } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Alert, Button } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';

/** Public consent page for someone a student nominated as a trusted contact. */
export default function TrustedContactPage() {
  const token = useSearchParams().get('token') ?? '';
  const [result, setResult] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<'accept' | 'decline' | null>(null);

  async function decide(decision: 'accept' | 'decline') {
    setBusy(decision);
    try {
      const r = await api.post<{ status: string }>('/safety/trusted-contacts/consent', { token, decision });
      setResult(r.status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthShell title="Trusted contact request" subtitle="A student has asked you to be one of their trusted contacts.">
      <div className="card p-6">
        <HeartHandshake className="h-10 w-10 text-brand-600" />
        <p className="mt-4 text-sm text-ink">If you accept, you may receive safety emails — for example if they start a Safe Walk and don’t check in on time. You won’t get access to their account, reports or messages. You can stop at any time by asking them to remove you.</p>
        {result && <Alert tone="brand" className="mt-4">{result === 'verified' ? 'Thank you — you are now a trusted contact.' : 'You declined. You will not receive notifications.'}</Alert>}
        {error && <Alert tone="rose" className="mt-4">{error}</Alert>}
        {!result && !error && (
          <div className="mt-6 flex gap-3">
            <Button className="flex-1" loading={busy === 'accept'} onClick={() => decide('accept')}>Accept</Button>
            <Button variant="outline" className="flex-1" loading={busy === 'decline'} onClick={() => decide('decline')}>Decline</Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
