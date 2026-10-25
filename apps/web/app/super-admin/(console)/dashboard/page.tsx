'use client';

import Link from 'next/link';
import {
  AlertTriangle, BellOff, CheckCircle2, Database, FlaskConical, FolderOpen, HeartPulse, KeyRound, MapPin, Radio, RadioTower, Server, ShieldAlert,
  ShieldCheck, Siren, UserCheck, UserMinus, Users,
} from 'lucide-react';
import { ROLE_LABELS, ROLES } from '@campuscare/shared';
import { useApi, useRealtime } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { Kpi, ageLabel, secondsSince, useNow } from '@/components/super-admin/ops-ui';

interface Overview {
  generatedAt: string;
  environment: string;
  sampleData: { present: boolean; demoAccounts: number; sampleIncidents: number };
  duty: { onDuty: number; onBreak: number; offDuty: number; unavailable: number; stale: number; responding: number; reachableActive: number; heartbeatIntervalSeconds: number; staleThresholdSeconds: number };
  sos: { active: number; unacknowledged: number; unassigned: number; respondersAssigned: number };
  incidents: { open: number; overdueAcknowledgement: number; overdueResolution: number };
  location: { activeSecurityShares: number; activeTrustedContactShares: number };
  delivery: { emailFailed24h: number; alertDeliveryFailed24h: number; pushFailed24h: number; jobsFailed: number };
  security: { loginFailures7d: number; mfaFailures7d: number; replayBlocked7d: number; mfaLockouts7d: number; recoveryCodesUsed7d: number; accessDenied7d: number; turnstileFailed7d: number; privateChatReviews7d: number; locationDetailViews7d: number; lockedAccounts: number };
  health: Record<string, string>;
}
interface Platform { users: { total: number; byRole: Record<string, number>; activeSessions: number }; health: { database: string; emailProvider: string; emailFailures24h: number; jobsPending: number; jobsFailed: number; turnstile: string; googleOAuth: string } }

function HealthRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean | null }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-ink">{icon}{label}</span>
      <span className={cn('flex items-center gap-1.5 text-right text-[13px]', ok === null ? 'text-ink-soft' : ok ? 'text-brand-700' : 'text-amber-700')}>
        {ok === null ? null : ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}{value}
      </span>
    </li>
  );
}

