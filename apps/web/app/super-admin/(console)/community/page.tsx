'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Lightbulb, PackageSearch } from 'lucide-react';
import { SUGGESTION_STATUSES } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize, timeAgo } from '@/lib/utils';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';

interface Suggestion { id: string; category: string; text: string; status: string; response?: string | null; anonymous: boolean; createdAt: string }
interface Listing { id: string; type: 'lost' | 'found'; title: string; description: string; category: string; location: string; status: string; createdAt: string }

function Suggestions() {
  const [status, setStatus] = React.useState('new');
  const { data, mutate } = useApi<Suggestion[]>(`/community/manage/suggestions?status=${status}`);
  const [edit, setEdit] = React.useState<{ s: Suggestion; status: string; response: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    if (!edit) return;
    setBusy(true);
    try {
      await api.patch(`/community/manage/suggestions/${edit.s.id}`, { status: edit.status, response: edit.response || undefined });
      toast.success('Response saved');
      setEdit(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Safety suggestions" description="Ideas from students. Marking one as Done publishes it with your response in the app's “You said, we did”." action={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36" aria-label="Filter by status">{SUGGESTION_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>} />
      {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : !data.length ? <EmptyState icon={<Lightbulb className="h-6 w-6" />} title="Nothing here" /> : (
        <ul className="divide-y divide-line">
          {data.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p><Badge>{humanize(s.category)}</Badge> <span className="text-xs text-ink-soft">{timeAgo(s.createdAt)}{s.anonymous ? ' · anonymous' : ''}</span></p>
                <p className="mt-1 text-ink">{s.text}</p>
                {s.response && <p className="mt-1 text-xs text-brand-700">Response: {s.response}</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => setEdit({ s, status: s.status === 'new' ? 'reviewed' : s.status, response: s.response ?? '' })}>Respond</Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(edit)} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title="Respond to suggestion">
          {edit && (
            <div className="space-y-3">
              <p className="text-sm">{edit.s.text}</p>
              <Field id="s-st" label="Status"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{SUGGESTION_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
              <Field id="s-resp" label="Public response"><Textarea rows={3} maxLength={1000} value={edit.response} onChange={(e) => setEdit({ ...edit, response: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LostFound() {
  const { data, mutate } = useApi<Listing[]>('/community/manage/lost-found');
  const [removing, setRemoving] = React.useState<Listing | null>(null);
  const [reason, setReason] = React.useState('Community guidelines');
  return (
    <Card>
      <CardHeader title="Lost & found listings" description="Remove listings that break community guidelines (for example photos of someone's ID card). The poster is notified." />
      {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : !data.length ? <EmptyState icon={<PackageSearch className="h-6 w-6" />} title="No listings" /> : (
        <ul className="divide-y divide-line">
          {data.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium text-ink-strong">{l.title} <Badge tone={l.type === 'lost' ? 'rose' : 'brand'}>{l.type === 'lost' ? 'Lost' : 'Found'}</Badge> <Badge>{humanize(l.status)}</Badge></p>
                <p className="text-ink">{l.description}</p>
                <p className="mt-1 text-xs text-ink-soft">{humanize(l.category)} · {l.location} · {timeAgo(l.createdAt)}</p>
              </div>
              {l.status !== 'removed' && <Button size="sm" variant="outline" onClick={() => setRemoving(l)}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title="Remove listing?" description="It disappears from the app and the poster is told why." destructive confirmLabel="Remove"
        onConfirm={async () => {
          try { await api.post(`/community/lost-found/${removing!.id}/status`, { status: 'removed', reason }); setRemoving(null); void mutate(); } catch (err) { toast.error(errorMessage(err)); }
        }}>
        <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label="Reason shown to the poster" />
      </ConfirmDialog>
    </Card>
  );
}

export default function CommunitySafetyPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Community safety" description="Anonymous suggestions and lost & found from the app. Hazard reports are under Safety intelligence; chat reports under Community moderation." />
      <Tabs defaultValue="suggestions">
        <TabsList><TabsTrigger value="suggestions">Suggestions</TabsTrigger><TabsTrigger value="lostfound">Lost &amp; found</TabsTrigger></TabsList>
        <TabsContent value="suggestions" className="mt-4"><Suggestions /></TabsContent>
        <TabsContent value="lostfound" className="mt-4"><LostFound /></TabsContent>
      </Tabs>
    </div>
  );
}
