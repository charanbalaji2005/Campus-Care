'use client';

import * as React from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import {
  Archive, ArchiveRestore, ArrowLeft, BellOff, BellRing, CalendarClock, EyeOff, Lock, MailOpen, MoreVertical, Pin, PinOff, Search, ShieldCheck, Users, X,
} from 'lucide-react';
import { SUPPORT_STATUS_LABELS, type MediaScope, type SupportStatus } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { Alert, Avatar, Badge, Button, ErrorState, Input, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ChatThread, type ChatAttachment, type ChatMessageView } from '@/components/chat/chat-thread';
import { PresenceDot, setPreference, type ConversationItem } from './chats-ui';

function PaneHeader({ item, onBack, actions, children }: { item: Pick<ConversationItem, 'title' | 'subtitle' | 'online'>; onBack: () => void; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3">
      <button type="button" onClick={onBack} className="rounded-lg p-1 text-ink-soft hover:bg-slate-100 lg:hidden" aria-label="Back to list"><ArrowLeft className="h-5 w-5" /></button>
      <div className="relative"><Avatar name={item.title} /><PresenceDot online={item.online} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink-strong">{item.title}</p>
        <p className="truncate text-xs text-ink-soft">{item.online ? 'Online' : item.subtitle ?? ''}</p>
      </div>
      {children}
      {actions}
    </div>
  );
}

