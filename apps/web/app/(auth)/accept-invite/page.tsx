'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { passwordSchema } from '@campuscare/shared';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button, Field, Input } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useForm } from '@/lib/form';
import { AppHandoff } from '@/components/app-handoff';

const schema = z.object({ token: z.string().min(20), password: passwordSchema(), confirmPassword: z.string() }).refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export default function AcceptInvitePage() {
  const [done, setDone] = React.useState(false);
  const token = useSearchParams().get('token') ?? '';
  const form = useForm(schema, { token, password: '', confirmPassword: '' });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (data) => {
      await api.post('/auth/accept-invite', data);
      setDone(true);
    });
  }

  if (done) {
    return (
      <AuthShell title="All set" subtitle="Your account is active. Sign in to the CampusCare app with your university email and the password you just set.">
        <AppHandoff path="/login" />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Activate your staff account" subtitle="Set a strong password. Administrators will also be asked to set up two-factor authentication.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field id="password" label="Password" error={form.errors.password} hint="At least 10 characters with upper and lower case letters and a number."><Input type="password" autoComplete="new-password" {...form.bind('password')} /></Field>
        <Field id="confirmPassword" label="Confirm password" error={form.errors.confirmPassword}><Input type="password" autoComplete="new-password" {...form.bind('confirmPassword')} /></Field>
        {form.errors.token && <p className="text-sm text-rose-700">This invitation link is incomplete.</p>}
        <Button type="submit" size="lg" className="w-full" loading={form.submitting}>Activate account</Button>
      </form>
    </AuthShell>
  );
}
