'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Film, ImageIcon, Info, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { MEDIA_SCOPES, MEDIA_SCOPE_LABELS, type MediaScope } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, Switch, SwitchRow, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

const SCOPE_HELP: Record<MediaScope, string> = {
  support: 'One-to-one conversations between a student and a support service (counselling desk, security desk, committee helpdesk).',
  counselling: 'Appointment conversations between a student and their counsellor.',
  case: 'The conversation attached to each complaint. Evidence uploads on the report form are controlled separately.',
  community: 'Public channels visible to all verified students.',
};
// Support first: it is the scope this switch is most often requested for.
const ORDER: MediaScope[] = ['support', ...MEDIA_SCOPES.filter((s) => s !== 'support')];

function MediaSettings() {
  const s = useSectionDraft('chat', ['media', 'maxImageMb', 'maxVideoMb']);
  const [confirmOn, setConfirmOn] = React.useState(false);
  if (!s.draft) return <Skeleton className="h-96" />;
  const d = s.draft;
  const setScope = (scope: MediaScope, kind: 'images' | 'videos', v: boolean) => s.setDraft({ ...d, media: { ...d.media, [scope]: { ...d.media[scope], [kind]: v } } });
  const enabledCount = MEDIA_SCOPES.reduce((n, sc) => n + Number(d.media[sc].images) + Number(d.media[sc].videos), 0);
  const turningOnCommunity = d.media.community.images || d.media.community.videos;

  return (
    <>
      <SectionCard
        title="Image & video sending"
        description="Off by default for every chat type. When off, the attach button is hidden and the server rejects media uploads and messages."
        dirty={s.dirty}
        saving={s.saving}
        onSave={() => (turningOnCommunity ? setConfirmOn(true) : void s.save())}
        onDiscard={s.discard}
        onDefaults={s.resetToDefaults}
      >
        <div className="mb-4 mt-4 flex flex-wrap items-center gap-2 text-sm">
          {enabledCount === 0 ? <Badge>All media sending off (default)</Badge> : <Badge tone="amber">{enabledCount} switch(es) on</Badge>}
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {ORDER.map((scope) => (
            <div key={scope} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${scope === 'support' ? 'bg-mint/40' : ''}`}>
              <div className="min-w-0">
                <p className="font-medium text-ink-strong">{MEDIA_SCOPE_LABELS[scope]}</p>
                <p className="text-xs text-ink-soft">{SCOPE_HELP[scope]}</p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 text-sm"><ImageIcon className="h-4 w-4 text-ink-soft" /><span>Images</span><Switch checked={d.media[scope].images} onCheckedChange={(v) => setScope(scope, 'images', v)} aria-label={`Allow images in ${MEDIA_SCOPE_LABELS[scope]}`} /><span className="w-6 text-xs text-ink-soft">{d.media[scope].images ? 'On' : 'Off'}</span></label>
                <label className="flex items-center gap-2 text-sm"><Film className="h-4 w-4 text-ink-soft" /><span>Videos</span><Switch checked={d.media[scope].videos} onCheckedChange={(v) => setScope(scope, 'videos', v)} aria-label={`Allow videos in ${MEDIA_SCOPE_LABELS[scope]}`} /><span className="w-6 text-xs text-ink-soft">{d.media[scope].videos ? 'On' : 'Off'}</span></label>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field id="max-img" label="Maximum image size (MB)" hint="JPEG, PNG, WebP or GIF. Checked by file signature, not extension."><Input type="number" min={1} max={25} value={d.maxImageMb} onChange={(e) => s.setDraft({ ...d, maxImageMb: Number(e.target.value) })} /></Field>
          <Field id="max-vid" label="Maximum video size (MB)" hint="MP4, WebM or QuickTime."><Input type="number" min={1} max={200} value={d.maxVideoMb} onChange={(e) => s.setDraft({ ...d, maxVideoMb: Number(e.target.value) })} /></Field>
        </div>
        <Alert tone="neutral" icon={<Info className="h-4 w-4" />} className="mt-4">
          Files are stored privately and are only downloadable by participants of the conversation. Turning a switch off stops new uploads immediately; files already sent remain visible to those participants.
        </Alert>
      </SectionCard>
      <ConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title="Allow media in community chat?"
        description="Community channels are visible to every verified student. Images and videos there increase the moderation workload and the risk of sharing harmful content. Make sure moderators are ready before enabling this."
        confirmLabel="Save and enable"
        onConfirm={async () => { setConfirmOn(false); await s.save(); }}
      />
    </>
  );
}

function CommunitySettings() {
  const s = useSectionDraft('chat', ['communityEnabled', 'communityPostRateLimitPerMinute']);
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Community chat" description="Public channels for verified students, with reporting and moderation." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard}>
      <SwitchRow id="community" label="Community chat enabled" description="When off, community channels are hidden. Private support chats are unaffected." checked={d.communityEnabled} onCheckedChange={(v) => s.setDraft({ ...d, communityEnabled: v })} />
      <Field id="rate" label="Posts per minute per student" className="mt-3 max-w-xs"><Input type="number" min={1} max={60} value={d.communityPostRateLimitPerMinute} onChange={(e) => s.setDraft({ ...d, communityPostRateLimitPerMinute: Number(e.target.value) })} /></Field>
    </SectionCard>
  );
}

interface Channel { id: string; kind: 'community' | 'support_service'; name: string; slug: string; description: string; published: boolean; order: number; readOnly: boolean; serviceRole: string | null; committeeId: string | null; threads: number; messages: number }
type Draft = { kind: Channel['kind']; name: string; slug: string; description: string; published: boolean; order: number; readOnly: boolean; serviceRole: string; committeeId: string };
const EMPTY: Draft = { kind: 'support_service', name: '', slug: '', description: '', published: false, order: 0, readOnly: false, serviceRole: 'counsellor', committeeId: '' };

function Channels() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<Channel[]>('/super-admin/chat/channels');
  const { data: committees } = useApi<{ id: string; name: string }[]>('/admin/committees');
  const [edit, setEdit] = React.useState<Channel | 'new' | null>(null);
  const [v, setV] = React.useState<Draft>(EMPTY);
  const [disable, setDisable] = React.useState<Channel | null>(null);
  const [busy, setBusy] = React.useState(false);

  function open(c: Channel | 'new') {
    setEdit(c);
    setV(c === 'new' ? EMPTY : { ...c, serviceRole: c.serviceRole ?? 'counsellor', committeeId: c.committeeId ?? '' });
  }
  async function save() {
    setBusy(true);
    const body = { ...v, serviceRole: v.kind === 'support_service' ? v.serviceRole : undefined, committeeId: v.kind === 'support_service' && v.serviceRole === 'committee_member' && v.committeeId ? v.committeeId : null };
    try {
      if (edit === 'new') await api.post('/super-admin/chat/channels', body);
      else if (edit) await api.patch(`/super-admin/chat/channels/${edit.id}`, body);
      toast.success('Channel saved');
      setEdit(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function togglePublished(c: Channel, published: boolean) {
    try {
      await api.patch(`/super-admin/chat/channels/${c.id}`, { published });
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function doDisable() {
    if (!disable) return;
    setBusy(true);
    try {
      const r = await run(() => api.delete(`/super-admin/chat/channels/${disable.id}`));
      if (r !== undefined) { toast.success('Channel unpublished. History is kept.'); setDisable(null); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const groups: { kind: Channel['kind']; title: string; desc: string }[] = [
    { kind: 'support_service', title: 'Private support services', desc: 'Students open a private one-to-one thread with the staff role that answers each service.' },
    { kind: 'community', title: 'Community channels', desc: 'Public, moderated discussion for verified students.' },
  ];

  return (
    <Card>
      <CardHeader title="Channels & services" description="Configuration only. Super Admins cannot read private conversations from here." action={<Button size="sm" onClick={() => open('new')}><Plus className="h-4 w-4" /> Add</Button>} />
      {!data ? <div className="p-5"><Skeleton className="h-32" /></div> : (
        <div className="space-y-6 px-5 pb-5">
          {groups.map((g) => {
            const list = data.filter((c) => c.kind === g.kind);
            return (
              <div key={g.kind}>
                <h3 className="font-semibold">{g.title}</h3>
                <p className="mb-2 text-xs text-ink-soft">{g.desc}</p>
                {!list.length ? <EmptyState title="None yet" /> : (
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {list.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-medium">{c.name} <span className="font-mono text-xs text-ink-soft">/{c.slug}</span></p>
                          <p className="text-xs text-ink-soft">{c.kind === 'support_service' ? `Answered by ${c.serviceRole?.replace('_', ' ')} · ${c.threads} thread(s)` : `${c.messages} message(s)${c.readOnly ? ' · read-only' : ''}`}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs text-ink-soft"><Switch checked={c.published} onCheckedChange={(x) => togglePublished(c, x)} aria-label={`Publish ${c.name}`} /> {c.published ? 'Published' : 'Hidden'}</label>
                          <Button variant="ghost" size="icon" onClick={() => open(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-4 w-4" /></Button>
                          {c.published && <Button variant="ghost" size="sm" onClick={() => setDisable(c)}>Disable</Button>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit === 'new' ? 'Add channel or service' : `Edit ${v.name}`}>
          <div className="space-y-4">
            <Field id="ch-kind" label="Type"><Select value={v.kind} disabled={edit !== 'new'} onChange={(e) => setV({ ...v, kind: e.target.value as Channel['kind'] })}><option value="support_service">Private support service</option><option value="community">Community channel</option></Select></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ch-name" label="Name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value, slug: edit === 'new' ? e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) : v.slug })} /></Field>
              <Field id="ch-slug" label="Slug" required><Input value={v.slug} onChange={(e) => setV({ ...v, slug: e.target.value })} /></Field>
            </div>
            <Field id="ch-desc" label="Description"><Textarea value={v.description} maxLength={300} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
            {v.kind === 'support_service' && (
              <>
                <Field id="ch-role" label="Answered by"><Select value={v.serviceRole} onChange={(e) => setV({ ...v, serviceRole: e.target.value })}><option value="counsellor">Counsellors</option><option value="security_officer">Security officers</option><option value="committee_member">Committee members</option></Select></Field>
                {v.serviceRole === 'committee_member' && <Field id="ch-com" label="Committee"><Select value={v.committeeId} onChange={(e) => setV({ ...v, committeeId: e.target.value })}><option value="">Any committee member</option>{committees?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
              </>
            )}
            {v.kind === 'community' && <SwitchRow id="ch-ro" label="Read-only (announcements)" description="Only moderators can post." checked={v.readOnly} onCheckedChange={(x) => setV({ ...v, readOnly: x })} />}
            <Field id="ch-order" label="Order"><Input type="number" min={0} value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} /></Field>
            <SwitchRow id="ch-pub" label="Published" checked={v.published} onCheckedChange={(x) => setV({ ...v, published: x })} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!disable} onOpenChange={(o) => !o && setDisable(null)} title={`Disable ${disable?.name}?`} description="Students will no longer see it. Existing conversations are kept, not deleted." destructive confirmLabel="Disable" loading={busy} onConfirm={doDisable} />
    </Card>
  );
}

export default function SuperAdminChatPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Support & chat" description="Control what can be sent in chats, which support services exist and how the community works." />
      <Alert tone="brand" icon={<ShieldCheck className="h-4 w-4" />}>Changes here require you to confirm your password and are recorded in the audit log with the exact settings changed.</Alert>
      <MediaSettings />
      <CommunitySettings />
      <Channels />
    </div>
  );
}
