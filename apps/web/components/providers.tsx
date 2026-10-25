'use client';

import * as React from 'react';
import { SWRConfig } from 'swr';
import { Toaster, toast } from 'sonner';
import { useRouter, usePathname } from 'next/navigation';
import { ApiError, api, onApiError } from '@/lib/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button, Field, Input } from '@/components/ui/primitives';

const PUBLIC_PREFIXES = ['/login', '/super-admin/login', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/session-expired', '/unauthorized', '/trusted-contact', '/privacy', '/welcome'];

type Sensitive = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
const ReauthContext = React.createContext<Sensitive>(async (fn) => fn());

/** Wrap high-risk Super Admin actions: if the server asks for re-authentication, prompt and retry once. */
export function useSensitiveAction() {
  return React.useContext(ReauthContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [reauth, setReauth] = React.useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [needCode, setNeedCode] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => onApiError((err) => {
    const isPublic = pathname === '/' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
    if (err.code === 'session_expired' && !isPublic) router.replace(`/session-expired?next=${encodeURIComponent(pathname)}`);
    else if (err.code === 'mfa_enrollment_required') router.replace('/account/security?setup=mfa');
    else if (err.code === 'mfa_required') router.replace(`/mfa?next=${encodeURIComponent(pathname)}`);
    else if (err.code === 'csrf_failed') toast.error('Security token expired — please try again.');
    else if (err.code === 'maintenance') toast.warning(err.message);
  }), [pathname, router]);

  const runSensitive: Sensitive = React.useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== 'reauth_required') throw err;
      const confirmed = await new Promise<boolean>((resolve) => setReauth({ resolve }));
      if (!confirmed) return undefined;
      return fn();
    }
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ ok?: boolean; mfaRequired?: boolean }>('/auth/reauth', { password, mfaCode: code || undefined });
      if (r?.mfaRequired) { setNeedCode(true); return; }
      reauth?.resolve(true);
      setReauth(null);
      setPassword(''); setCode(''); setNeedCode(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SWRConfig value={{ errorRetryCount: 1 }}>
      <ReauthContext.Provider value={runSensitive}>
        {children}
        <Dialog open={Boolean(reauth)} onOpenChange={(o) => { if (!o) { reauth?.resolve(false); setReauth(null); } }}>
          <DialogContent title="Confirm it's you" description="This is a sensitive change. Enter your password to continue.">
            <form onSubmit={confirm} className="space-y-4">
              <Field id="reauth-password" label="Password" error={error}>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              </Field>
              {needCode && (
                <Field id="reauth-code" label="Authenticator code">
                  <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                </Field>
              )}
              <Button type="submit" className="w-full" loading={busy}>Confirm</Button>
            </form>
          </DialogContent>
        </Dialog>
        <Toaster position="top-center" richColors closeButton />
      </ReauthContext.Provider>
    </SWRConfig>
  );
}
