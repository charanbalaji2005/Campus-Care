'use client';

import * as React from 'react';
import type { ChatCategory, ChatItemType } from '@campuscare/shared';
import { api } from '@/lib/api';
import { cn, formatTime, formatDate } from '@/lib/utils';

export interface ConversationItem {
  type: 'channel' | 'ticket' | 'appointment' | 'report';
  id: string;
  category: ChatCategory;
  kind: string;
  title: string;
  subtitle: string | null;
  preview: string | null;
  lastActivityAt: string | null;
  unread: number;
  online: boolean | null;
  status: string | null;
  priority: string | null;
  locked: boolean;
  lockedReason?: string;
  readOnly?: boolean;
  needsResponse: boolean;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  markedUnread: boolean;
  threadId?: string | null;
}

export interface AnnouncementView {
  id: string; title: string; body: string; category: string; priority: 'standard' | 'important' | 'urgent'; status: string; pinned: boolean;
  campus: string; targetRoles: string[]; scheduledAt: string | null; expiresAt: string | null; authorName: string; authorRole: string;
  createdAt: string; updatedAt: string; read: boolean; readCount?: number;
  history?: { changedByName: string; changedAt: string; action: string; note?: string }[];
}

/** Selection held in the URL so notification links and browser back/forward work. */
export type Selection = { type: 'channel' | 'ticket' | 'appointment' | 'report' | 'announcement' | 'compose'; id: string } | null;

/** WhatsApp-style relative stamp: time today, weekday this week, otherwise a date. */
export function listStamp(d: string | null | undefined) {
  if (!d) return '';
  const date = new Date(d);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatTime(date);
  const days = (now.getTime() - date.getTime()) / 86400_000;
  if (days < 6) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return formatDate(date, { day: 'numeric', month: 'short' });
}

export function UnreadBadge({ count, muted }: { count: number; muted?: boolean }) {
  if (count <= 0) return null;
  return (
    <span className={cn('tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold', muted ? 'bg-slate-300 text-white' : 'bg-brand-600 text-white')} aria-label={`${count} unread`}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function PresenceDot({ online, className }: { online: boolean | null; className?: string }) {
  if (online === null) return null;
  return <span className={cn('absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white', online ? 'bg-brand-500' : 'bg-slate-300', className)} aria-label={online ? 'Online' : 'Offline'} />;
}

export async function markRead(itemType: ChatItemType, itemId: string) {
  await api.post('/chats/read', { itemType, itemId }).catch(() => undefined);
}

export async function setPreference(itemType: ChatItemType, itemId: string, change: Partial<Record<'pinned' | 'archived' | 'muted' | 'markedUnread', boolean>>) {
  return api.patch<{ pinned: boolean; archived: boolean; muted: boolean; markedUnread: boolean }>('/chats/preferences', { itemType, itemId, ...change });
}

export const ANNOUNCEMENT_PRIORITY_TONE: Record<string, 'neutral' | 'amber' | 'rose'> = { standard: 'neutral', important: 'amber', urgent: 'rose' };
