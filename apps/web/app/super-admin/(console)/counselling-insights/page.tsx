'use client';

import * as React from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck, Clock, Lock, MessageSquareHeart, Timer } from 'lucide-react';
import { FEEDBACK_STATUSES, type FeedbackStatus } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Select, Skeleton, StatCard, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const GRID = '#E2E8F0';
const PRIMARY = '#059669';
const DARK = '#064E3B';

interface Analytics {
  range: { from: string; to: string };
  volume: { total: number; byStatus: Record<string, number>; byMonth: { month: string; count: number }[] };
  capacity: { openSlotsNext14Days: number; bookedNext14Days: number };
  rates: { cancellation: number | null; missed: number | null };
  responseTime: { measured: number; withinOneHour: number; compliance: number | null; averageMinutes: number | null };
  averageWaitHours: number | null;
  feedback: { count: number; averageRating: number | null; concerns: number; byMonth: { month: string; count: number; averageRating: number | null }[] };
  byCounsellor: { counsellor: string; appointments: number; completed: number; missed: number; feedbackCount: number; averageRating: number | null }[];
}

interface FeedbackItem {
  id: string; counsellor: string; rating: number | null; categories: string[]; comment: string | null; concern: boolean; anonymous: boolean;
  student: string | null; sessionMonth: string; status: FeedbackStatus; moderationNote: string | null; reviewedAt: string | null;
  publicComment: 'none' | 'pending' | 'approved' | 'rejected'; publicText: string | null; reportCount: number; hiddenFromPublic: boolean; countsPublicly: boolean;
}

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const RANGES = [{ v: '30', l: 'Last 30 days' }, { v: '90', l: 'Last 90 days' }, { v: '365', l: 'Last 12 months' }];

