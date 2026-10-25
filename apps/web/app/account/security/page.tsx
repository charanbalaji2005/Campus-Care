'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { changePasswordSchema } from '@campuscare/shared';
import { api, ApiError } from '@/lib/api';
import { useApi, useMe } from '@/lib/hooks';
import { useForm } from '@/lib/form';
import { formatDateTime, timeAgo } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Skeleton } from '@/components/ui/primitives';
import { Logo } from '@/components/brand';

interface SessionRow { id: string; current: boolean; createdAt: string; lastSeenAt: string; userAgent: string | null; method: string }

export default function AccountSecurityPage() {
  const params = useSearchParams();
  const { data: me, mutate: mutateMe, error } = useMe();
  const { data: sessions, mutate } = useApi<SessionRow[]>(me ? '/auth/sessions' : null);
  const { data: google, mutate: mutateGoogle } = useApi<{ linked: boolean }>(me ? '/auth/google/status' : null);
  const [setup, setSetup] = React.useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = React.useState('');
  const pw = useForm(changePasswordSchema, { currentPassword: '', password: '', confirmPassword: '' });

  React.useEffect(() => { if (error?.status === 401) window.location.href = '/login?next=/account/security'; }, [error]);
  if (!me) return <div className="mx-auto max-w-3xl p-6"><Skeleton className="h-96" /></div>;

  async function startMfa() {
    try { setSetup(await api.post('/auth/mfa/setup')); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not start setup.'); }
  }
  async function confirmMfa() {
    try {
      await api.post('/auth/mfa/confirm', { code });
      toast.success('Two-step verification is on.');
      setSetup(null); setCode('');
      void mutateMe();
    } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Invalid code.'); }
  }
  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    await pw.submit(async (d) => {
      await api.post('/auth/change-password', d);
      toast.success('Password changed. Other sessions were signed out.');
      pw.setValues({ currentPassword: '', password: '', confirmPassword: '' });
      void mutate();
    });
  }

  return (
    <div className="min-h-screen bg-warm">
      <header className="border-b border-line bg-white px-5 py-4"><div className="mx-auto flex max-w-3xl items-center justify-between"><Logo /><Link href={me.homePath} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><ArrowLeft className="h-4 w-4" /> Back to portal</Link></div></header>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-5 py-8">
        <h1 className="page-title">Account security</h1>
        {params.get('setup') === 'mfa' && !me.user.mfaEnabled && <Alert tone="amber" title="Two-step verification required">Your role requires two-step verification. Set it up below to continue to your portal.</Alert>}
        {params.get('linked') === 'google' && <Alert tone="brand">Google account linked.</Alert>}

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Smartphone className="h-4 w-4" /> Two-step verification</span>} description="Use an authenticator app (e.g. Google Authenticator, Microsoft Authenticator) for a second sign-in step." action={me.user.mfaEnabled ? <Badge tone="brand">On</Badge> : <Badge>Off</Badge>} />
          <div className="p-5">
            {me.user.mfaEnabled ? (
              <p className="text-sm text-ink">Two-step verification is protecting your account.{me.mfaRequired && ' It is mandatory for your role.'}</p>
            ) : setup ? (
              <div className="flex flex-col gap-5 sm:flex-row">
                <img src={setup.qrDataUrl} alt="QR code for your authenticator app" className="h-44 w-44 rounded-xl border border-line" />
                <div className="flex-1 space-y-3 text-sm">
                  <p>1. Scan this QR code with your authenticator app, or enter the key: <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 text-xs">{setup.secret}</code></p>
                  <p>2. Enter the 6-digit code it shows:</p>
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Authenticator code" className="w-40 text-center tracking-[0.4em]" />
                  <Button onClick={confirmMfa} disabled={code.length !== 6}>Turn on</Button>
                </div>
              </div>
            ) : (
              <Button onClick={startMfa}><ShieldCheck className="h-4 w-4" /> Set up two-step verification</Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Change password</span>} />
          <form onSubmit={changePassword} className="grid gap-4 p-5 sm:grid-cols-3" noValidate>
            <Field id="currentPassword" label="Current password" error={pw.errors.currentPassword}><Input type="password" autoComplete="current-password" {...pw.bind('currentPassword')} /></Field>
            <Field id="password" label="New password" error={pw.errors.password}><Input type="password" autoComplete="new-password" {...pw.bind('password')} /></Field>
            <Field id="confirmPassword" label="Confirm" error={pw.errors.confirmPassword}><Input type="password" autoComplete="new-password" {...pw.bind('confirmPassword')} /></Field>
            <div className="sm:col-span-3"><Button type="submit" loading={pw.submitting}>Update password</Button></div>
          </form>
        </Card>

        <Card>
          <CardHeader title="Google sign-in" description="Link your university Google account to sign in with Google." />
          <div className="flex items-center gap-3 p-5 text-sm">
            {google?.linked ? (
              <><Badge tone="brand">Linked</Badge><Button size="sm" variant="ghost" onClick={async () => { try { await api.delete('/auth/google/link'); void mutateGoogle(); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not unlink'); } }}>Unlink</Button></>
            ) : (
              <Button size="sm" variant="outline" asChild><a href="/api/v1/auth/google?mode=link">Link Google account</a></Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Monitor className="h-4 w-4" /> Active sessions</span>} action={<Button size="sm" variant="danger-outline" onClick={async () => { await api.post('/auth/logout-all'); window.location.href = '/login'; }}><LogOut className="h-4 w-4" /> Sign out everywhere</Button>} />
          <ul className="divide-y divide-line">
            {sessions?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{s.userAgent ?? 'Unknown device'}</p><p className="text-xs text-ink-soft">Signed in {formatDateTime(s.createdAt)} via {s.method} · active {timeAgo(s.lastSeenAt)}</p></div>
                {s.current ? <Badge tone="brand">This device</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await api.delete(`/auth/sessions/${s.id}`); void mutate(); }}>Revoke</Button>}
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </div>
  );
}
