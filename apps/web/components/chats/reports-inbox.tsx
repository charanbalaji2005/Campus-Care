'use client';

import * as React from 'react';
import useSWRInfinite from 'swr/infinite';
import { AlertTriangle, ArrowLeft, FolderOpen, Lock, SlidersHorizontal, X } from 'lucide-react';
import { CATEGORY_INFO, INCIDENT_CATEGORIES, INCIDENT_STATUSES, PRIORITIES, STATUS_LABELS } from '@campuscare/shared';
import { api, type ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, humanize } from '@/lib/utils';
import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton } from '@/components/ui/primitives';
import { PriorityBadge, StatusBadge, categoryLabel } from '@/components/case/case-ui';
import { CaseWorkspace } from '@/components/case/case-workspace';
import { listStamp } from './chats-ui';

export interface ReportRow {
  id: string; caseNumber: string; title: string; category: string; status: string; priority: string; urgent: boolean; anonymous: boolean;
  createdAt: string; updatedAt: string; lastMessageAt: string | null; overdue: boolean; assignedTo: string | null; committeeId: string | null;
}
interface Page { items: ReportRow[]; total: number; page: number; limit: number }

export interface ReportFilters { q: string; sort: string; status: string; category: string; priority: string; committeeId: string; assignedTo: string; from: string; to: string; quick: '' | 'new' | 'open' | 'urgent' | 'overdue' }
export const EMPTY_FILTERS: ReportFilters = { q: '', sort: 'newest', status: '', category: '', priority: '', committeeId: '', assignedTo: '', from: '', to: '', quick: '' };

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'updated', label: 'Last updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
];

const PAGE = 25;

/**
 * The original incident records, read through the existing GET /incidents API (scope=triage for
 * administrators, assigned for committee handlers). Triage scope returns metadata only.
 */
