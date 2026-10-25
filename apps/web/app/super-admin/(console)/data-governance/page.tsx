'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Database, Info } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface DataRequest {
  id: string; type: 'export' | 'deletion'; status: 'pending' | 'completed' | 'rejected'; reason?: string | null; note?: string | null; createdAt: string; decidedAt?: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
}

/** Export and deletion requests students and staff make from the app's Privacy & data screen. */
export default function DataGovernancePage() {
  const run = useSensitiveAction();
  const [status, setStatus] = React.useState('pending');
  const { data, mutate } = useApi<DataRequest[]>(`/super-admin/data-requests${status ? `?status=${status}` : ''}`);
  const [deciding, setDeciding] = React.useState<{ r: DataRequest; decision: 'complete' | 'reject'; note: string; confirm: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function decide() {
    if (!deciding) return;
    setBusy(true);
    try {
      const r = await run(() => api.post(`/super-admin/data-requests/${deciding.r.id}/decision`, { decision: deciding.decision, note: deciding.note || undefined, confirm: deciding.confirm || undefined }));
      if (r !== undefined) { toast.success('Decision recorded'); setDeciding(null); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const deleting = deciding?.decision === 'complete' && deciding.r.type === 'deletion';
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Data governance" description="Personal data requests from the app. Every decision is written to the audit log and the requester is notified." actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter" className="w-40"><option value="pending">Pending</option><option value="completed">Completed</option><option value="rejected">Rejected</option><option value="">All</option></Select>} />
      <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>
        Exports are self-service in the app (Profile → Privacy &amp; data → Download my data). Completing a deletion anonymises the account: name, email, phone, student ID, safety card, trusted contacts and location data are removed, while case records the university must keep are retained without identifying the person.
      </Alert>
      <Card>
        <CardHeader title="Requests" />
        {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : !data.length ? <EmptyState icon={<Database className="h-6 w-6" />} title="No requests" /> : (
          <ul className="divide-y divide-line">
            {data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-ink-strong">{r.user?.name ?? 'Unknown user'} <span className="text-xs font-normal text-ink-soft">{r.user?.email} · {r.user ? humanize(r.user.role) : ''}</span></p>
                  <p className="mt-0.5"><Badge tone={r.type === 'deletion' ? 'rose' : 'brand'}>{humanize(r.type)}</Badge> <Badge tone={r.status === 'pending' ? 'amber' : 'neutral'}>{humanize(r.status)}</Badge> <span className="text-xs text-ink-soft">{formatDateTime(r.createdAt)}</span></p>
                  {r.reason && <p className="mt-1 text-ink">Reason: {r.reason}</p>}
                  {r.note && <p className="mt-1 text-xs text-ink-soft">Note: {r.note}</p>}
                </div>
                {r.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDeciding({ r, decision: 'reject', note: '', confirm: '' })}>Reject</Button>
                    <Button size="sm" variant={r.type === 'deletion' ? 'danger' : 'default'} onClick={() => setDeciding({ r, decision: 'complete', note: '', confirm: '' })}>Complete</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent title={deciding?.decision === 'reject' ? 'Reject request' : deleting ? 'Delete (anonymise) account' : 'Complete request'} description={deleting ? 'This cannot be undone. The person is signed out everywhere.' : undefined}>
          {deciding && (
            <div className="space-y-3">
              <Field id="d-note" label={deciding.decision === 'reject' ? 'Reason shown to the requester' : 'Note (optional)'}><Textarea rows={3} maxLength={500} value={deciding.note} onChange={(e) => setDeciding({ ...deciding, note: e.target.value })} /></Field>
              {deleting && <Field id="d-confirm" label="Type DELETE ACCOUNT to confirm"><Input value={deciding.confirm} onChange={(e) => setDeciding({ ...deciding, confirm: e.target.value })} /></Field>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
                <Button variant={deleting ? 'danger' : 'default'} loading={busy} disabled={deleting && deciding.confirm !== 'DELETE ACCOUNT'} onClick={decide}>{deciding.decision === 'reject' ? 'Reject' : 'Confirm'}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
