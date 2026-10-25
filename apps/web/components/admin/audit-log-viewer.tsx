'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

interface Entry { id: string; seq: number; at: string; action: string; outcome: string; actor: string; actorRole: string | null; targetType: string | null; targetId: string | null; meta: Record<string, unknown> | null }

/** Audit log browser with hash-chain verification. Viewing the log is itself audited. */
export function AuditLogViewer() {
  const [action, setAction] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [open, setOpen] = React.useState<string | null>(null);
  const [verify, setVerify] = React.useState<{ ok: boolean; checked: number; brokenAtSeq?: number } | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const params = new URLSearchParams({ page: String(page), limit: '50', ...(action ? { action } : {}), ...(outcome ? { outcome } : {}), ...(from ? { from } : {}) });
  const { data, error, isLoading, mutate } = useApi<{ items: Entry[]; total: number; page: number; limit: number }>(`/admin/audit-logs?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  async function runVerify() {
    setVerifying(true);
    try {
      setVerify(await api.get('/admin/audit-logs/verify'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Audit logs" description="Append-only, hash-chained record of security-relevant actions. Personal content is never stored here." actions={<Button variant="outline" loading={verifying} onClick={runVerify}><ShieldCheck className="h-4 w-4" /> Verify integrity</Button>} />
      {verify && (verify.ok
        ? <Alert tone="brand" icon={<ShieldCheck className="h-4 w-4" />} title="Chain intact">{verify.checked} entries checked. No gaps or modifications were found.</Alert>
        : <Alert tone="rose" icon={<ShieldAlert className="h-4 w-4" />} title="Integrity problem">The chain breaks at entry #{verify.brokenAtSeq}. Entries may have been altered or removed outside the application. Escalate to your security team.</Alert>)}
      <div className="flex flex-col gap-2 md:flex-row">
        <Input placeholder="Action starts with… e.g. incident., auth.login" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} aria-label="Action filter" />
        <Select className="md:w-40" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} aria-label="Outcome"><option value="">All outcomes</option><option value="success">Success</option><option value="failure">Failure</option><option value="denied">Denied</option></Select>
        <Input type="date" className="md:w-44" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" />
      </div>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      <Card className="overflow-hidden">
        {isLoading && <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {data && !data.items.length && <EmptyState title="No entries" />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft"><tr><th className="px-4 py-3">#</th><th className="px-4 py-3">When</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Actor</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Outcome</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((e) => (
                  <React.Fragment key={e.id}>
                    <tr className="cursor-pointer hover:bg-mint/40" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="px-4 py-2.5 font-mono text-xs text-ink-soft">{e.seq}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-soft">{formatDateTime(e.at)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
                      <td className="px-4 py-2.5">{e.actor}{e.actorRole && <span className="text-xs text-ink-soft"> · {e.actorRole}</span>}</td>
                      <td className="px-4 py-2.5 text-xs text-ink-soft">{e.targetType ? `${e.targetType} ${e.targetId ?? ''}` : '—'}</td>
                      <td className="px-4 py-2.5"><Badge tone={e.outcome === 'success' ? 'brand' : e.outcome === 'denied' ? 'rose' : 'amber'}>{e.outcome}</Badge></td>
                    </tr>
                    {open === e.id && <tr><td colSpan={6} className="bg-slate-50 px-4 py-3"><pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(e.meta ?? {}, null, 2)}</pre></td></tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm"><span className="text-ink-soft">{data.total} entries · page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button></div></div>
      )}
    </div>
  );
}