/** Aggregate counselling metrics and feedback moderation. No student identity appears in the analytics. */
export default function CounsellingInsightsPage() {
  const [days, setDays] = React.useState('30');
  const from = React.useMemo(() => new Date(Date.now() - Number(days) * 86400_000).toISOString(), [days]);
  const { data, error, isLoading, mutate } = useApi<Analytics>(`/counselling/analytics?from=${encodeURIComponent(from)}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counselling Insights"
        description="Aggregate service metrics and feedback review. Individual sessions, notes and student identities are not shown here."
        actions={<Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Time range" className="w-44">{RANGES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</Select>}
      />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Appointments" value={data.volume.total} icon={<CalendarCheck className="h-4 w-4" />} hint={`${data.volume.byStatus.completed ?? 0} completed`} />
            <StatCard label="Answered within 1 hour" value={pct(data.responseTime.compliance)} icon={<Timer className="h-4 w-4" />} tone={data.responseTime.compliance != null && data.responseTime.compliance < 0.8 ? 'amber' : 'brand'}
              hint={data.responseTime.measured ? `${data.responseTime.withinOneHour}/${data.responseTime.measured} requests · avg ${data.responseTime.averageMinutes ?? '—'} min` : 'No responses measured yet'} />
            <StatCard label="Average wait for a session" value={data.averageWaitHours == null ? '—' : `${data.averageWaitHours} h`} icon={<Clock className="h-4 w-4" />} hint="Request to session start" />
            <StatCard label="Open vs booked (next 14 days)" value={`${data.capacity.openSlotsNext14Days} / ${data.capacity.bookedNext14Days}`} icon={<CalendarCheck className="h-4 w-4" />} hint="Open slots / booked appointments" />
            <StatCard label="Cancellation rate" value={pct(data.rates.cancellation)} tone="amber" />
            <StatCard label="Missed-appointment rate" value={pct(data.rates.missed)} tone="amber" hint="Of sessions that took place or were missed" />
            <StatCard label="Average feedback rating" value={data.feedback.averageRating ?? '—'} icon={<MessageSquareHeart className="h-4 w-4" />} hint={`${data.feedback.count} responses`} />
            <StatCard label="Feedback concerns" value={data.feedback.concerns} icon={<AlertTriangle className="h-4 w-4" />} tone={data.feedback.concerns ? 'rose' : 'brand'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Appointment volume" description="Requests created per month" />
              <div className="h-64 p-4">
                {data.volume.byMonth.length ? (
                  <ResponsiveContainer><BarChart data={data.volume.byMonth}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="month" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Appointments" fill={PRIMARY} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer>
                ) : <EmptyState title="No appointments in this period" />}
              </div>
            </Card>
            <Card>
              <CardHeader title="Feedback trend" description="Average rating by session month" />
              <div className="h-64 p-4">
                {data.feedback.byMonth.length ? (
                  <ResponsiveContainer><LineChart data={data.feedback.byMonth}><CartesianGrid strokeDasharray="3 3" stroke={GRID} /><XAxis dataKey="month" fontSize={12} /><YAxis domain={[0, 5]} fontSize={12} /><Tooltip /><Line type="monotone" dataKey="averageRating" name="Avg rating" stroke={DARK} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
                ) : <EmptyState title="No feedback yet" />}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader title="By counsellor" description="Workload only. Ratings are hidden until a counsellor has at least 3 feedback responses." />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr><th className="px-4 py-3">Counsellor</th><th className="px-4 py-3">Appointments</th><th className="px-4 py-3">Completed</th><th className="px-4 py-3">Missed</th><th className="px-4 py-3">Feedback</th><th className="px-4 py-3">Avg rating</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byCounsellor.map((r) => (
                    <tr key={r.counsellor}><td className="px-4 py-3 font-medium text-ink-strong">{r.counsellor}</td><td className="tabular px-4 py-3">{r.appointments}</td><td className="tabular px-4 py-3">{r.completed}</td><td className="tabular px-4 py-3">{r.missed}</td><td className="tabular px-4 py-3">{r.feedbackCount}</td><td className="tabular px-4 py-3">{r.averageRating ?? <span className="text-ink-soft">—</span>}</td></tr>
                  ))}
                  {!data.byCounsellor.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-soft">No appointments in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <FeedbackModeration />
    </div>
  );
}

function FeedbackModeration() {
  const [status, setStatus] = React.useState('');
  const [concernOnly, setConcernOnly] = React.useState(false);
  const [publicQueue, setPublicQueue] = React.useState(false);
  const [reportedOnly, setReportedOnly] = React.useState(false);
  const params = new URLSearchParams({
    limit: '50', ...(status ? { status } : {}), ...(concernOnly ? { concern: 'true' } : {}),
    ...(publicQueue ? { publicComment: 'pending' } : {}), ...(reportedOnly ? { reported: 'true' } : {}),
  });
  const { data, error, isLoading, mutate } = useApi<{ items: FeedbackItem[]; total: number }>(`/counselling/feedback?${params}`);
  const [editing, setEditing] = React.useState<FeedbackItem | null>(null);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Feedback review"
        description="Anonymous feedback never shows who wrote it. Concerns go to staff only, never to the counsellor. Each view of this list is audited."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={concernOnly} onChange={(e) => setConcernOnly(e.target.checked)} /> Concerns only</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={publicQueue} onChange={(e) => setPublicQueue(e.target.checked)} /> Public comments to review</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={reportedOnly} onChange={(e) => setReportedOnly(e.target.checked)} /> Reported</label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-36"><option value="">Any status</option>{FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          </div>
        }
      />
      {error && <div className="p-4"><ErrorState message={error.message} onRetry={() => mutate()} /></div>}
      {isLoading && <div className="space-y-2 p-4"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>}
      {data && !data.items.length && <EmptyState icon={<MessageSquareHeart className="h-6 w-6" />} title="No feedback" description="Nothing matches these filters." />}
      <ul className="divide-y divide-line">
        {data?.items.map((f) => (
          <li key={f.id} className={cn('flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start', f.concern && 'bg-rose-50/40')}>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-ink-strong">{f.counsellor}</span>
                {f.rating != null && <Badge tone="brand">{'★'.repeat(f.rating)}<span className="sr-only">{f.rating} of 5</span></Badge>}
                {f.concern && <Badge tone="rose"><AlertTriangle className="h-3 w-3" /> Concern</Badge>}
                <Badge>{humanize(f.status)}</Badge>
                <span className="text-xs text-ink-soft">Session {f.sessionMonth}</span>
              </div>
              {f.categories.length > 0 && <p className="text-xs text-ink-soft">{f.categories.map(humanize).join(' · ')}</p>}
              {f.comment && <p className="whitespace-pre-wrap text-sm text-ink">{f.comment}</p>}
              {f.publicComment !== 'none' && (
                <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-ink">
                  <span className="font-semibold">Public version ({PUBLIC_LABELS[f.publicComment]}{f.reportCount ? ` · reported ${f.reportCount}×` : ''}):</span> {f.publicText}
                </p>
              )}
              {(f.hiddenFromPublic || !f.countsPublicly) && !f.concern && <p className="text-xs text-ink-soft">{f.hiddenFromPublic ? 'Hidden from public ratings' : 'Not counted in public ratings (submitted before distinct-student counting)'}</p>}
              <p className="flex items-center gap-1 text-xs text-ink-soft">{f.anonymous ? <><Lock className="h-3 w-3" /> Anonymous</> : <>From {f.student}</>}{f.moderationNote ? ` · Note: ${f.moderationNote}` : ''}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(f)}>Review</Button>
          </li>
        ))}
      </ul>
      {editing && <ModerateDialog item={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void mutate(); }} />}
    </Card>
  );
}

const PUBLIC_LABELS = { none: 'not shared', pending: 'awaiting review', approved: 'shown publicly', rejected: 'not shown' } as const;

function ModerateDialog({ item, onClose, onDone }: { item: FeedbackItem; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = React.useState<FeedbackStatus>(item.status === 'new' ? 'reviewed' : item.status);
  const [note, setNote] = React.useState(item.moderationNote ?? '');
  const [decision, setDecision] = React.useState<'' | 'approved' | 'rejected'>('');
  const [publicText, setPublicText] = React.useState(item.publicText ?? '');
  const [hidden, setHidden] = React.useState(item.hiddenFromPublic);
  const [busy, setBusy] = React.useState(false);
  const canPublish = item.publicComment !== 'none' && !item.concern;
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/counselling/feedback/${item.id}`, {
        status, note,
        ...(canPublish && decision ? { publicComment: decision } : {}),
        ...(canPublish && publicText.trim() && publicText.trim() !== (item.publicText ?? '') ? { publicText: publicText.trim() } : {}),
        ...(hidden !== item.hiddenFromPublic ? { hiddenFromPublic: hidden } : {}),
      });
      toast.success('Feedback updated');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Review feedback" description="Changes are recorded in the audit log. The note is visible to staff only.">
        <div className="space-y-4">
          {item.concern && <Alert tone="rose" icon={<AlertTriangle className="h-4 w-4" />}>Marked as a concern. Escalate if it needs follow-up under campus policy.</Alert>}
          <Select value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus)} aria-label="Status">{FEEDBACK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Internal note (optional)" aria-label="Internal note" />
          {canPublish && (
            <div className="space-y-2 rounded-xl border border-line p-3">
              <p className="text-sm font-semibold text-ink-strong">Public comment</p>
              <p className="text-xs text-ink-soft">The student agreed to share an anonymised version. Remove anything that could identify them or anyone else; emails, links, numbers and ids are masked again on save.</p>
              <Textarea value={publicText} onChange={(e) => setPublicText(e.target.value)} maxLength={400} aria-label="Public text" />
              <Select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} aria-label="Public comment decision">
                <option value="">Keep as {PUBLIC_LABELS[item.publicComment]}</option>
                <option value="approved">Show on the counsellor&apos;s profile</option>
                <option value="rejected">Don&apos;t show publicly</option>
              </Select>
            </div>
          )}
          {!item.concern && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-brand-600" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              <span>Leave this feedback out of public ratings and themes<span className="block text-xs text-ink-soft">For feedback that breaks the policy. It stays here for staff.</span></span>
            </label>
          )}
          <Button className="w-full" loading={busy} onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
