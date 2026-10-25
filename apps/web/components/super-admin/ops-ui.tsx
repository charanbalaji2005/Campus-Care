'use client';

import * as React from 'react';
import { DUTY_STATUS_LABELS, SOS_STATUS_LABELS, type DutyStatus } from '@campuscare/shared';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';

/** Re-renders every `ms` so relative times ("12 s ago") stay honest without refetching. */
export function useNow(ms = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function ageLabel(seconds: number | null | undefined) {
  if (seconds == null) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function secondsSince(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
}

const DUTY_TONES: Record<DutyStatus, string> = {
  on_duty: 'bg-brand-100 text-forest ring-brand-200',
  responding: 'bg-forest text-white ring-forest',
  busy: 'bg-amber-100 text-amber-700 ring-amber-200',
  on_break: 'bg-sky-50 text-slate-700 ring-slate-200',
  unavailable: 'bg-slate-100 text-slate-600 ring-slate-200',
  off_duty: 'bg-white text-slate-500 ring-slate-200',
  stale: 'bg-rose-100 text-rose-700 ring-rose-200',
};

export function DutyBadge({ status, className }: { status: DutyStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', DUTY_TONES[status], className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', status === 'stale' ? 'animate-pulse bg-rose-600' : status === 'off_duty' ? 'bg-slate-300' : status === 'responding' ? 'bg-white' : 'bg-current')} aria-hidden />
      {status === 'stale' ? 'Stale' : DUTY_STATUS_LABELS[status]}
    </span>
  );
}

/** Heartbeat freshness shown with the server's threshold — stale never reads as "off duty". */
export function Freshness({ lastAt, thresholdSeconds, now, active }: { lastAt: string | null; thresholdSeconds: number; now: number; active: boolean }) {
  const age = secondsSince(lastAt, now);
  if (!active && age == null) return <span className="text-xs text-ink-soft">—</span>;
  const fresh = age != null && age <= thresholdSeconds;
  const warn = age != null && age > thresholdSeconds * 0.6 && fresh;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs tabular', !active ? 'text-ink-soft' : fresh ? (warn ? 'text-amber-700' : 'text-brand-700') : 'font-semibold text-rose-700')} title={lastAt ?? 'No heartbeat yet'}>
      <span className={cn('h-2 w-2 rounded-full', !active ? 'bg-slate-300' : fresh ? (warn ? 'bg-amber-500' : 'bg-brand-500') : 'bg-rose-600')} aria-hidden />
      {ageLabel(age)}{active && !fresh && ' · stale'}
    </span>
  );
}

const SOS_TONE: Record<string, 'rose' | 'amber' | 'brand' | 'neutral' | 'dark'> = {
  queued: 'rose', sending: 'rose', sent: 'rose', failed: 'rose', acknowledged: 'amber', en_route: 'brand', resolved: 'neutral', cancelled: 'neutral', pending: 'neutral',
};
export function SosBadge({ status }: { status: string }) {
  return <Badge tone={SOS_TONE[status] ?? 'neutral'}>{SOS_STATUS_LABELS[status as keyof typeof SOS_STATUS_LABELS] ?? status}</Badge>;
}

export function AssignmentBadge({ state }: { state: string }) {
  if (state === 'unassigned') return <Badge tone="rose" className="animate-pulse">Unassigned</Badge>;
  if (state === 'offered') return <Badge tone="amber">Offered</Badge>;
  if (state === 'acknowledged') return <Badge tone="brand">Owned</Badge>;
  if (state === 'closed') return <Badge>Closed</Badge>;
  return <Badge>Not assigned yet</Badge>;
}

/** Large metric tile used across the operations dashboard. */
export function Kpi({ label, value, hint, icon, tone = 'neutral', href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode; tone?: 'neutral' | 'rose' | 'amber' | 'brand'; href?: string }) {
  const tones = { neutral: 'bg-stone-100 text-ink', rose: 'bg-rose-50 text-rose-700', amber: 'bg-amber-50 text-amber-700', brand: 'bg-brand-50 text-brand-700' };
  const body = (
    <div className={cn('card h-full p-4 transition', href && 'hover:-translate-y-0.5 hover:shadow-lift', tone === 'rose' && 'border-rose-200')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-soft">{label}</p>
        {icon && <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tones[tone])}>{icon}</span>}
      </div>
      <p className={cn('tabular mt-1.5 text-[28px] font-semibold leading-none tracking-tight', tone === 'rose' ? 'text-rose-700' : 'text-ink-strong')}>{value}</p>
      {hint && <p className="mt-2 text-xs text-ink-soft">{hint}</p>}
    </div>
  );
  return href ? <a href={href} className="block rounded-2xl focus-visible:ring-2 focus-visible:ring-brand-600">{body}</a> : body;
}

/** Table shell with consistent header styling and horizontal scroll on small screens. */
export function DataTable({ head, children, minWidth = 720, empty }: { head: React.ReactNode[]; children: React.ReactNode; minWidth?: number; empty?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="border-b border-line bg-stone-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
          <tr>{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2.5">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function FilterChip({ active, onClick, children, count }: { active: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition', active ? 'border-forest bg-forest text-white' : 'border-line bg-white text-ink hover:border-brand-300')}>
      {children}
      {count != null && <span className={cn('tabular rounded-full px-1.5 text-[10px]', active ? 'bg-white/20' : 'bg-stone-100')}>{count}</span>}
    </button>
  );
}

export function fmtMeters(m: number | null | undefined) {
  if (m == null) return 'unknown';
  return m >= 1000 ? `±${(m / 1000).toFixed(1)} km` : `±${Math.round(m)} m`;
}

export function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
