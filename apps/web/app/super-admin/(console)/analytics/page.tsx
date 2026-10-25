'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CATEGORY_INFO, INCIDENT_CATEGORIES } from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { categoryLabel } from '@/components/case/case-ui';

interface Analytics {
  monthly: { month: string; count: number }[];
  byCategory: { category: string; count: number }[];
  byCommittee: { committee: string; total: number; open: number }[];
  resolutionDays: { bucket: string; count: number }[];
  ageing: { bucket: string; count: number }[];
  byDepartment: { department: string; count: number }[];
  training: { module: string; completed: number; started: number }[];
  counselling: { status: string; count: number }[];
}

const GRID = '#E2E8F0';
const PRIMARY = '#059669';
const DARK = '#064E3B';

function ChartCard({ title, description, empty, children }: { title: string; description?: string; empty: boolean; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {empty ? <EmptyState title="No data for this period" /> : <div className="h-72 p-4"><ResponsiveContainer>{children}</ResponsiveContainer></div>}
    </Card>
  );
}

export default function AnalyticsPage() {
  const [months, setMonths] = React.useState('6');
  const [category, setCategory] = React.useState('');
  const { data, error, mutate } = useApi<Analytics>(`/admin/analytics?months=${months}${category ? `&category=${category}` : ''}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Aggregate trends for policy and resourcing. Department figures exclude anonymous reports and groups smaller than five to prevent re-identification."
        actions={
          <div className="flex gap-2">
            <Select value={months} onChange={(e) => setMonths(e.target.value)} className="w-36" aria-label="Period"><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option><option value="24">24 months</option></Select>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44" aria-label="Category"><option value="">All categories</option>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_INFO[c].label}</option>)}</Select>
          </div>
        }
      />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <div className="grid gap-6 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-80" />)}</div>}
      {data && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Reports per month" empty={!data.monthly.length}>
            <LineChart data={data.monthly}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="month" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Line type="monotone" dataKey="count" name="Reports" stroke={PRIMARY} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart>
          </ChartCard>
          <ChartCard title="By category" empty={!data.byCategory.length}>
            <BarChart data={data.byCategory.map((c) => ({ ...c, label: categoryLabel(c.category) }))} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="label" width={130} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Reports" fill={PRIMARY} radius={[0, 6, 6, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="Committee workload" empty={!data.byCommittee.length}>
            <BarChart data={data.byCommittee}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="committee" fontSize={11} interval={0} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend /><Bar dataKey="total" name="Total" fill={DARK} radius={[6, 6, 0, 0]} /><Bar dataKey="open" name="Open" fill="#F59E0B" radius={[6, 6, 0, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="Time to resolution" empty={!data.resolutionDays.length}>
            <BarChart data={data.resolutionDays}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="bucket" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Cases" fill={PRIMARY} radius={[6, 6, 0, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="Age of open cases" description="All open cases, regardless of filters." empty={!data.ageing.length}>
            <BarChart data={data.ageing}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="bucket" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Open cases" fill="#F59E0B" radius={[6, 6, 0, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="By department" description="Groups under 5 are hidden." empty={!data.byDepartment.length}>
            <BarChart data={data.byDepartment} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="department" width={160} fontSize={11} /><Tooltip /><Bar dataKey="count" name="Reports" fill={DARK} radius={[0, 6, 6, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="Training completion" empty={!data.training.length}>
            <BarChart data={data.training}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="module" fontSize={11} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend /><Bar dataKey="started" name="Started" fill="#A7F3D0" radius={[6, 6, 0, 0]} /><Bar dataKey="completed" name="Completed" fill={PRIMARY} radius={[6, 6, 0, 0]} /></BarChart>
          </ChartCard>
          <ChartCard title="Counselling appointments" empty={!data.counselling.length}>
            <BarChart data={data.counselling.map((c) => ({ ...c, label: humanize(c.status) }))}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="label" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Appointments" fill={DARK} radius={[6, 6, 0, 0]} /></BarChart>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
