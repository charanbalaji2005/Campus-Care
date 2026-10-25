'use client';

import { Lock } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { Alert, Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';

export default function AdminAppointmentsPage() {
  const { data, error, mutate } = useApi<{ byStatus: Record<string, number>; byMonth: { month: string; count: number }[]; today: number; pending: number }>('/counselling/stats');
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  if (!data) return <Skeleton className="h-96" />;
  const statuses = Object.entries(data.byStatus).map(([s, count]) => ({ status: humanize(s), count }));
  const total = statuses.reduce((a, b) => a + b.count, 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Counselling overview" description="Service-level figures for planning counsellor capacity." />
      <Alert tone="neutral" icon={<Lock className="h-4 w-4" />}>Administrators see aggregate counts only. Student names, session details and counselling notes are confidential to the counsellor.</Alert>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All appointments" value={total} />
        <StatCard label="Awaiting confirmation" value={data.pending} tone="amber" />
        <StatCard label="Sessions today" value={data.today} />
        <StatCard label="Completed" value={data.byStatus.completed ?? 0} tone="dark" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Appointments per month" /><div className="h-72 p-4"><ResponsiveContainer><BarChart data={data.byMonth}><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis dataKey="month" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Appointments" fill="#059669" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card><CardHeader title="By status" /><div className="h-72 p-4"><ResponsiveContainer><BarChart data={statuses} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="status" width={110} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Appointments" fill="#064E3B" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></Card>
      </div>
    </div>
  );
}
