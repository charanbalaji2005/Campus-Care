'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Archive, BellOff, Building2, FolderKanban, HeartHandshake, Inbox, LifeBuoy, Lock, Mail, Megaphone, MessageSquarePlus, MessagesSquare, Pin, Search,
  ShieldAlert, Siren, Stethoscope, UserRound, Users, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ChatCategory } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi, useUserEvents } from '@/lib/hooks';
import { cn, humanize } from '@/lib/utils';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AnnouncementComposer, AnnouncementDetail, AnnouncementsList, useAnnouncements } from './announcements-panel';
import { AppointmentPane, ChannelPane, LockedPane, TicketPane } from './conversation-pane';
import { EMPTY_FILTERS, ReportDetail, ReportsList, type ReportFilters } from './reports-inbox';
import { PresenceDot, UnreadBadge, listStamp, markRead, type AnnouncementView, type ConversationItem, type Selection } from './chats-ui';

const ICONS: Record<ChatCategory, LucideIcon> = {
  all: MessagesSquare, announcements: Megaphone, counselling: Stethoscope, student_counsellor: HeartHandshake, student_admin: UserRound,
  admin_super_admin: ShieldAlert, counsellor_admin: Building2, support: LifeBuoy, security: Siren, community: Users, reports: FolderKanban, archived: Archive, unread: Mail,
};

interface Overview {
  categories: { key: ChatCategory; label: string }[];
  conversations: { total: number; unreadConversations: number; unreadMessages: number; needsResponse: number; byCategory: Record<string, { total: number; unread: number }> };
  counselling: { activeConversations: number; pendingRequests: number; overdueRequests: number } | null;
  support: { unanswered: number; open: number } | null;
  reports: { new: number; open: number; urgent: number; overdue: number } | null;
  announcements: { unread: number; recent: AnnouncementView[] };
  needsResponse: ConversationItem[];
  permissions: { publishAnnouncements: boolean; startDirect: boolean; triageReports: boolean };
}

const SELECTION_PARAM: Record<NonNullable<Selection>['type'], string> = { channel: 'c', ticket: 't', appointment: 'a', report: 'r', announcement: 'n', compose: 'new' };

function readSelection(sp: URLSearchParams): Selection {
  for (const [type, key] of Object.entries(SELECTION_PARAM)) {
    const v = sp.get(key);
    if (v) return { type: type as NonNullable<Selection>['type'], id: v };
  }
  return null;
}

/**
 * Unified communication center (WhatsApp-style): categories · list · conversation.
 * The URL holds the category and selection (?cat=reports&r=<id>), so notification deep links,
 * refreshes and back/forward all land on the same authorised item.
 */
