'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';

interface Announcement { id: string; title: string; body: string; pinned: boolean; published: boolean; createdAt: string }
const EMPTY = { title: '', body: '', pinned: false, published: true };

export default function AnnouncementsPage() {
  const { data, error, mutate } = useApi<Announcement[]>('/admin/announcements');
  const [edit, setEdit] = React.useState<Announcement | 'new' | null>(null);
  const [v, setV] = React.useState(EMPTY);
  const [del, setDel] = React.useState<Announcement | null>(null);
  const [busy, setBusy] = React.useState(false);

  function open(a: Announcement | 'new') {
    setEdit(a);
    setV(a === 'new' ? EMPTY : { title: a.title, body: a.body, pinned: a.pinned, published: a.published });
  }

  async function save() {
    setBusy(true);
    try {
      if (edit === 'new') await api.post('/admin/announcements', v);
      else if (edit) await api.patch(`/admin/announcements/${edit.id}`, v);
      toast.success('Announcement saved');
      setEdit(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.delete(`/admin/announcements/${del.id}`);
      toast.success('Announcement deleted');
      setDel(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Announcements" description="Notices shown on every student dashboard. For urgent safety messages use Campus alerts." actions={<Button onClick={() => open('new')}><Plus className="h-4 w-4" /> New announcement</Button>} />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <Skeleton className="h-48" />}
      {data && !data.length && <Card><EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" description="Publish your first notice for students." /></Card>}
      <div className="space-y-3">
        {data?.map((a) => (
          <Card key={a.id} className="flex items-start justify-between gap-4 p-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{a.title}</h2>{a.pinned && <Badge tone="amber"><Pin className="h-3 w-3" /> Pinned</Badge>}{!a.published && <Badge>Draft</Badge>}</div>
              <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-ink-soft">{a.body}</p>
              <p className="mt-2 text-xs text-ink-soft">{formatDate(a.createdAt)}</p>
            </div>
            <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onClick={() => open(a)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setDel(a)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></div>
          </Card>
        ))}
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit === 'new' ? 'New announcement' : 'Edit announcement'}>
          <div className="space-y-4">
            <Field id="a-title" label="Title" required><Input value={v.title} maxLength={140} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field id="a-body" label="Message" required><Textarea rows={6} value={v.body} maxLength={5000} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
            <SwitchRow id="a-pin" label="Pin to top" checked={v.pinned} onCheckedChange={(x) => setV({ ...v, pinned: x })} />
            <SwitchRow id="a-pub" label="Published" description="Drafts are only visible to administrators." checked={v.published} onCheckedChange={(x) => setV({ ...v, published: x })} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this announcement?" description={del?.title} destructive confirmLabel="Delete" loading={busy} onConfirm={remove} />
    </div>
  );
}
