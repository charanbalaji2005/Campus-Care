'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { EyeOff, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

interface Report { id: string; reason: string; status: string; createdAt: string; channel?: string; message: { id: string; body: string; senderLabel: string; hidden: boolean; createdAt: string } | null }

export default function ModerationPage() {
  const [status, setStatus] = React.useState('open');
  const { data, error, mutate } = useApi<Report[]>(`/chat/moderation/reports?status=${status}`, { refreshInterval: 30000 });

  async function act(id: string, action: 'hide' | 'dismiss') {
    try {
      await api.post(`/chat/moderation/reports/${id}`, { action });
      toast.success(action === 'hide' ? 'Message hidden' : 'Report dismissed');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Community moderation" description="Reports on public community messages." actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status"><option value="open">Open</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option></Select>} />
      <Alert tone="neutral" icon={<ShieldCheck className="h-4 w-4" />}>Only community-channel messages appear here. Private support, counselling and case conversations are never shown to moderators.</Alert>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <Skeleton className="h-40" />}
      {data && !data.length && <Card><EmptyState title="Nothing to review" description="No reports with this status." /></Card>}
      <div className="space-y-3">
        {data?.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft"><Badge tone="amber">{r.reason}</Badge><span>in #{r.channel}</span><span>· reported {timeAgo(r.createdAt)}</span></div>
            {r.message ? (
              <div className="mt-3 rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-ink-soft">{r.message.senderLabel}{r.message.hidden && <Badge className="ml-2">Hidden</Badge>}</p>
                <p className="mt-1 whitespace-pre-line text-sm">{r.message.body}</p>
              </div>
            ) : <p className="mt-3 text-sm text-ink-soft">The message no longer exists.</p>}
            {r.status === 'open' && (
              <div className="mt-3 flex gap-2"><Button size="sm" variant="danger" onClick={() => act(r.id, 'hide')}><EyeOff className="h-4 w-4" /> Hide message</Button><Button size="sm" variant="outline" onClick={() => act(r.id, 'dismiss')}>Dismiss</Button></div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