export function ReportsList({ scope, selectedId, onSelect, filters, setFilters }: { scope: 'triage' | 'assigned'; selectedId: string | null; onSelect: (id: string) => void; filters: ReportFilters; setFilters: (f: ReportFilters) => void }) {
  const [showFilters, setShowFilters] = React.useState(false);
  const [q, setQ] = React.useState(filters.q);
  React.useEffect(() => { const t = setTimeout(() => { if (q !== filters.q) setFilters({ ...filters, q }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: committees } = useApi<{ id: string; name: string }[]>(showFilters ? '/committees' : null);
  const { data: staff } = useApi<{ id: string; name: string; role: string }[]>(showFilters && scope === 'triage' ? `/admin/staff${filters.committeeId ? `?committeeId=${filters.committeeId}` : ''}` : null);

  const params = React.useMemo(() => {
    const p = new URLSearchParams({ scope, limit: String(PAGE), sort: filters.sort });
    for (const k of ['q', 'status', 'category', 'priority', 'committeeId', 'assignedTo', 'from', 'to'] as const) if (filters[k]) p.set(k, filters[k]);
    if (filters.quick === 'new') p.set('status', 'submitted');
    if (filters.quick === 'open') p.set('open', 'true');
    if (filters.quick === 'urgent') { p.set('urgent', 'true'); p.set('open', 'true'); }
    if (filters.quick === 'overdue') p.set('overdue', 'true');
    return p.toString();
  }, [scope, filters]);

  const { data, error, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<Page, ApiError>(
    (index, prev) => (prev && prev.items.length < PAGE ? null : `/incidents?${params}&page=${index + 1}`),
    (path: string) => api.get<Page>(path),
    { refreshInterval: 30000, revalidateFirstPage: true },
  );
  const rows = data?.flatMap((p) => p.items) ?? [];
  const total = data?.[0]?.total ?? 0;
  const hasMore = rows.length < total;
  const activeCount = (['status', 'category', 'priority', 'committeeId', 'assignedTo', 'from', 'to'] as const).filter((k) => filters[k]).length;
  const set = (patch: Partial<ReportFilters>) => setFilters({ ...filters, ...patch });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={scope === 'triage' ? 'Search by report ID' : 'Search report ID or title'} aria-label="Search reports" className="h-9" />
          <Button variant={showFilters || activeCount ? 'brand' : 'outline'} size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-label="Filters">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Quick filters">
          {([['', 'All'], ['new', 'New'], ['open', 'Open'], ['urgent', 'Urgent'], ['overdue', 'Overdue']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => set({ quick: k })} aria-pressed={filters.quick === k}
              className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition', filters.quick === k ? 'bg-forest text-white' : 'bg-slate-100 text-ink hover:bg-brand-50')}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="report-sort" className="text-xs text-ink-soft">Sort</label>
          <Select id="report-sort" value={filters.sort} onChange={(e) => set({ sort: e.target.value })} className="h-8 py-0 text-xs">{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-warm p-2">
            <Select aria-label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value, quick: '' })} className="h-8 py-0 text-xs"><option value="">Any status</option>{INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</Select>
            <Select aria-label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })} className="h-8 py-0 text-xs"><option value="">Any category</option>{INCIDENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_INFO[c].label}</option>)}</Select>
            <Select aria-label="Priority" value={filters.priority} onChange={(e) => set({ priority: e.target.value })} className="h-8 py-0 text-xs"><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select>
            <Select aria-label="Committee" value={filters.committeeId} onChange={(e) => set({ committeeId: e.target.value })} className="h-8 py-0 text-xs"><option value="">Any committee</option>{committees?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select aria-label="Handler" value={filters.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })} className="col-span-2 h-8 py-0 text-xs"><option value="">Any handler</option><option value="unassigned">No case owner yet</option>{staff?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <label className="text-[11px] text-ink-soft">From<Input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className="h-8 text-xs" /></label>
            <label className="text-[11px] text-ink-soft">To<Input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className="h-8 text-xs" /></label>
            {activeCount > 0 && <Button variant="ghost" size="sm" className="col-span-2" onClick={() => { setQ(''); setFilters({ ...EMPTY_FILTERS, sort: filters.sort }); }}><X className="h-3.5 w-3.5" /> Reset filters</Button>}
          </div>
        )}
        <p className="text-[11px] text-ink-soft" aria-live="polite">{data ? `${total} report${total === 1 ? '' : 's'}` : ' '}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="p-3"><ErrorState message={error.message} onRetry={() => mutate()} /></div>}
        {isLoading && <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
        {data && !rows.length && (
          <EmptyState icon={<FolderOpen className="h-6 w-6" />} title="No reports" description="Nothing matches these filters."
            action={(activeCount > 0 || filters.quick || filters.q) ? <Button variant="outline" size="sm" onClick={() => { setQ(''); setFilters(EMPTY_FILTERS); }}>Reset filters</Button> : undefined} />
        )}
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onSelect(r.id)} aria-current={selectedId === r.id}
                className={cn('flex w-full gap-3 px-3 py-3 text-left transition hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:outline-none', selectedId === r.id && 'bg-brand-50')}>
                <div className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', r.status === 'submitted' ? 'bg-brand-500' : 'bg-transparent')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="tabular truncate text-xs font-semibold text-ink-soft">{r.caseNumber}</span>
                    <span className="shrink-0 text-[11px] text-ink-soft">{listStamp(r.updatedAt)}</span>
                  </div>
                  <p className={cn('truncate text-sm text-ink-strong', r.status === 'submitted' ? 'font-bold' : 'font-medium')}>{r.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <StatusBadge status={r.status} />
                    {(r.urgent || r.priority === 'urgent' || r.priority === 'high') && <PriorityBadge priority={r.priority} urgent={r.urgent} />}
                    {r.overdue && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-rose-700"><AlertTriangle className="h-3 w-3" />Overdue</span>}
                    {r.anonymous && <Badge tone="dark" className="px-2 py-0 text-[10px]">Anonymous</Badge>}
                    <span className="truncate text-[11px] text-ink-soft">{categoryLabel(r.category)}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
        {hasMore && <div className="p-3 text-center"><Button variant="outline" size="sm" loading={isValidating} onClick={() => setSize(size + 1)}>Load more</Button></div>}
      </div>
    </div>
  );
}

export function ReportDetail({ id, onBack, onChanged, triage }: { id: string; onBack: () => void; onChanged: () => void; triage: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1 text-ink-soft hover:bg-slate-100 lg:hidden" aria-label="Back to reports"><ArrowLeft className="h-5 w-5" /></button>
        <p className="font-semibold text-ink-strong">Report</p>
        {triage && <span className="ml-auto inline-flex items-center gap-1 text-xs text-ink-soft"><Lock className="h-3.5 w-3.5" /> Content restricted to the assigned committee</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAF6] p-4 sm:p-6">
        <CaseWorkspace key={id} caseId={id} embedded onChanged={onChanged} />
      </div>
    </div>
  );
}
