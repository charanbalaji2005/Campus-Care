'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Database, Globe, Inbox, KeyRound, Mail, MessagesSquare, ShieldCheck, Users } from 'lucide-react';
import { MEDIA_SCOPES, MEDIA_SCOPE_LABELS, ROLE_LABELS, ROLES, type PlatformSettings } from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import { Badge, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';

interface Dashboard {
  users: { total: number; byRole: Record<string, number>; activeSessions: number };
  domains: Record<string, number>;
  health: { database: string; emailProvider: string; emailFailures24h: number; jobsPending: number; jobsFailed: number; turnstile: string; googleOAuth: string; inboundQuarantined7d: number; storage: string };
  features: { sos: boolean; safeWalk: boolean; community: boolean; chatMedia: PlatformSettings['chat']['media']; maintenanceMode: boolean };
}

function HealthRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
      <span className="flex items-center gap-2">{icon}{label}</span>
      <span className={ok ? 'flex items-center gap-1 text-brand-700' : 'flex items-center gap-1 text-amber-700'}>{ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{value}</span>
    </li>
  );
}

export default function SuperAdminDashboard() {
  const { data, error, mutate } = useApi<Dashboard>('/super-admin/dashboard', { refreshInterval: 60000 });
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-72" /></div>;
  const h = data.health;
  const mediaOn = MEDIA_SCOPES.filter((s) => data.features.chatMedia[s].images || data.features.chatMedia[s].videos);
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Health, configuration and access at a glance." />
      {data.features.maintenanceMode && <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">Maintenance mode is ON. Students cannot submit reports, chat or book appointments. SOS and Safe Walk remain available.</Card>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Accounts" value={data.users.total} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Active sessions" value={data.users.activeSessions} icon={<KeyRound className="h-5 w-5" />} />
        <StatCard label="Active domains" value={data.domains.active ?? 0} icon={<Globe className="h-5 w-5" />} hint={`${data.domains.pending_verification ?? 0} pending verification`} />
        <StatCard label="Email failures (24h)" value={h.emailFailures24h} icon={<Mail className="h-5 w-5" />} tone={h.emailFailures24h ? 'rose' : 'dark'} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="System health" />
          <ul className="divide-y divide-slate-100">
            <HealthRow icon={<Database className="h-4 w-4 text-brand-700" />} label="Database" value={h.database} ok={h.database === 'ok'} />
            <HealthRow icon={<Mail className="h-4 w-4 text-brand-700" />} label="Email provider" value={h.emailProvider} ok={h.emailProvider !== 'console'} />
            <HealthRow icon={<ShieldCheck className="h-4 w-4 text-brand-700" />} label="Cloudflare Turnstile" value={h.turnstile} ok={h.turnstile === 'configured'} />
            <HealthRow icon={<KeyRound className="h-4 w-4 text-brand-700" />} label="Google sign-in" value={h.googleOAuth} ok />
            <HealthRow icon={<Inbox className="h-4 w-4 text-brand-700" />} label="Background jobs" value={`${h.jobsPending} pending · ${h.jobsFailed} failed`} ok={h.jobsFailed === 0} />
            <HealthRow icon={<Inbox className="h-4 w-4 text-brand-700" />} label="Inbound email quarantined (7d)" value={String(h.inboundQuarantined7d)} ok={h.inboundQuarantined7d === 0} />
          </ul>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Safety & chat features" action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/chat">Configure</Link></Button>} />
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              <Badge tone={data.features.sos ? 'brand' : 'rose'}>SOS {data.features.sos ? 'on' : 'OFF'}</Badge>
              <Badge tone={data.features.safeWalk ? 'brand' : 'neutral'}>Safe Walk {data.features.safeWalk ? 'on' : 'off'}</Badge>
              <Badge tone={data.features.community ? 'brand' : 'neutral'}>Community {data.features.community ? 'on' : 'off'}</Badge>
              <Badge tone={mediaOn.length ? 'amber' : 'neutral'}><MessagesSquare className="h-3 w-3" /> Media: {mediaOn.length ? mediaOn.map((s) => MEDIA_SCOPE_LABELS[s]).join(', ') : 'off everywhere'}</Badge>
            </div>
          </Card>
          <Card>
            <CardHeader title="Accounts by role" action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/users">Manage</Link></Button>} />
            <ul className="divide-y divide-slate-100">
              {ROLES.map((r) => <li key={r} className="flex justify-between px-5 py-2.5 text-sm"><span>{ROLE_LABELS[r]}</span><strong>{data.users.byRole[r] ?? 0}</strong></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
