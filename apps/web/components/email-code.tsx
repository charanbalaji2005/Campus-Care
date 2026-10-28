'use client';

import * as React from 'react';
import { Eye, EyeOff, KeyRound, Link2 } from 'lucide-react';
import { Input } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export type EmailMethod = 'otp' | 'link';
export const CODE_LENGTH = 6;

/** `n***@srmap.edu.in`: enough to recognise the address without showing it in full. */
export function maskEmail(email: string) {
  const e = email.trim();
  const at = e.lastIndexOf('@');
  return at > 0 ? `${e[0]}***${e.slice(at)}` : 'your university email';
}

/**
 * One numeric input for the 6-digit email code. A single real field keeps paste, password managers,
 * `autocomplete="one-time-code"` and screen readers working; anything but digits is dropped.
 */
export function OtpInput({ id, value, onChange, onComplete, error, disabled }: {
  id: string; value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; error?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">{CODE_LENGTH}-digit code</label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={CODE_LENGTH + 10}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn('h-14 text-center font-mono text-2xl tracking-[0.6em] transition-colors', error && 'border-rose-500 focus-visible:ring-rose-300')}
        onChange={(e) => {
          const clean = e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
          onChange(clean);
          if (clean.length === CODE_LENGTH && clean !== value) onComplete?.(clean);
        }}
      />
      {error && <p id={`${id}-error`} className="mt-1.5 text-sm text-rose-700" role="alert">{error}</p>}
    </div>
  );
}

const OPTIONS: Record<'verify' | 'reset', { value: EmailMethod; title: string; description: string }[]> = {
  verify: [
    { value: 'otp', title: 'Verify using OTP', description: 'We email you a 6-digit code to type here.' },
    { value: 'link', title: 'Verify using an email link', description: 'We email you a link; open it and confirm.' },
  ],
  reset: [
    { value: 'otp', title: 'Reset password with OTP', description: 'We email you a 6-digit code, then you choose a new password here.' },
    { value: 'link', title: 'Send a password-reset link', description: 'We email you a link that opens the reset page.' },
  ],
};

/** Accessible radio cards for choosing a code or a link. */
export function MethodChoice({ kind, value, onChange, disabled }: { kind: 'verify' | 'reset'; value: EmailMethod; onChange: (m: EmailMethod) => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1.5 text-sm font-medium text-ink">{kind === 'verify' ? 'How would you like to verify?' : 'How would you like to reset it?'}</legend>
      {OPTIONS[kind].map((o) => {
        const selected = o.value === value;
        const Icon = o.value === 'otp' ? KeyRound : Link2;
        return (
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-200 motion-reduce:transition-none',
              selected ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-slate-200 bg-white hover:border-brand-300',
            )}
          >
            <input type="radio" name={`${kind}-method`} value={o.value} checked={selected} onChange={() => onChange(o.value)} className="mt-1 accent-brand-600" />
            <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-brand-700' : 'text-ink-soft')} aria-hidden />
            <span>
              <span className="block text-sm font-semibold text-ink">{o.title}</span>
              <span className="block text-xs text-ink-soft">{o.description}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function PasswordInput({ id, ...props }: { id: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" className="pr-10" {...props} />
      <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-ink-soft hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'} aria-controls={id}>
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

/** Fade-and-rise wrapper for each step of an auth flow; plain with prefers-reduced-motion. */
export function Step({ children, stepKey }: { children: React.ReactNode; stepKey: string }) {
  return <div key={stepKey} className="animate-step-in motion-reduce:animate-none">{children}</div>;
}
