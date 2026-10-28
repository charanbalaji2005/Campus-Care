'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Archive, ArrowLeft, CalendarClock, Megaphone, Pin, PinOff, Plus, Send } from 'lucide-react';
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_PRIORITIES, ROLE_LABELS, type Role } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ANNOUNCEMENT_PRIORITY_TONE, listStamp, markRead, type AnnouncementView } from './chats-ui';

interface ListResponse { items: AnnouncementView[]; total: number; canPublish: boolean }

export function useAnnouncements(opts: { q: string; category: string; manage: boolean; status: string; unread: boolean }) {
  const p = new URLSearchParams({ limit: '50' });
  if (opts.q) p.set('q', opts.q);
  if (opts.category) p.set('category', opts.category);
  if (opts.manage) p.set('view', 'manage');
  if (opts.manage && opts.status) p.set('status', opts.status);
  if (opts.unread) p.set('unread', 'true');
  return useApi<ListResponse>(`/chats/announcements?${p}`, { refreshInterval: 60000 });
}

export function AnnouncementsList({ selectedId, onSelect, onCompose, canPublish, list, filters, setFilters }: {
  selectedId: string | null; onSelect: (id: string) => void; onCompose: () => void; canPublish: boolean;
  list: ReturnType<typeof useAnnouncements>; filters: { q: string; category: string; manage: boolean; status: string; unread: boolean }; setFilters: (f: typeof filters) => void;
}) {
  const { data, error, isLoading, mutate } = list;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex gap-2">
          <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search announcements" aria-label="Search announcements" className="h-9" />
          {canPublish && <Button size="icon" className="h-9 w-9 shrink-0" onClick={onCompose} aria-label="New announcement" title="New announcement"><Plus className="h-4 w-4" /></Button>}
        </div>
        <div className="flex gap-2">
          <Select aria-label="Category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} className="h-8 py-0 text-xs"><option value="">All categories</option>{ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select>
          {filters.manage && <Select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="h-8 py-0 text-xs"><option value="">Any status</option>{['draft', 'scheduled', 'published', 'archived', 'expired'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}
        </div>
        <div className="flex gap-1.5 text-xs">
          <button type="button" aria-pressed={!filters.manage && !filters.unread} onClick={() => setFilters({ ...filters, manage: false, unread: false })} className={cn('rounded-full px-3 py-1 font-semibold', !filters.manage && !filters.unread ? 'bg-forest text-white' : 'bg-slate-100')}>Feed</button>
          <button type="button" aria-pressed={filters.unread} onClick={() => setFilters({ ...filters, manage: false, unread: true })} className={cn('rounded-full px-3 py-1 font-semibold', filters.unread ? 'bg-forest text-white' : 'bg-slate-100')}>Unread</button>
          {canPublish && <button type="button" aria-pressed={filters.manage} onClick={() => setFilters({ ...filters, manage: true, unread: false })} className={cn('rounded-full px-3 py-1 font-semibold', filters.manage ? 'bg-forest text-white' : 'bg-slate-100')}>Manage</button>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="p-3"><ErrorState message={error.message} onRetry={() => mutate()} /></div>}
        {isLoading && <div className="space-y-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>}
        {data && !data.items.length && <EmptyState icon={<Megaphone className="h-6 w-6" />} title="No announcements" description={filters.q || filters.category ? 'Nothing matches these filters.' : 'Official announcements will appear here.'} />}
        <ul className="divide-y divide-line">
          {data?.items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onSelect(a.id)} aria-current={selectedId === a.id} className={cn('flex w-full gap-3 px-3 py-3 text-left hover:bg-brand-50/50 focus-visible:bg-brand-50 focus-visible:outline-none', selectedId === a.id && 'bg-brand-50')}>
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', a.priority === 'urgent' ? 'bg-rose-100 text-rose-700' : 'bg-brand-100 text-forest')}><Megaphone className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('truncate text-sm text-ink-strong', a.read ? 'font-medium' : 'font-bold')}>{a.pinned && <Pin className="mr-1 inline h-3 w-3 text-brand-700" />}{a.title}</p>
                    <span className="shrink-0 text-[11px] text-ink-soft">{listStamp(a.createdAt)}</span>
                  </div>
                  <p className="truncate text-xs text-ink-soft">{a.body}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {a.priority !== 'standard' && <Badge tone={ANNOUNCEMENT_PRIORITY_TONE[a.priority]} className="px-2 py-0 text-[10px]">{humanize(a.priority)}</Badge>}
                    {filters.manage && a.status !== 'published' && <Badge className="px-2 py-0 text-[10px]">{humanize(a.status)}</Badge>}
                    {!a.read && !filters.manage && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AnnouncementDetail({ item, canPublish, onBack, onChanged }: { item: AnnouncementView; canPublish: boolean; onBack: () => void; onChanged: () => void }) {
  const [confirm, setConfirm] = React.useState<null | 'archive' | 'publish'>(null);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => { if (!item.read && item.status === 'published') void markRead('announcement', item.id).then(onChanged); }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function update(body: Record<string, unknown>, done: string) {
    try {
      await api.patch(`/chats/announcements/${item.id}`, body);
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (editing) return <AnnouncementComposer initial={item} onBack={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1 text-ink-soft hover:bg-slate-100 lg:hidden" aria-label="Back to announcements"><ArrowLeft className="h-5 w-5" /></button>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-forest"><Megaphone className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1"><p className="truncate font-semibold text-ink-strong">Official Announcements</p><p className="text-xs text-ink-soft">Read-only channel · only authorised publishers can post</p></div>
        {canPublish && (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="ghost" size="icon" onClick={() => update({ pinned: !item.pinned }, item.pinned ? 'Unpinned' : 'Pinned')} aria-label={item.pinned ? 'Unpin' : 'Pin'}>{item.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>
            {item.status !== 'published' && item.status !== 'archived' && <Button size="sm" onClick={() => setConfirm('publish')}><Send className="h-3.5 w-3.5" /> Publish</Button>}
            {item.status !== 'archived' && <Button variant="ghost" size="icon" onClick={() => setConfirm('archive')} aria-label="Archive"><Archive className="h-4 w-4" /></Button>}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAF6] p-4 sm:p-6">
        <article className="mx-auto max-w-2xl rounded-2xl rounded-tl-md border border-line bg-white p-5 shadow-card">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{humanize(item.category)}</Badge>
            {item.priority !== 'standard' && <Badge tone={ANNOUNCEMENT_PRIORITY_TONE[item.priority]}>{humanize(item.priority)}</Badge>}
            {item.pinned && <Badge><Pin className="h-3 w-3" /> Pinned</Badge>}
            {item.status !== 'published' && <Badge tone="amber">{humanize(item.status)}</Badge>}
          </div>
          <h2 className="text-lg font-bold text-ink-strong">{item.title}</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">{item.body}</p>
          <p className="mt-4 text-xs text-ink-soft">{item.authorName} · {item.authorRole} · {formatDateTime(item.createdAt)}</p>
          {(item.scheduledAt || item.expiresAt) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-soft"><CalendarClock className="h-3.5 w-3.5" />
              {item.scheduledAt && `Scheduled ${formatDateTime(item.scheduledAt)}`}{item.scheduledAt && item.expiresAt && ' · '}{item.expiresAt && `Expires ${formatDateTime(item.expiresAt)}`}
            </p>
          )}
        </article>
        {canPublish && (
          <section className="mx-auto mt-4 max-w-2xl rounded-2xl border border-line bg-white p-4 text-sm">
            <h3 className="font-semibold text-ink-strong">Audience & history</h3>
            <p className="mt-1 text-ink-soft">
              {item.targetRoles.includes('all') ? 'Everyone' : item.targetRoles.map((r) => ROLE_LABELS[r as Role] ?? humanize(r)).join(', ')}
              {' · '}{item.campus === 'all' ? 'All campuses' : `Campus zone ${item.campus}`}
              {typeof item.readCount === 'number' && ` · Read by ${item.readCount}`}
            </p>
            {item.history?.length ? (
              <ol className="mt-3 space-y-1.5 border-l-2 border-brand-100 pl-3">
                {item.history.slice().reverse().map((h, i) => <li key={i} className="text-xs"><span className="font-semibold text-ink-strong">{humanize(h.action)}</span> · {h.changedByName} · {formatDateTime(h.changedAt)}{h.note ? ` — ${h.note}` : ''}</li>)}
              </ol>
            ) : null}
          </section>
        )}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'archive' ? 'Archive this announcement?' : 'Publish now?'}
        description={confirm === 'archive' ? 'It disappears from every reader’s feed. The record and its history are kept.' : 'Everyone in the selected audience is notified immediately.'}
        confirmLabel={confirm === 'archive' ? 'Archive' : 'Publish'}
        destructive={confirm === 'archive'}
        onConfirm={() => { const c = confirm; setConfirm(null); void update({ status: c === 'archive' ? 'archived' : 'published' }, c === 'archive' ? 'Archived' : 'Published'); }}
      />
    </div>
  );
}

const toLocalInput = (d: string | null | undefined) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export function AnnouncementComposer({ initial, onBack, onSaved }: { initial?: AnnouncementView; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = React.useState({
    title: initial?.title ?? '', body: initial?.body ?? '', category: initial?.category ?? 'general', priority: initial?.priority ?? 'standard',
    campus: initial?.campus ?? 'all', targetRoles: initial?.targetRoles ?? ['all'], pinned: initial?.pinned ?? false,
    scheduledAt: toLocalInput(initial?.scheduledAt), expiresAt: toLocalInput(initial?.expiresAt),
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = React.useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const toggleRole = (r: string) => {
    if (r === 'all') return set({ targetRoles: ['all'] });
    const without = f.targetRoles.filter((x) => x !== 'all' && x !== r);
    set({ targetRoles: f.targetRoles.includes(r) ? (without.length ? without : ['all']) : [...without, r] });
  };

  async function save(status: 'draft' | 'published' | 'scheduled') {
    setBusy(status);
    setErrors({});
    const payload = { ...f, status, scheduledAt: status === 'scheduled' && f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null, expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null };
    try {
      const saved = initial
        ? await api.patch<AnnouncementView>(`/chats/announcements/${initial.id}`, initial.status === 'published' && status === 'published' ? { ...payload, status: undefined } : payload)
        : await api.post<AnnouncementView>('/chats/announcements', payload);
      toast.success(status === 'draft' ? 'Draft saved' : status === 'scheduled' ? 'Scheduled' : initial?.status === 'published' ? 'Announcement updated' : 'Published');
      onSaved(saved.id);
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const valid = f.title.trim().length >= 3 && f.body.trim().length >= 3;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1 text-ink-soft hover:bg-slate-100" aria-label="Cancel"><ArrowLeft className="h-5 w-5" /></button>
        <p className="font-semibold text-ink-strong">{initial ? 'Edit announcement' : 'New official announcement'}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-[#FBFAF6] p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-line bg-white p-5">
          <Alert tone="neutral" icon={<Megaphone className="h-4 w-4" />}>Students can read official announcements but can never reply in this channel. Every publish, edit, pin and archive is recorded in the audit log.</Alert>
          <Field id="a-title" label="Title" required error={errors.title}><Input value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={140} /></Field>
          <Field id="a-body" label="Message" required error={errors.body}><Textarea value={f.body} onChange={(e) => set({ body: e.target.value })} maxLength={5000} rows={6} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="a-cat" label="Category"><Select value={f.category} onChange={(e) => set({ category: e.target.value })}>{ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></Field>
            <Field id="a-pri" label="Priority"><Select value={f.priority} onChange={(e) => set({ priority: e.target.value as AnnouncementView['priority'] })}>{ANNOUNCEMENT_PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
            <Field id="a-campus" label="Campus zone" hint="“all” for every campus"><Input value={f.campus} onChange={(e) => set({ campus: e.target.value })} maxLength={60} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink-strong">Audience</legend>
            <div className="flex flex-wrap gap-1.5">
              {ANNOUNCEMENT_AUDIENCES.map((r) => (
                <button key={r} type="button" aria-pressed={f.targetRoles.includes(r)} onClick={() => toggleRole(r)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-semibold', f.targetRoles.includes(r) ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink hover:bg-brand-50')}>
                  {r === 'all' ? 'Everyone' : ROLE_LABELS[r as Role] ?? humanize(r)}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="a-sched" label="Schedule for (optional)" error={errors.scheduledAt}><Input type="datetime-local" value={f.scheduledAt} onChange={(e) => set({ scheduledAt: e.target.value })} /></Field>
            <Field id="a-exp" label="Expires (optional)" error={errors.expiresAt}><Input type="datetime-local" value={f.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={f.pinned} onChange={(e) => set({ pinned: e.target.checked })} /> Pin to the top of the feed</label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {initial?.status !== 'published' && <Button variant="outline" loading={busy === 'draft'} disabled={!valid || Boolean(busy)} onClick={() => save('draft')}>Save draft</Button>}
            {f.scheduledAt && initial?.status !== 'published' && <Button variant="outline" loading={busy === 'scheduled'} disabled={!valid || Boolean(busy)} onClick={() => save('scheduled')}><CalendarClock className="h-4 w-4" /> Schedule</Button>}
            <Button loading={busy === 'published'} disabled={!valid || Boolean(busy)} onClick={() => (initial?.status === 'published' ? save('published') : setConfirmPublish(true))}><Send className="h-4 w-4" /> {initial?.status === 'published' ? 'Save changes' : 'Publish now'}</Button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={confirmPublish} onOpenChange={setConfirmPublish} title="Publish this announcement?" description="Everyone in the selected audience is notified in the app and by push." confirmLabel="Publish" onConfirm={() => { setConfirmPublish(false); void save('published'); }} />
    </div>
  );
}