function DutyBar({ d }: { d: Overview['duty'] }) {
  const parts = [
    { k: 'On duty', n: d.onDuty - d.responding, c: 'bg-brand-500' },
    { k: 'Responding', n: d.responding, c: 'bg-forest' },
    { k: 'On break', n: d.onBreak, c: 'bg-sky-300' },
    { k: 'Stale', n: d.stale, c: 'bg-rose-500' },
    { k: 'Unavailable', n: d.unavailable, c: 'bg-slate-300' },
    { k: 'Off duty', n: d.offDuty, c: 'bg-stone-200' },
  ];
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-stone-100" role="img" aria-label={parts.map((p) => `${p.k} ${p.n}`).join(', ')}>
        {total > 0 && parts.filter((p) => p.n > 0).map((p) => <div key={p.k} className={p.c} style={{ width: `${(p.n / total) * 100}%` }} />)}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-soft">
        {parts.map((p) => <li key={p.k} className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', p.c)} />{p.k} <strong className="tabular text-ink-strong">{p.n}</strong></li>)}
      </ul>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const now = useNow(5000);
  const { data, error, mutate } = useApi<Overview>('/admin/ops-overview', { refreshInterval: 15_000 });
  const { data: platform } = useApi<Platform>('/super-admin/dashboard', { refreshInterval: 60_000 });
  useRealtime('ops:alerts', { 'ops:alert': () => void mutate() });
  useRealtime('duty:roster', { 'duty:updated': () => void mutate() });

  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!data) {
    return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>;
  }
  const d = data;
  const failures = d.delivery.emailFailed24h + d.delivery.alertDeliveryFailed24h + d.delivery.pushFailed24h;
  const sec = d.security;
  const updated = secondsSince(d.generatedAt, now);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations dashboard"
        description={<>Live figures from the database · updated {ageLabel(updated)} · heartbeats every {d.duty.heartbeatIntervalSeconds}s, stale after {d.duty.staleThresholdSeconds}s</>}
        actions={<Badge tone={d.environment === 'production' ? 'dark' : 'amber'} className="uppercase tracking-wide">{d.environment}</Badge>}
      />
      {d.environment !== 'production' && d.sampleData.present && (
        <Alert tone="amber" icon={<FlaskConical className="h-4 w-4" />} title="Development data">
          This database contains seeded sample data ({d.sampleData.demoAccounts} demo account{d.sampleData.demoAccounts === 1 ? '' : 's'}, {d.sampleData.sampleIncidents} sample case{d.sampleData.sampleIncidents === 1 ? '' : 's'}). The figures below include it.
        </Alert>
      )}
      {d.sos.unacknowledged > 0 && (
        <Alert tone="rose" icon={<Siren className="h-4 w-4" />} title={`${d.sos.unacknowledged} SOS alert${d.sos.unacknowledged === 1 ? '' : 's'} not yet acknowledged by a responder`}>
          {d.sos.unassigned > 0 && <><strong>{d.sos.unassigned} could not be assigned to anyone eligible.</strong> </>}
          <Link href="/super-admin/emergency-alerts" className="font-semibold underline">Open emergency operations</Link>
        </Alert>
      )}
      {d.duty.stale > 0 && (
        <Alert tone="amber" icon={<RadioTower className="h-4 w-4" />} title={`${d.duty.stale} responder${d.duty.stale === 1 ? ' is' : 's are'} unreachable`}>
          Their duty heartbeat stopped. They are shown as stale — not off duty — until a supervisor acts or the heartbeat returns. <Link href="/super-admin/duty-roster?status=stale" className="font-semibold underline">Review the roster</Link>
        </Alert>
      )}

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Officers on duty" value={d.duty.onDuty} icon={<UserCheck className="h-4 w-4" />} tone="brand" hint={`${d.duty.reachableActive} with a fresh heartbeat`} href="/super-admin/duty-roster" />
        <Kpi label="Off duty" value={d.duty.offDuty} icon={<UserMinus className="h-4 w-4" />} hint={`${d.duty.onBreak} on break · ${d.duty.unavailable} unavailable`} href="/super-admin/duty-roster" />
        <Kpi label="Stale heartbeats" value={d.duty.stale} icon={<Radio className="h-4 w-4" />} tone={d.duty.stale ? 'amber' : 'neutral'} hint="Unreachable — not counted as off duty" href="/super-admin/duty-roster?status=stale" />
        <Kpi label="Unacknowledged SOS" value={d.sos.unacknowledged} icon={<Siren className="h-4 w-4" />} tone={d.sos.unacknowledged ? 'rose' : 'neutral'} hint={`${d.sos.active} active · ${d.sos.unassigned} unassigned`} href="/super-admin/emergency-alerts" />
        <Kpi label="Responders on emergencies" value={d.sos.respondersAssigned} icon={<HeartPulse className="h-4 w-4" />} hint="Holding an open assignment" />
        <Kpi label="Open complaints" value={d.incidents.open} icon={<FolderOpen className="h-4 w-4" />} tone={d.incidents.overdueAcknowledgement + d.incidents.overdueResolution ? 'amber' : 'neutral'} hint={`${d.incidents.overdueAcknowledgement} overdue acknowledgement · ${d.incidents.overdueResolution} overdue resolution`} href="/super-admin/incidents" />
        <Kpi label="Active location shares" value={d.location.activeSecurityShares} icon={<MapPin className="h-4 w-4" />} hint={`Consented, shared with Campus Security · ${d.location.activeTrustedContactShares} with trusted contacts`} href="/super-admin/live-map" />
        <Kpi label="Delivery failures (24h)" value={failures} icon={<BellOff className="h-4 w-4" />} tone={failures ? 'rose' : 'neutral'} hint={`${d.delivery.emailFailed24h} email · ${d.delivery.alertDeliveryFailed24h} SOS · ${d.delivery.pushFailed24h} push · ${d.delivery.jobsFailed} failed jobs`} href="/super-admin/notifications" />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Duty distribution" description="All accounts that can respond to SOS." action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/duty-roster">Roster</Link></Button>} />
          <div className="p-5"><DutyBar d={d.duty} /></div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Authentication & security (7 days)" action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/security">Details</Link></Button>} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
            {([
              ['Failed sign-ins', sec.loginFailures7d], ['Failed 2-step codes', sec.mfaFailures7d], ['Replayed codes blocked', sec.replayBlocked7d], ['2-step lockouts', sec.mfaLockouts7d],
              ['Recovery codes used', sec.recoveryCodesUsed7d], ['Access denied', sec.accessDenied7d], ['Private chat reviews', sec.privateChatReviews7d], ['Location detail views', sec.locationDetailViews7d],
            ] as [string, number][]).map(([k, v]) => <div key={k}><dt className="text-xs text-ink-soft">{k}</dt><dd className="tabular text-lg font-semibold text-ink-strong">{v}</dd></div>)}
          </dl>
          {sec.lockedAccounts > 0 && <div className="px-5 pb-5"><Badge tone="amber"><ShieldAlert className="h-3 w-3" /> {sec.lockedAccounts} account(s) locked now</Badge></div>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="System health & integrations" description="What is configured in this deployment — no assumptions." />
          <ul className="divide-y divide-line">
            <HealthRow icon={<Database className="h-4 w-4 text-brand-700" />} label="Database" value={d.health.database} ok={d.health.database === 'ok'} />
            <HealthRow icon={<Server className="h-4 w-4 text-brand-700" />} label="Background worker" value={d.health.worker} ok={d.health.worker.startsWith('running')} />
            <HealthRow icon={<RadioTower className="h-4 w-4 text-brand-700" />} label="Push notifications (FCM)" value={d.health.push} ok={d.health.push === 'configured'} />
            <HealthRow icon={<ShieldCheck className="h-4 w-4 text-brand-700" />} label="Cloudflare Turnstile" value={d.health.turnstile} ok={d.health.turnstile === 'configured'} />
            <HealthRow icon={<KeyRound className="h-4 w-4 text-brand-700" />} label="Google OAuth" value={platform?.health.googleOAuth ?? d.health.googleOAuth} ok={null} />
            <HealthRow icon={<Siren className="h-4 w-4 text-brand-700" />} label="SMS gateway for SOS" value={d.health.sms} ok={false} />
            {platform && <HealthRow icon={<Server className="h-4 w-4 text-brand-700" />} label="Email provider" value={platform.health.emailProvider} ok={platform.health.emailProvider !== 'console'} />}
            {platform && <HealthRow icon={<Server className="h-4 w-4 text-brand-700" />} label="Background jobs" value={`${platform.health.jobsPending} pending · ${platform.health.jobsFailed} failed`} ok={platform.health.jobsFailed === 0} />}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Accounts by role" action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/users">Manage</Link></Button>} />
          {!platform ? <div className="p-5"><Skeleton className="h-40" /></div> : (
            <>
              <ul className="divide-y divide-line">
                {ROLES.map((r) => <li key={r} className="flex justify-between px-5 py-2 text-sm"><span>{ROLE_LABELS[r]}</span><strong className="tabular">{platform.users.byRole[r] ?? 0}</strong></li>)}
              </ul>
              <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-ink-soft"><Users className="h-3.5 w-3.5" /> {platform.users.total} accounts · {platform.users.activeSessions} active sessions</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
