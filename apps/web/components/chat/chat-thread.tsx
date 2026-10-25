'use client';

import * as React from 'react';
import { AlertCircle, Ban, Check, CheckCheck, EyeOff, Flag, Image as ImageIcon, Loader2, Lock, Paperclip, RotateCw, Send, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { acceptAttributeFor, chatMediaDecision, DEFAULT_SETTINGS, deepMerge, type MediaScope } from '@campuscare/shared';
import { ApiError, fileUrl, uuid } from '@/lib/api';
import { useRealtime } from '@/lib/hooks';
import { bytes, cn, formatTime, formatDate } from '@/lib/utils';
import { Button, Textarea } from '@/components/ui/primitives';

export interface ChatAttachment { id: string; name: string; mimeType: string; sizeBytes: number; kind: 'image' | 'video' | 'document' | null }
export interface ChatMessageView {
  id: string;
  senderLabel: string;
  mine: boolean;
  body: string;
  attachments: (ChatAttachment | undefined)[];
  createdAt: string;
  clientMessageId?: string;
  deleted?: boolean;
  hidden?: boolean;
  canReport?: boolean;
  senderKind?: string;
}
interface Page { items: ChatMessageView[]; hasMore: boolean; nextCursor: string | null; readOnly?: boolean }
type Pending = ChatMessageView & { status: 'sending' | 'failed'; attachmentIds: string[] };

export interface ChatThreadProps {
  load: (cursor?: string) => Promise<Page>;
  send: (input: { body: string; attachmentIds: string[]; clientMessageId: string }) => Promise<{ message: ChatMessageView }>;
  upload?: (file: File) => Promise<ChatAttachment>;
  /** Media policy from the server (Super Admin switches). Images/videos are hidden when off. */
  media?: { images: boolean; videos: boolean };
  mediaScope: MediaScope;
  limits?: { maxImageMb: number; maxVideoMb: number };
  room?: string | null;
  realtimeEvent?: string;
  fileKind: 'case' | 'chat';
  readOnly?: boolean;
  readOnlyReason?: string;
  onSeen?: (lastMessageId: string) => void;
  otherSideLastReadAt?: string | null;
  privacyNote?: string;
  onReport?: (m: ChatMessageView) => void;
  onBlock?: (m: ChatMessageView) => void;
  onHide?: (m: ChatMessageView) => void;
  emptyText?: string;
  className?: string;
}

function AttachmentView({ a, kind }: { a: ChatAttachment; kind: 'case' | 'chat' }) {
  const url = fileUrl(kind, a.id);
  if (a.kind === 'image') return <a href={url} target="_blank" rel="noreferrer" className="block"><img src={url} alt={a.name} className="max-h-64 rounded-xl border border-white/20 object-cover" loading="lazy" /></a>;
  if (a.kind === 'video') return <video src={url} controls preload="metadata" className="max-h-72 w-full rounded-xl bg-black" aria-label={a.name} />;
  return <a href={`${url}?download=1`} className="flex items-center gap-2 rounded-xl bg-black/5 px-3 py-2 text-sm underline"><Paperclip className="h-4 w-4" />{a.name} · {bytes(a.sizeBytes)}</a>;
}

export function ChatThread(props: ChatThreadProps) {
  const { load, send, upload, media = { images: false, videos: false }, mediaScope, limits, room, realtimeEvent, fileKind, readOnly, readOnlyReason, onSeen, otherSideLastReadAt, privacyNote, onReport, onBlock, onHide, emptyText, className } = props;
  const [messages, setMessages] = React.useState<ChatMessageView[]>([]);
  const [pending, setPending] = React.useState<Pending[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [serverReadOnly, setServerReadOnly] = React.useState(false);
  const [body, setBody] = React.useState('');
  const [attachments, setAttachments] = React.useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const loadRef = React.useRef(load);
  loadRef.current = load;

  const mediaEnabled = Boolean(upload && (media.images || media.videos));
  const policySettings = React.useMemo(() => deepMerge(DEFAULT_SETTINGS, { chat: { media: { [mediaScope]: media }, ...(limits ?? {}) } }), [mediaScope, media, limits]);

  const merge = React.useCallback((incoming: ChatMessageView[]) => {
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      incoming.forEach((m) => map.set(m.id, m));
      return [...map.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
    setPending((p) => p.filter((x) => !incoming.some((m) => m.clientMessageId && m.clientMessageId === x.clientMessageId)));
  }, []);

  const refreshLatest = React.useCallback(async (scroll = false) => {
    try {
      const page = await loadRef.current();
      merge(page.items);
      setServerReadOnly(Boolean(page.readOnly));
      if (!cursor) { setHasMore(page.hasMore); setCursor(page.nextCursor); }
      setError(null);
      if (scroll) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [merge, cursor]);

  React.useEffect(() => { void refreshLatest(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useRealtime(room ?? null, realtimeEvent ? { [realtimeEvent]: () => void refreshLatest(true) } : {});
  // Poll as a fallback when realtime isn't connected.
  React.useEffect(() => {
    if (live) return;
    const t = setInterval(() => void refreshLatest(false), 15000);
    return () => clearInterval(t);
  }, [live, refreshLatest]);

  const last = messages[messages.length - 1];
  React.useEffect(() => { if (last && !last.mine) onSeen?.(last.id); }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadOlder() {
    if (!cursor) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const page = await load(cursor);
    merge(page.items);
    setHasMore(page.hasMore);
    setCursor(page.nextCursor);
    requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevHeight; });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !upload) return;
    const decision = chatMediaDecision(policySettings, mediaScope, file.type, file.size);
    if (!decision.allowed) { toast.error(decision.reason); return; }
    setUploading(true);
    try {
      const a = await upload(file);
      setAttachments((x) => [...x, a]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function deliver(p: Pending) {
    setPending((x) => x.map((m) => (m.clientMessageId === p.clientMessageId ? { ...m, status: 'sending' } : m)));
    try {
      const r = await send({ body: p.body, attachmentIds: p.attachmentIds, clientMessageId: p.clientMessageId! });
      merge([{ ...r.message, clientMessageId: p.clientMessageId }]);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    } catch (err) {
      setPending((x) => x.map((m) => (m.clientMessageId === p.clientMessageId ? { ...m, status: 'failed' } : m)));
      toast.error(err instanceof ApiError ? err.message : 'Message not sent.');
    }
  }

  async function onSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!body.trim() && !attachments.length) return;
    // The same clientMessageId is reused on retry so the server never stores a duplicate.
    const p: Pending = { id: `pending-${uuid()}`, clientMessageId: uuid(), senderLabel: 'You', mine: true, body: body.trim(), attachments, attachmentIds: attachments.map((a) => a.id), createdAt: new Date().toISOString(), status: 'sending' };
    setPending((x) => [...x, p]);
    setBody('');
    setAttachments([]);
    await deliver(p);
  }

  const locked = readOnly || serverReadOnly;
  const all: (ChatMessageView | Pending)[] = [...messages, ...pending];
  let lastDay = '';

  return (
    <div className={cn('flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-white', className)}>
      {privacyNote && <div className="flex items-center gap-2 border-b border-line bg-brand-50 px-4 py-2 text-xs text-forest"><Lock className="h-3.5 w-3.5" /> {privacyNote}</div>}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Messages">
        {hasMore && <div className="text-center"><Button variant="ghost" size="sm" onClick={loadOlder}>Load earlier messages</Button></div>}
        {loading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
        {error && <p className="text-center text-sm text-rose-700" role="alert">{error}</p>}
        {!loading && !all.length && <p className="py-10 text-center text-sm text-ink-soft">{emptyText ?? 'No messages yet.'}</p>}
        {all.map((m) => {
          const day = formatDate(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          const status = (m as Pending).status;
          const seen = m.mine && !status && otherSideLastReadAt && new Date(otherSideLastReadAt) >= new Date(m.createdAt);
          return (
            <React.Fragment key={m.id}>
              {showDay && <p className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{day}</p>}
              <div className={cn('group flex', m.mine ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[70%]', m.mine ? 'rounded-br-md bg-forest text-white' : 'rounded-bl-md border border-line bg-slate-50 text-ink-strong')}>
                  <div className={cn('mb-0.5 flex items-center gap-2 text-xs font-semibold', m.mine ? 'text-brand-200' : 'text-brand-700')}>
                    {m.senderLabel}<span className={cn('font-normal', m.mine ? 'text-white/60' : 'text-ink-soft')}>{formatTime(m.createdAt)}</span>
                  </div>
                  {m.hidden ? (
                    <p className="flex items-center gap-1 text-sm italic opacity-70"><EyeOff className="h-3.5 w-3.5" /> Hidden by a moderator</p>
                  ) : m.deleted ? (
                    <p className="text-sm italic opacity-70">Message removed</p>
                  ) : (
                    <>
                      {m.body && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>}
                      {m.attachments.filter(Boolean).length > 0 && <div className="mt-2 space-y-2">{m.attachments.filter(Boolean).map((a) => <AttachmentView key={a!.id} a={a!} kind={fileKind} />)}</div>}
                    </>
                  )}
                  {m.mine && (
                    <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-white/70">
                      {status === 'sending' && <><Loader2 className="h-3 w-3 animate-spin" /> Sending</>}
                      {status === 'failed' && <button className="flex items-center gap-1 font-semibold text-rose-200" onClick={() => deliver(m as Pending)}><AlertCircle className="h-3 w-3" /> Not sent · Retry <RotateCw className="h-3 w-3" /></button>}
                      {!status && (seen ? <><CheckCheck className="h-3.5 w-3.5" /> Seen</> : <><Check className="h-3.5 w-3.5" /> Sent</>)}
                    </div>
                  )}
                  {!m.mine && (onReport || onBlock || onHide) && m.canReport !== false && !m.hidden && (
                    <div className="mt-1 hidden gap-3 text-[11px] text-ink-soft group-hover:flex group-focus-within:flex">
                      {onReport && <button className="flex items-center gap-1 hover:text-rose-700" onClick={() => onReport(m)}><Flag className="h-3 w-3" /> Report</button>}
                      {onBlock && <button className="flex items-center gap-1 hover:text-rose-700" onClick={() => onBlock(m)}><Ban className="h-3 w-3" /> Block</button>}
                      {onHide && <button className="flex items-center gap-1 hover:text-rose-700" onClick={() => onHide(m)}><EyeOff className="h-3 w-3" /> Hide</button>}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {locked ? (
        <div className="border-t border-line bg-slate-50 px-4 py-3 text-center text-sm text-ink-soft">{readOnlyReason ?? 'This conversation is read-only.'}</div>
      ) : (
        <form onSubmit={onSend} className="border-t border-line p-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 text-xs text-forest">
                  {a.kind === 'video' ? <Video className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}{a.name}
                  <button type="button" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} aria-label={`Remove ${a.name}`}><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {mediaEnabled ? (
              <>
                <input ref={fileInput} type="file" className="hidden" accept={acceptAttributeFor(media)} onChange={onPickFile} />
                <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} disabled={uploading} aria-label={`Attach ${media.images && media.videos ? 'image or video' : media.images ? 'image' : 'video'}`} title={`Attach ${media.images && media.videos ? 'image or video' : media.images ? 'image' : 'video'}`}>
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                </Button>
              </>
            ) : upload ? (
              <span className="flex h-10 w-10 items-center justify-center text-slate-300" title="Image and video sending is turned off by your administrator" aria-hidden><Paperclip className="h-5 w-5" /></span>
            ) : null}
            <label htmlFor="chat-input" className="sr-only">Type a message</label>
            <Textarea id="chat-input" rows={1} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" className="max-h-40 min-h-[44px] resize-none py-2.5"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onSend(); } }} maxLength={4000} />
            <Button type="submit" variant="brand" size="icon" className="rounded-full" aria-label="Send message" disabled={!body.trim() && !attachments.length}><Send className="h-4 w-4" /></Button>
          </div>
          {upload && !mediaEnabled && <p className="mt-1.5 text-[11px] text-ink-soft">Image and video sending is turned off by your administrator.</p>}
        </form>
      )}
    </div>
  );
}