export function ChatsCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const selection = readSelection(sp);
  const category = (sp.get('cat') as ChatCategory | null) ?? (selection?.type === 'report' ? 'reports' : selection?.type === 'announcement' || selection?.type === 'compose' ? 'announcements' : 'all');

  const { data: overview, error: overviewError, mutate: refreshOverview } = useApi<Overview>('/chats/overview', { refreshInterval: 45000 });
  const categories = overview?.categories ?? [];
  const allowed = !overview || categories.some((c) => c.key === category);

  const navigate = React.useCallback((cat: ChatCategory, sel: Selection = null) => {
    const p = new URLSearchParams();
    if (cat !== 'all') p.set('cat', cat);
    if (sel) p.set(SELECTION_PARAM[sel.type], sel.id);
    router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
  }, [router, pathname]);

  const [q, setQ] = React.useState('');
  const [term, setTerm] = React.useState('');
  React.useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  React.useEffect(() => { setQ(''); }, [category]);

  const conversational = !['reports', 'announcements'].includes(category) && allowed;
  const listKey = conversational ? `/chats/conversations?category=${category}${term ? `&q=${encodeURIComponent(term)}` : ''}` : null;
  const { data: list, error: listError, isLoading: listLoading, mutate: refreshList } = useApi<{ items: ConversationItem[] }>(listKey, { refreshInterval: 30000, keepPreviousData: true });

  const [reportFilters, setReportFilters] = React.useState<ReportFilters>(EMPTY_FILTERS);
  const [reportsVersion, setReportsVersion] = React.useState(0);
  const [annFilters, setAnnFilters] = React.useState({ q: '', category: '', manage: false, status: '', unread: false });
  const announcements = useAnnouncements(annFilters);

  const refreshAll = React.useCallback(() => { void refreshList(); void refreshOverview(); }, [refreshList, refreshOverview]);
  // Live updates: ids-only hints from the server, then an authorised refetch. Duplicate events are harmless.
  useUserEvents({
    'chats:changed': refreshAll,
    notification: refreshAll,
    'announcements:changed': () => { void announcements.mutate(); void refreshOverview(); },
  });

  // Opening an item clears its unread marker (and the "mark unread" flag).
  React.useEffect(() => {
    if (!selection || selection.type === 'compose') return;
    const t = selection.type === 'report' ? 'case' : selection.type === 'appointment' ? 'channel' : selection.type;
    if (t === 'announcement') return; // marked read by the detail view once it is visible
    void markRead(t, selection.id).then(refreshAll);
  }, [selection?.type, selection?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedItem = selection && ['channel', 'ticket', 'appointment'].includes(selection.type) ? list?.items.find((i) => i.id === selection.id) : undefined;
  const { data: deepLinked, error: deepError } = useApi<{ id: string; kind: string; name: string }>(selection?.type === 'channel' && list && !selectedItem ? `/chat/channels/${selection.id}` : null);
  const channelItem: ConversationItem | undefined = selectedItem ?? (deepLinked ? {
    type: 'channel', id: deepLinked.id, category: 'all', kind: deepLinked.kind, title: deepLinked.name, subtitle: null, preview: null, lastActivityAt: null, unread: 0,
    online: null, status: 'open', priority: null, locked: false, needsResponse: false, pinned: false, archived: false, muted: false, markedUnread: false,
  } : undefined);
  const selectedAnnouncement = selection?.type === 'announcement' ? announcements.data?.items.find((a) => a.id === selection.id) : undefined;

  const [newChat, setNewChat] = React.useState(false);
  const back = () => navigate(category);
  const showDetail = Boolean(selection);

  let detail: React.ReactNode;
  if (!selection) detail = <ChatsHome overview={overview} error={overviewError?.message} onOpen={navigate} onNewChat={() => setNewChat(true)} />;
  else if (selection.type === 'report') detail = <ReportDetail id={selection.id} onBack={back} triage={Boolean(overview?.permissions.triageReports)} onChanged={() => { setReportsVersion((v) => v + 1); void refreshOverview(); }} />;
  else if (selection.type === 'compose') detail = <AnnouncementComposer onBack={back} onSaved={(id) => { void announcements.mutate(); navigate('announcements', { type: 'announcement', id }); }} />;
  else if (selection.type === 'announcement') detail = selectedAnnouncement
    ? <AnnouncementDetail key={selectedAnnouncement.id} item={selectedAnnouncement} canPublish={Boolean(overview?.permissions.publishAnnouncements)} onBack={back} onChanged={() => { void announcements.mutate(); void refreshOverview(); }} />
    : <PaneLoading />;
  else if (selection.type === 'ticket') detail = selectedItem ? <TicketPane key={selectedItem.id} item={selectedItem} onBack={back} onChanged={refreshAll} /> : <PaneLoading missing={Boolean(list)} />;
  else if (selection.type === 'appointment') detail = selectedItem ? <AppointmentPane item={selectedItem} onBack={back} onOpenThread={(id) => navigate('student_counsellor', { type: 'channel', id })} /> : <PaneLoading missing={Boolean(list)} />;
  else if (channelItem?.locked) detail = <LockedPane key={channelItem.id} item={channelItem} onBack={back} onChanged={refreshAll} />;
  else detail = channelItem ? <ChannelPane key={channelItem.id} item={channelItem} onBack={back} onChanged={refreshAll} /> : <PaneLoading missing={Boolean(deepError)} />;

  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:mx-0 lg:my-0">
      <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] overflow-hidden bg-white lg:h-[calc(100dvh-7rem)] lg:rounded-2xl lg:border lg:border-line lg:shadow-card">
        {/* Categories */}
        <nav aria-label="Chat categories" className="hidden w-60 shrink-0 flex-col border-r border-line bg-warm xl:flex">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <h1 className="text-lg font-bold tracking-tight text-ink-strong">Chats</h1>
            {overview?.permissions.startDirect && <Button variant="ghost" size="icon" onClick={() => setNewChat(true)} aria-label="New conversation" title="New conversation"><MessageSquarePlus className="h-5 w-5" /></Button>}
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {!overview && [0, 1, 2, 3, 4, 5].map((i) => <li key={i}><Skeleton className="my-1 h-9" /></li>)}
            {categories.map((c) => {
              const Icon = ICONS[c.key];
              const n = categoryCount(c.key, overview);
              return (
                <li key={c.key}>
                  <button type="button" onClick={() => navigate(c.key)} aria-current={category === c.key ? 'page' : undefined}
                    className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition', category === c.key ? 'bg-white font-semibold text-forest shadow-card' : 'text-ink hover:bg-white/70')}>
                    <Icon className={cn('h-4 w-4 shrink-0', category === c.key ? 'text-brand-700' : 'text-ink-soft')} />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {n > 0 && <UnreadBadge count={n} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* List */}
        <section aria-label="Conversations" className={cn('flex w-full min-w-0 flex-col border-r border-line md:w-[340px] md:shrink-0', showDetail && 'hidden md:flex')}>
          <div className="border-b border-line xl:hidden">
            <div className="flex items-center justify-between px-4 pt-3">
              <h1 className="text-lg font-bold tracking-tight text-ink-strong">Chats</h1>
              {overview?.permissions.startDirect && <Button variant="ghost" size="icon" onClick={() => setNewChat(true)} aria-label="New conversation"><MessageSquarePlus className="h-5 w-5" /></Button>}
            </div>
            <div className="flex gap-1.5 overflow-x-auto px-3 py-2" role="tablist" aria-label="Chat categories">
              {categories.map((c) => (
                <button key={c.key} type="button" role="tab" aria-selected={category === c.key} onClick={() => navigate(c.key)}
                  className={cn('flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold', category === c.key ? 'bg-forest text-white' : 'bg-slate-100 text-ink')}>
                  {c.label}{categoryCount(c.key, overview) > 0 && <span className="tabular opacity-80">· {categoryCount(c.key, overview)}</span>}
                </button>
              ))}
            </div>
          </div>
          {!allowed ? (
            <EmptyState icon={<Lock className="h-6 w-6" />} title="Not available" description="This category is not available to your account." />
          ) : category === 'reports' ? (
            <ReportsList key={reportsVersion} scope={overview?.permissions.triageReports ? 'triage' : 'assigned'} selectedId={selection?.type === 'report' ? selection.id : null} onSelect={(id) => navigate('reports', { type: 'report', id })} filters={reportFilters} setFilters={setReportFilters} />
          ) : category === 'announcements' ? (
            <AnnouncementsList list={announcements} filters={annFilters} setFilters={setAnnFilters} canPublish={Boolean(overview?.permissions.publishAnnouncements)}
              selectedId={selection?.type === 'announcement' ? selection.id : null} onSelect={(id) => navigate('announcements', { type: 'announcement', id })} onCompose={() => navigate('announcements', { type: 'compose', id: '1' })} />
          ) : (
            <>
              <div className="border-b border-line p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or start a new chat" aria-label="Search conversations" className="h-9 rounded-full bg-warm pl-9" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {listError && <div className="p-3"><ErrorState message={listError.message} onRetry={() => refreshList()} /></div>}
                {listLoading && !list && <ListSkeleton />}
                {list && !list.items.length && <ListEmpty category={category} searching={Boolean(term)} canStart={Boolean(overview?.permissions.startDirect)} onNewChat={() => setNewChat(true)} />}
                <ul>
                  {list?.items.map((item) => (
                    <ConversationRow key={`${item.type}:${item.id}`} item={item} active={selection?.id === item.id}
                      onClick={() => navigate(category, { type: item.type === 'channel' ? 'channel' : item.type, id: item.id })} />
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        {/* Detail */}
        <section aria-label="Selected conversation" className={cn('min-w-0 flex-1 flex-col bg-[#FBFAF6]', showDetail ? 'flex' : 'hidden md:flex')}>{detail}</section>
      </div>
      <NewChatDialog open={newChat} onOpenChange={setNewChat} onOpened={(id) => { setNewChat(false); refreshAll(); navigate('all', { type: 'channel', id }); }} />
    </div>
  );
}

function categoryCount(key: ChatCategory, o?: Overview) {
  if (!o) return 0;
  if (key === 'all' || key === 'unread') return o.conversations.unreadConversations;
  if (key === 'announcements') return o.announcements.unread;
  if (key === 'reports') return o.reports?.new ?? 0;
  if (key === 'counselling') return o.counselling?.overdueRequests ?? 0;
  return o.conversations.byCategory[key]?.unread ?? 0;
}

function ConversationRow({ item, active, onClick }: { item: ConversationItem; active: boolean; onClick: () => void }) {
  const unread = item.unread || (item.markedUnread ? 1 : 0);
  return (
    <li>
      <button type="button" onClick={onClick} aria-current={active}
        className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-warm focus-visible:bg-warm focus-visible:outline-none', active && 'bg-brand-50 hover:bg-brand-50')}>
        <div className="relative">
          {item.type === 'ticket' ? <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-700"><LifeBuoy className="h-5 w-5" /></div>
            : item.type === 'report' ? <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-700"><FolderKanban className="h-5 w-5" /></div>
            : item.locked ? <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-ink-soft"><Lock className="h-5 w-5" /></div>
            : item.kind === 'community' ? <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-forest"><Users className="h-5 w-5" /></div>
            : <Avatar name={item.title} className="h-11 w-11" />}
          <PresenceDot online={item.online} />
        </div>
        <div className="min-w-0 flex-1 border-b border-line/60 pb-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn('truncate text-sm text-ink-strong', unread ? 'font-bold' : 'font-medium')}>{item.title}</p>
            <span className={cn('shrink-0 text-[11px]', unread ? 'font-semibold text-brand-700' : 'text-ink-soft')}>{listStamp(item.lastActivityAt)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-xs text-ink-soft">
              {item.locked ? <span className="italic">Content restricted · {item.subtitle ?? ''}</span> : item.preview ?? item.subtitle ?? <span className="italic">No messages yet</span>}
            </p>
            {item.priority === 'urgent' && <Siren className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-label="Urgent" />}
            {item.needsResponse && !unread && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="Needs a response" />}
            {item.muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-label="Muted" />}
            {item.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-label="Pinned" />}
            <UnreadBadge count={unread} muted={item.muted} />
          </div>
        </div>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return <div className="space-y-1 p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex items-center gap-3 py-2"><Skeleton className="h-11 w-11 rounded-full" /><div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div></div>)}</div>;
}

function ListEmpty({ category, searching, canStart, onNewChat }: { category: ChatCategory; searching: boolean; canStart: boolean; onNewChat: () => void }) {
  if (searching) return <EmptyState icon={<Search className="h-6 w-6" />} title="No matches" description="Try a different name or keyword." />;
  const direct = ['all', 'student_admin', 'admin_super_admin', 'counsellor_admin'].includes(category);
  return (
    <EmptyState icon={<Inbox className="h-6 w-6" />}
      title={category === 'archived' ? 'Nothing archived' : category === 'unread' ? 'All caught up' : 'No conversations yet'}
      description={category === 'unread' ? 'You have no unread conversations.' : category === 'counselling' ? 'There are no open counselling requests.' : undefined}
      action={direct && canStart ? <Button size="sm" onClick={onNewChat}><MessageSquarePlus className="h-4 w-4" /> New conversation</Button> : undefined} />
  );
}

function PaneLoading({ missing }: { missing?: boolean }) {
  if (missing) return <div className="m-auto max-w-sm p-6"><EmptyState icon={<Lock className="h-6 w-6" />} title="Not available" description="This conversation does not exist or you are not authorised to open it." /></div>;
  return <div className="space-y-3 p-6"><Skeleton className="h-12 w-64" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
}

/** Overview shown when nothing is selected. Every number comes from an endpoint scoped to the caller. */
function ChatsHome({ overview: o, error, onOpen, onNewChat }: { overview?: Overview; error?: string; onOpen: (cat: ChatCategory, sel?: Selection) => void; onNewChat: () => void }) {
  if (error) return <div className="p-6"><ErrorState message={error} /></div>;
  if (!o) return <div className="grid gap-3 p-6 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  const has = (k: ChatCategory) => o.categories.some((c) => c.key === k);
  const stat = (label: string, value: number, onClick: () => void, tone: 'brand' | 'amber' | 'rose' = 'brand', hint?: string) => (
    <button type="button" onClick={onClick} className="rounded-2xl border border-line bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <p className={cn('tabular mt-1 text-2xl font-bold', value && tone === 'rose' ? 'text-rose-700' : value && tone === 'amber' ? 'text-amber-700' : 'text-ink-strong')}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-soft">{hint}</p>}
    </button>
  );
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink-strong">Communication overview</h2>
            <p className="text-sm text-ink-soft">Conversations, reports and announcements you are authorised to access.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {o.permissions.startDirect && <Button variant="outline" size="sm" onClick={onNewChat}><MessageSquarePlus className="h-4 w-4" /> New chat</Button>}
            {o.permissions.publishAnnouncements && <Button size="sm" onClick={() => onOpen('announcements', { type: 'compose', id: '1' })}><Megaphone className="h-4 w-4" /> New announcement</Button>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat('Conversations', o.conversations.total, () => onOpen('all'))}
          {stat('Unread', o.conversations.unreadConversations, () => onOpen('unread'), 'amber', `${o.conversations.unreadMessages} messages`)}
          {stat('Awaiting your reply', o.conversations.needsResponse, () => onOpen('unread'), 'amber')}
          {stat('Unread announcements', o.announcements.unread, () => onOpen('announcements'))}
          {o.reports && has('reports') && stat('New reports', o.reports.new, () => onOpen('reports'), 'amber')}
          {o.reports && has('reports') && stat('Open reports', o.reports.open, () => onOpen('reports'))}
          {o.reports && has('reports') && stat('Urgent reports', o.reports.urgent, () => onOpen('reports'), 'rose', o.reports.overdue ? `${o.reports.overdue} overdue` : undefined)}
          {o.support && stat('Unanswered support', o.support.unanswered, () => onOpen('support'), 'amber', `${o.support.open} open tickets`)}
          {o.counselling && stat('Active counselling chats', o.counselling.activeConversations, () => onOpen('student_counsellor'))}
          {o.counselling && stat('Pending counselling requests', o.counselling.pendingRequests, () => onOpen('counselling'), o.counselling.overdueRequests ? 'rose' : 'brand', o.counselling.overdueRequests ? `${o.counselling.overdueRequests} waiting over 1 hour` : undefined)}
        </div>

        {o.needsResponse.length > 0 && (
          <Card>
            <div className="border-b border-line px-4 py-3"><h3 className="text-sm font-semibold text-ink-strong">Waiting for your response</h3></div>
            <ul className="divide-y divide-line">
              {o.needsResponse.map((i) => (
                <li key={`${i.type}:${i.id}`}>
                  <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-warm" onClick={() => onOpen(i.category, { type: i.type === 'channel' ? 'channel' : i.type, id: i.id })}>
                    <Avatar name={i.title} className="h-9 w-9" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-strong">{i.title}</p><p className="truncate text-xs text-ink-soft">{i.preview ?? i.subtitle}</p></div>
                    <span className="text-[11px] text-ink-soft">{listStamp(i.lastActivityAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold text-ink-strong">Recent official announcements</h3>
            <Button variant="link" size="sm" onClick={() => onOpen('announcements')}>View all</Button>
          </div>
          {!o.announcements.recent.length && <p className="px-4 py-6 text-center text-sm text-ink-soft">No announcements yet.</p>}
          <ul className="divide-y divide-line">
            {o.announcements.recent.map((a) => (
              <li key={a.id}>
                <button type="button" className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-warm" onClick={() => onOpen('announcements', { type: 'announcement', id: a.id })}>
                  <Megaphone className={cn('h-4 w-4 shrink-0', a.priority === 'urgent' ? 'text-rose-600' : 'text-brand-700')} />
                  <p className={cn('min-w-0 flex-1 truncate text-sm', a.read ? 'text-ink' : 'font-semibold text-ink-strong')}>{a.title}</p>
                  {a.priority !== 'standard' && <Badge tone={a.priority === 'urgent' ? 'rose' : 'amber'}>{humanize(a.priority)}</Badge>}
                  <span className="text-[11px] text-ink-soft">{listStamp(a.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <p className="flex items-start gap-2 text-xs text-ink-soft"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Counselling conversations stay confidential between the student and counsellor, and report content stays with the assigned committee. Listing them here never grants access to their content.
          {' '}<Link className="font-semibold text-brand-700 hover:underline" href="/super-admin/chat-access">Exceptional review grants</Link>
        </p>
      </div>
    </div>
  );
}

interface Contact { id: string; name: string; role: string; roleLabel: string | null; email: string; studentId: string | null; department: string | null; purpose: string | null; online: boolean }

function NewChatDialog({ open, onOpenChange, onOpened }: { open: boolean; onOpenChange: (o: boolean) => void; onOpened: (id: string) => void }) {
  const [q, setQ] = React.useState('');
  const [term, setTerm] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, isLoading } = useApi<Contact[]>(open ? `/chats/contacts?q=${encodeURIComponent(term)}` : null);
  async function start(c: Contact) {
    setBusy(c.id);
    try {
      const r = await api.post<{ id: string }>('/chats/direct', { userId: c.id });
      onOpened(r.id);
      setQ('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New conversation" description="Private one-to-one chat. Only people your role may contact are listed; both of you are the only participants.">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, email or student ID" aria-label="Search people" />
        <div className="mt-3 max-h-80 overflow-y-auto">
          {error && <ErrorState message={error.message} />}
          {isLoading && <ListSkeleton />}
          {data && !data.length && <p className="py-6 text-center text-sm text-ink-soft">No one found.</p>}
          <ul className="divide-y divide-line">
            {data?.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={Boolean(busy)} onClick={() => start(c)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-warm disabled:opacity-60">
                  <div className="relative"><Avatar name={c.name} /><PresenceDot online={c.online} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-strong">{c.name}</p>
                    <p className="truncate text-xs text-ink-soft">{[c.roleLabel, c.studentId, c.department].filter(Boolean).join(' · ')}</p>
                  </div>
                  {busy === c.id && <span className="text-xs text-ink-soft">Opening…</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
