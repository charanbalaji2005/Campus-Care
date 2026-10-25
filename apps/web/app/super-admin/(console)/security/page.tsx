'use client';

import { Lock, ShieldAlert } from 'lucide-react';
import { ROLE_LABELS, type Role } from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize, timeAgo } from '@/lib/utils';
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, Skeleton, StatCard, SwitchRow } from '@/components/ui/primitives';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

interface SecurityData {
  events7d: Record<string, number>;
  lockedAccounts: { id: string; name: string; email: string; lockedUntil: string }[];
  privilegedAccounts: { id: string; name: string; email: string; role: Role; mfaEnabled: boolean; lastLoginAt: string | null; status: string }[];
}

const FORM_LABELS: Record<string, string> = { register: 'Registration', login: 'Sign in', forgotPassword: 'Forgot password', resetPassword: 'Reset password', resendVerification: 'Resend verification', incidentSubmit: 'Incident submission', communityPost: 'Community posts' };

function SessionPolicy() {
  const s = useSectionDraft('security');
  if (!s.draft) return null;
  const d = s.draft;
  const num = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement>) => s.setDraft({ ...d, [k]: Number(e.target.value) });
  return (
    <SectionCard title="Sessions, passwords & two-step verification" dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="idle" label="Idle timeout (minutes)"><Input type="number" value={d.sessionIdleMinutes} onChange={num('sessionIdleMinutes')} /></Field>
        <Field id="abs" label="Absolute session (hours)"><Input type="number" value={d.sessionAbsoluteHours} onChange={num('sessionAbsoluteHours')} /></Field>
        <Field id="rem" label="Remember me (days)"><Input type="number" value={d.rememberMeDays} onChange={num('rememberMeDays')} /></Field>
        <Field id="reauth" label="Re-auth window (minutes)" hint="How long a password confirmation lasts for sensitive actions."><Input type="number" value={d.reauthWindowMinutes} onChange={num('reauthWindowMinutes')} /></Field>
        <Field id="maxatt" label="Failed attempts before lockout"><Input type="number" value={d.maxLoginAttempts} onChange={num('maxLoginAttempts')} /></Field>
        <Field id="lock" label="Lockout (minutes)"><Input type="number" value={d.lockoutMinutes} onChange={num('lockoutMinutes')} /></Field>
        <Field id="pwlen" label="Minimum password length"><Input type="number" min={8} value={d.passwordMinLength} onChange={num('passwordMinLength')} /></Field>
      </div>
      <SwitchRow id="mfa-sa" label="Require two-step verification for Super Admins" description="Strongly recommended. Turning it off is audited." checked={d.requireMfaForSuperAdmin} onCheckedChange={(v) => s.setDraft({ ...d, requireMfaForSuperAdmin: v })} />
      <SwitchRow id="mfa-a" label="Require two-step verification for administrators" checked={d.requireMfaForAdmins} onCheckedChange={(v) => s.setDraft({ ...d, requireMfaForAdmins: v })} />
    </SectionCard>
  );
}

function TurnstileSettings() {
  const s = useSectionDraft('turnstile');
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Cloudflare Turnstile" description="Bot protection, verified on the server for each form below. Requests fail closed if Cloudflare cannot be reached." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <SwitchRow id="ts-on" label="Turnstile enabled" checked={d.enabled} onCheckedChange={(v) => s.setDraft({ ...d, enabled: v })} />
      <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
        {(Object.keys(d.forms) as (keyof typeof d.forms)[]).map((f) => (
          <SwitchRow key={f} id={`ts-${f}`} label={FORM_LABELS[f] ?? humanize(f)} disabled={!d.enabled} checked={d.forms[f]} onCheckedChange={(v) => s.setDraft({ ...d, forms: { ...d.forms, [f]: v } })} />
        ))}
      </div>
    </SectionCard>
  );
}

export default function SecurityPage() {
  const { data } = useApi<SecurityData>('/super-admin/security/events', { refreshInterval: 60000 });
  const ev = data?.events7d ?? {};
  return (
    <div className="space-y-6">
      <PageHeader title="Security" description="Sign-in protection, session policy and recent security signals." />
      {!data ? <Skeleton className="h-28" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Failed sign-ins (7d)" value={ev['auth.login_failed'] ?? 0} icon={<Lock className="h-5 w-5" />} tone="amber" />
          <StatCard label="Turnstile failures (7d)" value={ev['turnstile.failed'] ?? 0} icon={<ShieldAlert className="h-5 w-5" />} />
          <StatCard label="Access denied (7d)" value={(ev['access.denied'] ?? 0) + (ev['incident.access_denied'] ?? 0) + (ev['counselling_notes.access_denied'] ?? 0)} icon={<ShieldAlert className="h-5 w-5" />} tone="rose" />
          <StatCard label="Locked accounts" value={data.lockedAccounts.length} icon={<Lock className="h-5 w-5" />} tone="dark" />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Privileged accounts" description="Admins and Super Admins." />
          {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : (
            <ul className="divide-y divide-slate-100">
              {data.privilegedAccounts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div><p className="font-medium">{p.name} <span className="text-xs text-ink-soft">· {ROLE_LABELS[p.role]}</span></p><p className="text-xs text-ink-soft">{p.email} · {p.lastLoginAt ? `last sign-in ${timeAgo(p.lastLoginAt)}` : 'never signed in'}</p></div>
                  {p.mfaEnabled ? <Badge tone="brand">2-step on</Badge> : <Badge tone="rose">2-step off</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Locked accounts" description="Temporarily locked after repeated failed sign-ins." />
          {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : !data.lockedAccounts.length ? <EmptyState title="No locked accounts" /> : (
            <ul className="divide-y divide-slate-100">{data.lockedAccounts.map((l) => <li key={l.id} className="px-5 py-3 text-sm"><p className="font-medium">{l.name}</p><p className="text-xs text-ink-soft">{l.email} · until {formatDateTime(l.lockedUntil)}</p></li>)}</ul>
          )}
        </Card>
      </div>
      <TurnstileSettings />
      <SessionPolicy />
    </div>
  );
}
