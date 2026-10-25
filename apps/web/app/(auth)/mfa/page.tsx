'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { safeNextPath } from '@/lib/auth-links';

export default function MfaPage() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/auth/mfa/verify', { code });
      router.replace(safeNextPath(next, '/'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Two-step verification" subtitle="Enter the code from your authenticator app to continue.">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex justify-center"><ShieldCheck className="h-12 w-12 text-brand-600" /></div>
        <Field id="code" label="6-digit code" error={error}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus className="text-center text-lg tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>Verify</Button>
      </form>
    </AuthShell>
  );
}