/** Pin / mute / archive / mark-unread menu shared by every conversation type. */
function OrganiseMenu({ item, itemType, onChanged, extra }: { item: ConversationItem; itemType: 'channel' | 'ticket'; onChanged: () => void; extra?: React.ReactNode }) {
  async function change(c: Parameters<typeof setPreference>[2], done: string) {
    try {
      await setPreference(itemType, item.id, c);
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  const row = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-50';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><Button variant="ghost" size="icon" aria-label="Conversation options"><MoreVertical className="h-5 w-5" /></Button></DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-xl border border-line bg-white p-1 shadow-lift">
          {extra}
          <DropdownMenu.Item className={row} onSelect={() => change({ pinned: !item.pinned }, item.pinned ? 'Unpinned' : 'Pinned')}>{item.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}{item.pinned ? 'Unpin' : 'Pin to top'}</DropdownMenu.Item>
          <DropdownMenu.Item className={row} onSelect={() => change({ muted: !item.muted }, item.muted ? 'Notifications on' : 'Muted')}>{item.muted ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}{item.muted ? 'Unmute' : 'Mute notifications'}</DropdownMenu.Item>
          <DropdownMenu.Item className={row} onSelect={() => change({ markedUnread: true }, 'Marked as unread')}><MailOpen className="h-4 w-4" />Mark as unread</DropdownMenu.Item>
          <DropdownMenu.Item className={row} onSelect={() => change({ archived: !item.archived }, item.archived ? 'Restored' : 'Archived')}>{item.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{item.archived ? 'Restore from archive' : 'Archive'}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

interface ChannelDetail {
  id: string; kind: string; name: string; readOnly: boolean; closed: boolean; access: string; mediaScope: MediaScope;
  media: { images: boolean; videos: boolean }; limits: { maxImageMb: number; maxVideoMb: number };
}

function ParticipantsDialog({ channelId, open, onOpenChange }: { channelId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, error } = useApi<{ count: number; people: { id: string; name: string; role: string; me: boolean; studentId: string | null; department: string | null; online: boolean }[] }>(open ? `/chats/channels/${channelId}/participants` : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Participants" description="Only the people listed here can read this conversation.">
        {error && <ErrorState message={error.message} />}
        {!data && !error && <Skeleton className="h-24" />}
        {data && !data.people.length && <p className="text-sm text-ink-soft">{data.count} members in this channel.</p>}
        <ul className="divide-y divide-line">
          {data?.people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-3">
              <div className="relative"><Avatar name={p.name} /><PresenceDot online={p.online} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink-strong">{p.name}{p.me && <span className="ml-1 text-ink-soft">(you)</span>}</p>
                <p className="truncate text-xs text-ink-soft">{[p.role, p.studentId, p.department].filter(Boolean).join(' · ')}</p>
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** Message search inside a conversation the caller can already read (server-side, same access check). */
function MessageSearch({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [q, setQ] = React.useState('');
  const [term, setTerm] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const { data, isLoading } = useApi<{ items: ChatMessageView[] }>(term.length >= 2 ? `/chat/channels/${channelId}/messages?limit=30&q=${encodeURIComponent(term)}` : null);
  return (
    <div className="border-b border-line bg-warm px-4 py-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-ink-soft" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" className="h-9" />
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close search"><X className="h-4 w-4" /></Button>
      </div>
      {term.length >= 2 && (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {isLoading && <Skeleton className="h-10" />}
          {data && !data.items.length && <p className="py-2 text-sm text-ink-soft">No messages match “{term}”.</p>}
          {data?.items.map((m) => (
            <div key={m.id} className="rounded-xl bg-white px-3 py-2 text-sm shadow-card">
              <p className="text-xs font-semibold text-brand-700">{m.senderLabel} <span className="font-normal text-ink-soft">· {formatDateTime(m.createdAt)}</span></p>
              <p className="line-clamp-2 text-ink-strong">{m.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChannelPane({ item, onBack, onChanged }: { item: ConversationItem; onBack: () => void; onChanged: () => void }) {
  const { data, error } = useApi<ChannelDetail>(`/chat/channels/${item.id}`);
  const { data: readState } = useApi<{ otherSideLastReadAt: string | null }>(item.kind === 'community' ? null : `/chat/channels/${item.id}/read-state`, { refreshInterval: 20000 });
  const [searching, setSearching] = React.useState(false);
  const [people, setPeople] = React.useState(false);
  const row = 'flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-50';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader item={item} onBack={onBack} actions={
        <OrganiseMenu item={item} itemType="channel" onChanged={onChanged} extra={<>
          <DropdownMenu.Item className={row} onSelect={() => setSearching(true)}><Search className="h-4 w-4" />Search messages</DropdownMenu.Item>
          <DropdownMenu.Item className={row} onSelect={() => setPeople(true)}><Users className="h-4 w-4" />Participants</DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
        </>} />
      }>
        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => setSearching((s) => !s)} aria-label="Search messages"><Search className="h-5 w-5" /></Button>
      </PaneHeader>
      {searching && <MessageSearch channelId={item.id} onClose={() => setSearching(false)} />}
      {error && <div className="p-4"><ErrorState message={error.status === 404 ? 'This conversation is not available to you.' : error.message} /></div>}
      {!data && !error && <div className="space-y-3 p-4"><Skeleton className="h-16 w-2/3" /><Skeleton className="ml-auto h-16 w-1/2" /><Skeleton className="h-16 w-3/5" /></div>}
      {data && (
        <ChatThread
          key={item.id}
          className="min-h-0 flex-1 rounded-none border-0 bg-[#FBFAF6]"
          fileKind="chat"
          mediaScope={data.mediaScope}
          media={data.media}
          limits={data.limits}
          room={`chat:${item.id}`}
          realtimeEvent="chat:message"
          readOnly={data.readOnly || data.closed}
          readOnlyReason={data.closed ? 'This conversation is closed.' : 'Only authorised publishers can post in this channel.'}
          privacyNote={item.kind === 'community' ? undefined : item.kind === 'counselling_thread' ? 'Confidential: only you and the other participant can read this conversation.' : 'Private: only the listed participants can read this conversation.'}
          emptyText="No messages yet. Say hello to start the conversation."
          load={(cursor) => api.get(`/chat/channels/${item.id}/messages${cursor ? `?before=${cursor}` : ''}`)}
          send={(input) => api.post<{ message: ChatMessageView }>(`/chat/channels/${item.id}/messages`, input).then((r) => { onChanged(); return r; })}
          upload={(file) => api.upload<ChatAttachment>(`/chat/channels/${item.id}/attachments`, file)}
          otherSideLastReadAt={readState?.otherSideLastReadAt}
        />
      )}
      <ParticipantsDialog channelId={item.id} open={people} onOpenChange={setPeople} />
    </div>
  );
}

/** Oversight view for conversations whose content the viewer may not read. No message request is ever made. */
export function LockedPane({ item, onBack, onChanged }: { item: ConversationItem; onBack: () => void; onChanged: () => void }) {
  const counselling = item.kind === 'counselling_thread' || item.kind === 'appointment';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader item={{ ...item, online: null }} onBack={onBack} actions={item.type === 'channel' ? <OrganiseMenu item={item} itemType="channel" onChanged={onChanged} /> : undefined} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[#FBFAF6] p-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-50 text-brand-700"><Lock className="h-7 w-7" /></div>
        <div className="max-w-md">
          <h3 className="font-semibold text-ink-strong">{counselling ? 'Confidential counselling' : 'Private conversation'}</h3>
          <p className="mt-1 text-sm text-ink-soft">{item.lockedReason}</p>
        </div>
        <dl className="grid w-full max-w-sm grid-cols-2 gap-3 rounded-2xl border border-line bg-white p-4 text-left text-sm">
          <div><dt className="muted">Status</dt><dd className="font-medium">{humanize(item.status ?? 'open')}</dd></div>
          <div><dt className="muted">Last activity</dt><dd className="font-medium">{item.lastActivityAt ? formatDateTime(item.lastActivityAt) : '—'}</dd></div>
          {item.subtitle && <div className="col-span-2"><dt className="muted">Handled by</dt><dd className="font-medium">{item.subtitle.replace(/^Counsellor: /, '')}</dd></div>}
          {item.priority === 'urgent' && <div className="col-span-2"><Badge tone="rose">No response for over an hour</Badge></div>}
        </dl>
        {!counselling && (
          <Link href="/super-admin/chat-access" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><ShieldCheck className="h-4 w-4" /> Request an audited review grant</Link>
        )}
        {counselling && <Link href="/super-admin/counselling" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"><CalendarClock className="h-4 w-4" /> Open counselling operations</Link>}
      </div>
    </div>
  );
}

interface Ticket {
  _id: string; ticketNumber: string; subject: string; description: string; category: string; status: SupportStatus; priority: string; createdAt: string;
  studentId?: { fullName: string; email: string; studentId?: string; department?: string } | null;
  assignedTo?: { fullName: string } | null;
  messages: { _id: string; senderRole: string; senderName: string; message: string; isInternal: boolean; createdAt: string }[];
}

/** Support ticket in chat form. Internal notes are visibly separate and never sent to the student. */
export function TicketPane({ item, onBack, onChanged }: { item: ConversationItem; onBack: () => void; onChanged: () => void }) {
  const { data, error, mutate } = useApi<Ticket>(`/support/admin/tickets/${item.id}`, { refreshInterval: 20000 });
  const [body, setBody] = React.useState('');
  const [internal, setInternal] = React.useState(false);
  const [askInfo, setAskInfo] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight })); }, [data?.messages.length]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (body.trim().length < 2) return;
    setBusy(true);
    try {
      await api.post(`/support/admin/tickets/${item.id}/reply`, { message: body.trim(), isInternal: internal, requestMoreInfo: !internal && askInfo });
      setBody(''); setAskInfo(false);
      await mutate();
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err, 'Reply not sent.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader item={{ title: data?.studentId?.fullName ?? item.subtitle ?? 'Student', subtitle: item.title, online: null }} onBack={onBack} actions={<OrganiseMenu item={item} itemType="ticket" onChanged={onChanged} />}>
        {data && <Badge tone={['new', 'open', 'reopened'].includes(data.status) ? 'amber' : 'neutral'}>{SUPPORT_STATUS_LABELS[data.status] ?? humanize(data.status)}</Badge>}
      </PaneHeader>
      {error && <div className="p-4"><ErrorState message={error.message} onRetry={() => mutate()} /></div>}
      {!data && !error && <div className="p-4"><Skeleton className="h-40" /></div>}
      {data && (
        <>
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#FBFAF6] px-4 py-4" aria-live="polite">
            <div className="mx-auto max-w-xl rounded-2xl border border-line bg-white p-4 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{data.ticketNumber} · {humanize(data.category)} · {humanize(data.priority)} priority</p>
              <p className="mt-1 font-semibold text-ink-strong">{data.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-ink">{data.description}</p>
              <p className="mt-2 text-xs text-ink-soft">Opened {formatDateTime(data.createdAt)}{data.assignedTo ? ` · Assigned to ${data.assignedTo.fullName}` : ' · Unassigned'}</p>
            </div>
            {data.messages.map((m) => {
              const mine = m.senderRole !== 'student';
              return (
                <div key={m._id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 text-sm sm:max-w-[70%]',
                    m.isInternal ? 'rounded-br-md border border-dashed border-amber-500/60 bg-amber-50 text-ink-strong' : mine ? 'rounded-br-md bg-forest text-white' : 'rounded-bl-md border border-line bg-white text-ink-strong')}>
                    <p className={cn('mb-0.5 flex items-center gap-1.5 text-xs font-semibold', m.isInternal ? 'text-amber-700' : mine ? 'text-brand-200' : 'text-brand-700')}>
                      {m.isInternal && <EyeOff className="h-3 w-3" />}{m.isInternal ? `Internal note · ${m.senderName}` : m.senderName}
                      <span className={cn('font-normal', mine && !m.isInternal ? 'text-white/60' : 'text-ink-soft')}>{formatDateTime(m.createdAt)}</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{m.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {data.status === 'closed' ? (
            <div className="border-t border-line bg-slate-50 px-4 py-3 text-center text-sm text-ink-soft">This ticket is closed. Reopen it from the Support Center to reply.</div>
          ) : (
            <form onSubmit={send} className={cn('border-t p-3', internal ? 'border-amber-200 bg-amber-50/60' : 'border-line bg-white')}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" role="radiogroup" aria-label="Reply type">
                <button type="button" role="radio" aria-checked={!internal} onClick={() => setInternal(false)} className={cn('rounded-full px-3 py-1 font-semibold', !internal ? 'bg-forest text-white' : 'bg-slate-100 text-ink')}>Reply to student</button>
                <button type="button" role="radio" aria-checked={internal} onClick={() => setInternal(true)} className={cn('flex items-center gap-1 rounded-full px-3 py-1 font-semibold', internal ? 'bg-amber-600 text-white' : 'bg-slate-100 text-ink')}><EyeOff className="h-3 w-3" />Internal note</button>
                {!internal && <label className="ml-auto flex items-center gap-1.5 text-ink-soft"><input type="checkbox" className="accent-brand-600" checked={askInfo} onChange={(e) => setAskInfo(e.target.checked)} /> Request more information</label>}
                {internal && <span className="ml-auto text-amber-700">Staff only — never shown to the student</span>}
              </div>
              <div className="flex items-end gap-2">
                <Textarea rows={1} value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} aria-label={internal ? 'Internal note' : 'Reply to student'} placeholder={internal ? 'Add an internal note…' : 'Type a reply…'} className="max-h-40 min-h-[44px] resize-none py-2.5"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <Button type="submit" loading={busy} disabled={body.trim().length < 2}>{internal ? 'Save note' : 'Send'}</Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-soft">Assignment and status changes live in the <Link className="font-semibold text-brand-700 hover:underline" href={`/super-admin/support?ticket=${data.ticketNumber}`}>Support Center</Link>.</p>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/** A counselling request. Counsellors see their own requests; administrators see workflow metadata only. */
export function AppointmentPane({ item, onBack, onOpenThread }: { item: ConversationItem; onBack: () => void; onOpenThread: (id: string) => void }) {
  if (item.locked) return <LockedPane item={item} onBack={onBack} onChanged={() => undefined} />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader item={{ ...item, online: null }} onBack={onBack} />
      <div className="flex-1 space-y-4 overflow-y-auto bg-[#FBFAF6] p-6">
        <dl className="grid gap-3 rounded-2xl border border-line bg-white p-4 text-sm sm:grid-cols-2">
          <div><dt className="muted">Status</dt><dd className="font-medium">{humanize(item.status ?? '')}</dd></div>
          <div><dt className="muted">Updated</dt><dd className="font-medium">{item.lastActivityAt ? formatDateTime(item.lastActivityAt) : '—'}</dd></div>
          {item.preview && <div className="sm:col-span-2"><dt className="muted">Reason shared by the student</dt><dd className="whitespace-pre-wrap font-medium">{item.preview}</dd></div>}
        </dl>
        {item.status === 'requested' && <Alert tone={item.priority === 'urgent' ? 'rose' : 'amber'} icon={<CalendarClock className="h-4 w-4" />}>{item.priority === 'urgent' ? 'This request has waited more than an hour for a response.' : 'Please accept, reschedule or decline this request within an hour.'}</Alert>}
        {item.threadId ? <Button onClick={() => onOpenThread(item.threadId!)}>Open conversation</Button> : <p className="text-sm text-ink-soft">The private conversation opens once the request is accepted.</p>}
      </div>
    </div>
  );
}
