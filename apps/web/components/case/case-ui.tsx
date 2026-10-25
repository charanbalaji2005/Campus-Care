'use client';

import * as React from 'react';
import { CheckCircle2, Circle, Clock, FileText, Paperclip } from 'lucide-react';
import { CATEGORY_INFO, STATUS_LABELS, STUDENT_TIMELINE, type IncidentCategory, type IncidentStatus } from '@campuscare/shared';
import { Badge } from '@/components/ui/primitives';
import { bytes, cn, formatDateTime } from '@/lib/utils';
import { fileUrl } from '@/lib/api';

export interface IncidentView {
  id: string; caseNumber: string; category: IncidentCategory; status: IncidentStatus; statusLabel: string; severity: string; priority: string; urgent: boolean; anonymous: boolean;
  committee: { id: string; name: string; type: string } | null; createdAt: string; updatedAt: string; incidentDate: string; dueAcknowledgeAt?: string; dueResolveAt?: string;
  acknowledgedAt?: string | null; resolvedAt?: string | null; closedAt?: string | null; accessLevel: 'reporter' | 'handler' | 'triage';
  title: string; description?: string; location?: string; involvedParties?: string | null; preferredContact?: string; redacted: boolean;
  evidence?: { id: string; name: string; mimeType: string; sizeBytes: number; kind: string | null }[];
  assignee?: { id: string; name: string } | null;
  reporter?: { id: string; name: string; email: string; studentId: string | null; department: string | null; phone: string | null } | null;
  resolutionSummary?: string | null; unreadMessages?: number;
}
export interface TimelineItem { id: string; type: string; fromStatus: string | null; toStatus: string | null; body: string | null; actor: string; createdAt: string; studentVisible: boolean }

export function statusTone(s: string): 'brand' | 'amber' | 'rose' | 'neutral' | 'dark' {
  if (['resolved', 'closed'].includes(s)) return 'brand';
  if (['in_progress', 'assigned', 'triage', 'awaiting_information'].includes(s)) return 'amber';
  if (['escalated', 'rejected'].includes(s)) return 'rose';
  return 'neutral';
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{STATUS_LABELS[status as IncidentStatus] ?? status}</Badge>;
}

export function PriorityBadge({ priority, urgent }: { priority: string; urgent?: boolean }) {
  if (urgent || priority === 'urgent') return <Badge tone="rose">Urgent</Badge>;
  if (priority === 'high') return <Badge tone="amber">High</Badge>;
  return <Badge>{priority === 'low' ? 'Low' : 'Normal'}</Badge>;
}

export function categoryLabel(c: string) {
  return CATEGORY_INFO[c as IncidentCategory]?.label ?? c;
}

/** Student-friendly progress tracker (Submitted → … → Closed). */
export function ProgressTracker({ status }: { status: IncidentStatus }) {
  const special = status === 'rejected' || status === 'escalated' || status === 'awaiting_information';
  const order = STUDENT_TIMELINE;
  const idx = order.indexOf(status === 'awaiting_information' || status === 'escalated' ? 'in_progress' : status);
  return (
    <div>
      <ol className="flex items-center gap-1" aria-label="Case progress">
        {order.map((s, n) => {
          const done = idx >= n && status !== 'rejected';
          return (
            <li key={s} className="flex flex-1 flex-col items-center gap-1.5 text-center">
              <div className="flex w-full items-center">
                <div className={cn('h-0.5 flex-1', n === 0 ? 'bg-transparent' : done ? 'bg-brand-600' : 'bg-slate-200')} />
                {done ? <CheckCircle2 className="h-6 w-6 shrink-0 text-brand-600" aria-hidden /> : <Circle className="h-6 w-6 shrink-0 text-slate-300" aria-hidden />}
                <div className={cn('h-0.5 flex-1', n === order.length - 1 ? 'bg-transparent' : idx > n && status !== 'rejected' ? 'bg-brand-600' : 'bg-slate-200')} />
              </div>
              <span className={cn('text-[11px] leading-tight', done ? 'font-semibold text-forest' : 'text-ink-soft')}>{STATUS_LABELS[s]}</span>
            </li>
          );
        })}
      </ol>
      {special && <p className="mt-3 text-center text-sm font-medium text-amber-700">Current status: {STATUS_LABELS[status]}</p>}
    </div>
  );
}

export function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-sm text-ink-soft">No updates yet.</p>;
  return (
    <ol className="relative space-y-5 border-l-2 border-brand-100 pl-5">
      {items.map((t) => (
        <li key={t.id} className="relative">
          <span className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-brand-600" aria-hidden />
          <p className="text-sm font-semibold text-ink-strong">
            {t.type === 'status_changed' && t.toStatus ? STATUS_LABELS[t.toStatus as IncidentStatus] : t.type === 'created' ? 'Report submitted' : t.type === 'assigned' ? 'Assignment updated' : t.type.replace(/_/g, ' ')}
            {!t.studentVisible && <Badge className="ml-2" tone="neutral">Internal</Badge>}
          </p>
          {t.body && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{t.body}</p>}
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-soft"><Clock className="h-3 w-3" /> {formatDateTime(t.createdAt)} · {t.actor}</p>
        </li>
      ))}
    </ol>
  );
}

export function EvidenceList({ items }: { items: NonNullable<IncidentView['evidence']> }) {
  if (!items.length) return <p className="text-sm text-ink-soft">No evidence attached.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((e) => (
        <li key={e.id}>
          <a href={fileUrl('case', e.id)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm hover:bg-brand-50">
            {e.kind === 'document' ? <FileText className="h-5 w-5 text-brand-700" /> : <Paperclip className="h-5 w-5 text-brand-700" />}
            <span className="min-w-0 flex-1 truncate">{e.name}</span>
            <span className="text-xs text-ink-soft">{bytes(e.sizeBytes)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
