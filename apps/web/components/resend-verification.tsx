'use client';

import * as React from 'react';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { Turnstile, type TurnstileHandle } from '@/components/turnstile';
import { api, ApiError } from '@/lib/api';
import { useCooldown } from '@/lib/auth-links';

/**
 * "Send a new verification link" with a cooldown countdown and duplicate-submit protection.
 * The server answers the same way whether or not the address has an account; when email cannot be
 * sent at all it returns email_unavailable, which is shown as an error (never as "sent").
 */
export function ResendVerification({ initialEmail = '', askEmail = true }: { initialEmail?: string; askEmail?: boolean }) {
  const [email, setEmail] = React.useState(initialEmail);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: 'brand' | 'rose'; text: string } | null>(null);
  const [tsToken, setTsToken] = React.useState<string>();
  const turnstile = React.useRef<TurnstileHandle>(null);
  const cooldown = useCooldown();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || cooldown.remaining > 0) return;
    if (!email.trim()) { setNotice({ tone: 'rose', text: 'Enter the email address you registered with.' }); return; }
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.post<{ message: string; retryAfterSeconds?: number }>('/auth/resend-verification', { email: email.trim(), turnstileToken: tsToken });
      setNotice({ tone: 'brand', text: r.message });
      cooldown.start(r.retryAfterSeconds ?? 60);
    } catch (err) {
      const rateLimited = err instanceof ApiError && err.code === 'rate_limited';
      setNotice({ tone: 'rose', text: err instanceof ApiError ? err.message : 'We could not request a new link. Check your connection and try again.' });
      if (rateLimited) cooldown.start(60);
    } finally {
      setBusy(false);
      turnstile.current?.reset();
    }
  }

  const waiting = cooldown.remaining > 0;
  return (
    <form onSubmit={submit} className="space-y-3 text-left" noValidate aria-busy={busy}>
      {askEmail && (
        <Field id="resend-email" label="Send a new link to">
          <Input id="resend-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      )}
      <Turnstile ref={turnstile} form="resendVerification" onToken={setTsToken} />
      <Button type="submit" className="w-full" loading={busy} disabled={busy || waiting} aria-live="polite">
        {waiting ? `Send again in ${cooldown.remaining}s` : 'Resend verification email'}
      </Button>
      {notice && <Alert tone={notice.tone}><span role={notice.tone === 'rose' ? 'alert' : 'status'}>{notice.text}</span></Alert>}
    </form>
  );
}
