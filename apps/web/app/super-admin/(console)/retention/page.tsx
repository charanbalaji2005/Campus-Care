'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Info, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

interface Preview { notifications: number; communityMessages: number; auditLogs: number; note: string }

export default function RetentionPage() {
  const s = useSectionDraft('retention');
  const run = useSensitiveAction();
  const { data: preview, mutate } = useApi<Preview>('/super-admin/retention/preview');
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function apply() {
    if (typed !== 'APPLY RETENTION') { toast.error('Type APPLY RETENTION exactly.'); return; }
    setBusy(true);
    try {
      const r = await run(() => api.post<{ notifications: number; communityMessages: number; auditLogs: number }>('/super-admin/retention/run', { confirm: typed }));
      if (r) {
        toast.success(`Deleted ${r.notifications} notifications, ${r.communityMessages} community messages, ${r.auditLogs} audit entries`);
        setOpen(false);
        setTyped('');
        void mutate();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Data retention" description="How long routine data is kept. Align these with your university's records policy and applicable law." />
      {s.draft && (
        <SectionCard title="Retention periods (days)" dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="r-n" label="Notifications"><Input type="number" min={7} value={s.draft.notificationsDays} onChange={(e) => s.setDraft({ ...s.draft!, notificationsDays: Number(e.target.value) })} /></Field>
            <Field id="r-c" label="Community messages"><Input type="number" min={7} value={s.draft.communityMessagesDays} onChange={(e) => s.setDraft({ ...s.draft!, communityMessagesDays: Number(e.target.value) })} /></Field>
            <Field id="r-a" label="Audit log" hint="Default is 7 years."><Input type="number" min={365} value={s.draft.auditLogDays} onChange={(e) => s.setDraft({ ...s.draft!, auditLogDays: Number(e.target.value) })} /></Field>
            <Field id="r-cc" label="Flag closed cases for review after" hint="Cases are flagged, never auto-deleted."><Input type="number" min={365} value={s.draft.closedCaseReviewDays} onChange={(e) => s.setDraft({ ...s.draft!, closedCaseReviewDays: Number(e.target.value) })} /></Field>
          </div>
        </SectionCard>
      )}
      <Card>
        <CardHeader title="Apply retention now" description="Permanently deletes records older than the saved periods." />
        <div className="space-y-4 px-5 pb-5">
          {!preview ? <Skeleton className="h-20" /> : (
            <ul className="space-y-1 text-sm">
              <li className="flex justify-between"><span>Notifications</span><strong>{preview.notifications}</strong></li>
              <li className="flex justify-between"><span>Community messages</span><strong>{preview.communityMessages}</strong></li>
              <li className="flex justify-between"><span>Audit log entries</span><strong>{preview.auditLogs}</strong></li>
            </ul>
          )}
          {preview && <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>{preview.note}</Alert>}
          <Button variant="danger" onClick={() => setOpen(true)}><Trash2 className="h-4 w-4" /> Apply retention…</Button>
        </div>
      </Card>
      <ConfirmDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(''); }} title="Permanently delete old records?" description="This cannot be undone. Type APPLY RETENTION to confirm." destructive confirmLabel="Delete records" loading={busy} onConfirm={apply}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="APPLY RETENTION" aria-label="Confirmation text" />
      </ConfirmDialog>
    </div>
  );
}
