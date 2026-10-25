'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight, FolderOpen } from 'lucide-react';
import { INCIDENT_CATEGORIES, INCIDENT_STATUSES, STATUS_LABELS, CATEGORY_INFO } from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Skeleton } from '@/components/ui/primitives';
import { PriorityBadge, StatusBadge, categoryLabel } from '@/components/case/case-ui';

interface Row { id: string; caseNumber: string; title: string; category: string; status: string; priority: string; urgent: boolean; anonymous: boolean; createdAt: string; updatedAt: string; overdue: boolean; assignedTo: string | null; committeeId: string | null }

/** Case table used by committee members ("assigned" scope) and administrators ("triage" scope). */
export function CaseQueue({ scope, basePath, extraFilters }: { scope: 'assigned' | 'triage'; basePath: string; extraFilters?: React.ReactNode }) {
  const [status, setStatus] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [q, setQ] = React.useState('');
  const [mine, setMine] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const params = new URLSearchParams({ scope, page: String(page), limit: '25', ...(status ? { status } : {}), ...(category ? { category } : {}), ...(q ? { q } : {}), ...(mine ? { mine: 'true' } : {}) });
  const { data, error, isLoading, mutate } = useApi<{ items: Row[]; total: number; page: number; limit: number }>(`/incidents?${params}`, { refreshInterval: 30000 });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row">
        <Input placeholder={scope === 'triage' ? 'Search by case number' : 'Search case number or title'} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="md:w-48" aria-label="Status"><option value="">All statuses</option>{INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>
        <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="md:w-48" aria-label="Category"><option value="">All categories</option>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_INFO[c].label}</option>)}</Select>
        {scope === 'assigned' && <label className="flex items-center gap-2 whitespace-nowrap text-sm"><input type="checkbox" className="accent-brand-600" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Owned by me</label>}
        {extraFilters}
      </div>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      <Card className="overflow-hidden">
        {isLoading && <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {data && !data.items.length && <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="No cases" description="Nothing matches these filters." />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3"><span className="sr-only">Open</span></th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-brand-50/40">
                    <td className="px-4 py-3">
                      <Link href={`${basePath}/${r.id}`} className="block">
                        <span className="tabular block text-xs font-semibold text-ink-soft">{r.caseNumber}{r.anonymous && <Badge tone="dark" className="ml-2">Anon</Badge>}</span>
                        <span className="block max-w-xs truncate font-medium text-ink-strong">{r.title}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">{categoryLabel(r.category)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /> {r.overdue && <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" />Overdue</span>}</td>
                    <td className="px-4 py-3"><PriorityBadge priority={r.priority} urgent={r.urgent} /></td>
                    <td className="px-4 py-3 text-ink-soft">{timeAgo(r.updatedAt)}</td>
                    <td className="px-4 py-3 text-right"><Link href={`${basePath}/${r.id}`} aria-label={`Open ${r.caseNumber}`}><ChevronRight className="inline h-4 w-4 text-ink-soft" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="tabular">Page {page} of {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
