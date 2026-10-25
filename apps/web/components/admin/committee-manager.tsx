'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Lock, Pencil, Plus, Trash2, UserPlus } from 'lucide-react';
import { CATEGORY_INFO, COMMITTEE_TYPES, INCIDENT_CATEGORIES, ROLE_LABELS, type Role } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';

interface Member { id: string; name: string; email: string; role: Role; status: string; position: 'chair' | 'member' }
interface Committee {
  id: string; name: string; type: string; mandate: string; contactEmail: string | null; contactPhone: string | null; categories: string[];
  confidential: boolean; slaAcknowledgeHours: number; slaResolveDays: number; active: boolean; openCases: number; members: Member[];
}
type Draft = Omit<Committee, 'id' | 'openCases' | 'members' | 'contactEmail' | 'contactPhone'> & { contactEmail: string; contactPhone: string };

const EMPTY: Draft = { name: '', type: 'grievance', mandate: '', contactEmail: '', contactPhone: '', categories: [], confidential: false, slaAcknowledgeHours: 24, slaResolveDays: 30, active: true };

function CommitteeDialog({ initial, onClose, onDone }: { initial: Committee | 'new' | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (initial === 'new') setV(EMPTY);
    else if (initial) setV({ ...initial, contactEmail: initial.contactEmail ?? '', contactPhone: initial.contactPhone ?? '' });
  }, [initial]);
  if (!initial) return null;
  async function save() {
    setBusy(true);
    try {
      if (initial === 'new') await api.post('/admin/committees', v);
      else await api.patch(`/admin/committees/${(initial as Committee).id}`, v);
      toast.success('Committee saved');
      onClose();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={initial === 'new' ? 'New committee' : `Edit ${v.name}`} className="max-w-2xl">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="c-name" label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field id="c-type" label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{COMMITTEE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          </div>
          <Field id="c-mandate" label="Mandate" hint="Shown to students on the committee page."><Textarea value={v.mandate} onChange={(e) => setV({ ...v, mandate: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="c-email" label="Contact email"><Input type="email" value={v.contactEmail} onChange={(e) => setV({ ...v, contactEmail: e.target.value })} /></Field>
            <Field id="c-phone" label="Contact phone"><Input value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} /></Field>
            <Field id="c-ack" label="Acknowledge within (hours)"><Input type="number" min={1} value={v.slaAcknowledgeHours} onChange={(e) => setV({ ...v, slaAcknowledgeHours: Number(e.target.value) })} /></Field>
            <Field id="c-res" label="Resolve within (days)"><Input type="number" min={1} value={v.slaResolveDays} onChange={(e) => setV({ ...v, slaResolveDays: Number(e.target.value) })} /></Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Handles categories</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {INCIDENT_CATEGORIES.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={v.categories.includes(c)} onChange={(e) => setV({ ...v, categories: e.target.checked ? [...v.categories, c] : v.categories.filter((x) => x !== c) })} /> {CATEGORY_INFO[c].label}</label>)}
            </div>
          </fieldset>
          <SwitchRow id="c-conf" label="Confidential committee" description="Cases are treated as sensitive: triage administrators never see descriptions or evidence." checked={v.confidential} onCheckedChange={(x) => setV({ ...v, confidential: x })} />
          <SwitchRow id="c-active" label="Active" description="Inactive committees receive no new cases." checked={v.active} onCheckedChange={(x) => setV({ ...v, active: x })} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({ committee, onClose, onDone }: { committee: Committee | null; onClose: () => void; onDone: () => void }) {
  const { data: staff } = useApi<{ id: string; name: string; role: Role; email: string }[]>(committee ? '/admin/staff' : null);
  const [userId, setUserId] = React.useState('');
  const [position, setPosition] = React.useState<'member' | 'chair'>('member');
  const [busy, setBusy] = React.useState(false);
  if (!committee) return null;
  const options = (staff ?? []).filter((s) => !committee.members.some((m) => m.id === s.id));
  async function add() {
    setBusy(true);
    try {
      await api.post(`/admin/committees/${committee!.id}/members`, { userId, position });
      toast.success('Member added');
      setUserId('');
      onClose();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Add member to ${committee.name}`} description="Only active staff accounts can join a committee. Invite new staff from Users first.">
        <div className="space-y-4">
          <Field id="m-user" label="Staff member"><Select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{options.map((s) => <option key={s.id} value={s.id}>{s.name} · {ROLE_LABELS[s.role]}</option>)}</Select></Field>
          <Field id="m-pos" label="Position"><Select value={position} onChange={(e) => setPosition(e.target.value as 'member' | 'chair')}><option value="member">Member</option><option value="chair">Chair (can assign cases)</option></Select></Field>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!userId} loading={busy} onClick={add}>Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommitteeManager() {
  const { data, error, mutate } = useApi<Committee[]>('/admin/committees');
  const [edit, setEdit] = React.useState<Committee | 'new' | null>(null);
  const [adding, setAdding] = React.useState<Committee | null>(null);
  const [removing, setRemoving] = React.useState<{ c: Committee; m: Member } | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.delete(`/admin/committees/${removing.c.id}/members/${removing.m.id}`);
      toast.success('Member removed. Their open cases returned to the committee queue.');
      setRemoving(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Committees" description="Who handles which kind of case. Members only see cases routed to their committee." actions={<Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> New committee</Button>} />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>}
      {data && !data.length && <Card><EmptyState title="No committees yet" description="Create your anti-ragging, gender-sensitivity and grievance committees to start routing cases." /></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-ink-strong">{c.name}</h2>{c.confidential && <Badge tone="dark"><Lock className="h-3 w-3" /> Confidential</Badge>}{!c.active && <Badge>Inactive</Badge>}</div>
                <p className="text-xs text-ink-soft">{humanize(c.type)} · Acknowledge in {c.slaAcknowledgeHours}h · Resolve in {c.slaResolveDays}d</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEdit(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-4 w-4" /></Button>
            </div>
            {c.mandate && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{c.mandate}</p>}
            <div className="mt-3 flex flex-wrap gap-1">{c.categories.map((cat) => <Badge key={cat} tone="brand">{CATEGORY_INFO[cat as keyof typeof CATEGORY_INFO]?.label ?? cat}</Badge>)}</div>
            <div className="mt-4 flex items-center justify-between"><p className="text-sm font-medium">{c.members.length} member(s) · {c.openCases} open case(s)</p><Button size="sm" variant="outline" onClick={() => setAdding(c)}><UserPlus className="h-4 w-4" /> Add</Button></div>
            <ul className="mt-2 divide-y divide-slate-100">
              {c.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-2"><Avatar name={m.name} className="h-7 w-7 text-[10px]" /><span>{m.name} <span className="text-xs text-ink-soft">· {ROLE_LABELS[m.role]}</span></span>{m.position === 'chair' && <Badge tone="amber">Chair</Badge>}</span>
                  <Button variant="ghost" size="icon" onClick={() => setRemoving({ c, m })} aria-label={`Remove ${m.name}`}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <CommitteeDialog initial={edit} onClose={() => setEdit(null)} onDone={() => mutate()} />
      <AddMemberDialog committee={adding} onClose={() => setAdding(null)} onDone={() => mutate()} />
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} title={`Remove ${removing?.m.name}?`} description="They will lose access to this committee's cases immediately. Cases they owned go back to the committee queue." destructive confirmLabel="Remove" loading={busy} onConfirm={remove} />
    </div>
  );
}
