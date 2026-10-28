'use client';

import * as React from 'react';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { EmailTabs } from '@/components/super-admin/email-tabs';
import { DELIVERY_STATUS } from '@/components/super-admin/email-diagnostics';

interface Delivery { id: string; template: string; to: string; status: string; provider: string; attempts: number; lastError: string | null; bounceReason: string | null; providerResponse: string | null; sentAt: string | null; createdAt: string }

export default function EmailLogsPage() {
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const { data, error, mutate } = useApi<{ items: Delivery[]; total: number; page: number; limit: number }>(`/super-admin/email/logs?page=${page}&limit=50${status ? `&status=${status}` : ''}`, { refreshInterval: 20000 });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Email" actions={<Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40" aria-label="Status"><option value="">All</option><option value="queued">Queued</option><option value="accepted_by_provider">Accepted by provider</option><option value="bounced">Bounced</option><option value="rejected">Rejected</option><option value="failed">Failed</option></Select>} />
      <EmailTabs />
      <p className="mb-3 text-sm text-ink-soft">Recipient addresses are masked. Message bodies are not stored. “Accepted by provider” means the mail service took the message; a missing mailbox is reported later as Bounced.</p>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      <Card className="overflow-hidden">
        {!data && !error && <div className="p-5"><Skeleton className="h-40" /></div>}
        {data && !data.items.length && <EmptyState title="No emails yet" />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft"><tr><th className="px-4 py-3">Queued</th><th className="px-4 py-3">Template</th><th className="px-4 py-3">To</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Attempts</th><th className="px-4 py-3">Error</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((d) => (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{formatDateTime(d.createdAt)}</td>
                    <td className="px-4 py-2.5">{humanize(d.template)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{d.to}</td>
                    <td className="px-4 py-2.5"><Badge tone={(DELIVERY_STATUS[d.status] ?? { tone: 'neutral' as const }).tone}>{DELIVERY_STATUS[d.status]?.label ?? d.status}</Badge> <span className="text-xs text-ink-soft">{d.provider}</span></td>
                    <td className="px-4 py-2.5">{d.attempts}</td>
                    <td className={`max-w-xs truncate px-4 py-2.5 text-xs ${d.bounceReason || d.lastError ? 'text-rose-700' : 'text-ink-soft'}`} title={d.bounceReason ?? d.lastError ?? d.providerResponse ?? ''}>{d.bounceReason ?? d.lastError ?? d.providerResponse ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && pages > 1 && <div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button></div>}
    </div>
  );
}
