'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { CONTACT_CATEGORIES } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, SwitchRow } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';

interface Contact { id: string; name: string; purpose: string; category: string; phone: string | null; email: string | null; location: string | null; hours: string | null; verified: boolean; emergency: boolean; order: number }
type Draft = Omit<Contact, 'id' | 'phone' | 'email' | 'location' | 'hours'> & { phone: string; email: string; location: string; hours: string };
const EMPTY: Draft = { name: '', purpose: '', category: 'security', phone: '', email: '', location: '', hours: '', verified: false, emergency: false, order: 100 };

export default function AdminContactsPage() {
  const { data, error, mutate } = useApi<Contact[]>('/admin/contacts');
  const [edit, setEdit] = React.useState<Contact | 'new' | null>(null);
  const [v, setV] = React.useState<Draft>(EMPTY);
  const [del, setDel] = React.useState<Contact | null>(null);
  const [busy, setBusy] = React.useState(false);

  function open(c: Contact | 'new') {
    setEdit(c);
    setV(c === 'new' ? EMPTY : { ...c, phone: c.phone ?? '', email: c.email ?? '', location: c.location ?? '', hours: c.hours ?? '' });
  }
  async function save() {
    setBusy(true);
    try {
      if (edit === 'new') await api.post('/admin/contacts', v);
      else if (edit) await api.patch(`/admin/contacts/${edit.id}`, v);
      toast.success('Contact saved');
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
      await api.delete(`/admin/contacts/${del.id}`);
      setDel(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const sorted = [...(data ?? [])].sort((a, b) => Number(b.emergency) - Number(a.emergency) || a.order - b.order);

  return (
    <div>
      <PageHeader title="Emergency contacts" description="The directory students see. Mark a contact verified only after calling the number to confirm it." actions={<Button onClick={() => open('new')}><Plus className="h-4 w-4" /> Add contact</Button>} />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <Skeleton className="h-48" />}
      {data && !data.length && <Card><EmptyState icon={<Phone className="h-6 w-6" />} title="No contacts yet" description="Add campus security, the health centre and helplines first." /></Card>}
      <Card className="divide-y divide-slate-100">
        {sorted.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{c.name}</p><Badge tone="brand">{humanize(c.category)}</Badge>{c.emergency && <Badge tone="rose">Emergency</Badge>}{c.verified ? <Badge tone="brand"><BadgeCheck className="h-3 w-3" /> Verified</Badge> : <Badge tone="amber">Unverified</Badge>}</div>
              <p className="text-sm text-ink-soft">{[c.phone, c.email, c.location, c.hours].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" onClick={() => open(c)} aria-label="Edit"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setDel(c)} aria-label="Delete"><Trash2 className="h-4 w-4" /></Button></div>
          </div>
        ))}
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit === 'new' ? 'Add contact' : 'Edit contact'} className="max-w-xl">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ct-name" label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
              <Field id="ct-cat" label="Category"><Select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>{CONTACT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
              <Field id="ct-phone" label="Phone"><Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
              <Field id="ct-email" label="Email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
              <Field id="ct-loc" label="Location"><Input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} /></Field>
              <Field id="ct-hours" label="Hours"><Input value={v.hours} placeholder="24×7" onChange={(e) => setV({ ...v, hours: e.target.value })} /></Field>
            </div>
            <Field id="ct-purpose" label="What they help with"><Input value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} /></Field>
            <Field id="ct-order" label="Display order" hint="Lower numbers appear first."><Input type="number" value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} /></Field>
            <SwitchRow id="ct-em" label="Emergency contact" description="Shown on the SOS screen and at the top of the directory." checked={v.emergency} onCheckedChange={(x) => setV({ ...v, emergency: x })} />
            <SwitchRow id="ct-ver" label="Verified" description="Confirm you have tested this number recently." checked={v.verified} onCheckedChange={(x) => setV({ ...v, verified: x })} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.name}?`} destructive confirmLabel="Delete" loading={busy} onConfirm={remove} />
    </div>
  );
}
