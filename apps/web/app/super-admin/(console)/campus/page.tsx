'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Clock, FolderOpen, Siren, UserPlus, Users } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { humanize, timeAgo } from '@/lib/utils';
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';

interface Overview {
  users: { students: number; staff: number; pendingStaff: number };
  incidents: { today: number; thisWeek: number; thisMonth: number; pending: number; assigned: number; inProgress: number; resolved: number; total: number; overdue: number; unacknowledged: number };
  alerts: { activeSos: number };
  recentActivity: { id: string; action: string; at: string; targetType: string | null }[];
}

export default function AdminDashboard() {
  const { data, error, mutate } = useApi<Overview>('/admin/overview', { refreshInterval: 60000 });
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!data) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><div className="grid gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div><Skeleton className="h-64" /></div>;
  const i = data.incidents;
  return (
    <div className="space-y-6">
      <PageHeader title="Campus overview" description="Aggregate figures only. Case details stay with the assigned committee." actions={<Button asChild><Link href="/super-admin/chats?cat=reports">Open triage queue</Link></Button>} />
      {(i.overdue > 0 || i.unacknowledged > 0 || data.alerts.activeSos > 0) && (
        <Alert tone="rose" icon={<AlertTriangle className="h-4 w-4" />} title="Needs attention">
          {data.alerts.activeSos > 0 && <span className="block">{data.alerts.activeSos} SOS alert(s) are still open with campus security.</span>}
          {i.unacknowledged > 0 && <span className="block">{i.unacknowledged} case(s) passed the acknowledgement deadline.</span>}
          {i.overdue > 0 && <span className="block">{i.overdue} case(s) are past their resolution target.</span>}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Awaiting triage" value={i.pending} icon={<FolderOpen className="h-5 w-5" />} tone="amber" />
        <StatCard label="In progress" value={i.inProgress + i.assigned} icon={<Clock className="h-5 w-5" />} />
        <StatCard label="Resolved / closed" value={i.resolved} icon={<CheckCircle2 className="h-5 w-5" />} />
        <StatCard label="Active SOS" value={data.alerts.activeSos} icon={<Siren className="h-5 w-5" />} tone={data.alerts.activeSos ? 'rose' : 'dark'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Reports today" value={i.today} />
        <StatCard label="This week" value={i.thisWeek} />
        <StatCard label="Last 30 days" value={i.thisMonth} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent administrative activity" description="From the tamper-evident audit log." action={<Button size="sm" variant="outline" asChild><Link href="/super-admin/audit-logs">View all</Link></Button>} />
          {!data.recentActivity.length ? <EmptyState title="No activity yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm"><span className="font-medium">{humanize(a.action.replace('.', ' '))}</span><span className="text-ink-soft">{timeAgo(a.at)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="People" />
          <div className="space-y-3 p-5 text-sm">
            <p className="flex items-center justify-between"><span className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-700" /> Active students</span><strong>{data.users.students}</strong></p>
            <p className="flex items-center justify-between"><span className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-700" /> Active staff</span><strong>{data.users.staff}</strong></p>
            <p className="flex items-center justify-between"><span className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-amber-600" /> Pending invitations</span><strong>{data.users.pendingStaff}</strong></p>
            <Button variant="outline" size="sm" className="w-full" asChild><Link href="/super-admin/users">Manage users</Link></Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
