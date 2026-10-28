'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { BadgeCheck, EyeOff, ImageOff, MessageSquareHeart, ShieldAlert, Star, UserRoundSearch } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn, humanize } from '@/lib/utils';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

type PublicRating =
  | { status: 'insufficient'; minimum: number }
  | { status: 'available'; minimum: number; average: number | null; ratingCount: number; distribution: Record<string, number> | null; themes: { category: string; count: number }[] };

interface Row {
  id: string; name: string; email: string; department: string | null; accountStatus: string;
  listed: boolean; listingReason: string | null; photoVisible: boolean; hasPhoto: boolean; hasProfile: boolean;
  title: string; bio: string; specializations: string[]; languages: string[];
  qualifications: string[]; yearsExperience: number | null; credentialsApprovedAt: string | null;
  pendingCredentials: { qualifications: string[]; yearsExperience: number | null; submittedAt: string } | null;
  onDuty: boolean; nextAvailableAt: string | null; studentVisible: boolean; rating: PublicRating | null;
  feedback: { total: number; distinctRaters: number; concerns: number; hidden: number; pendingComments: number; reported: number; legacy: number };
}
interface Overview { items: Row[]; settings: { feedbackMinimum: number; showComments: boolean } }

type Action = { row: Row; change: { listed?: boolean; photoVisible?: boolean; credentials?: 'approve' | 'reject' }; label: string };

/** Why a student cannot currently find this counsellor, in plain words. */
function visibilityReason(r: Row): string | null {
  if (r.accountStatus !== 'active') return `Account ${humanize(r.accountStatus).toLowerCase()}`;
  if (!r.listed) return 'Removed from the directory';
  if (!r.hasProfile) return 'Has not set up a schedule';
  if (!r.onDuty) return 'Off duty';
  if (!r.nextAvailableAt) return 'No open slots in the next two weeks';
  return null;
}

/**
 * Counsellor Directory administration: what students see, credential approval, listing and photo
 * visibility, and the privacy threshold for public feedback. Student identities never appear here.
 */
export default function CounsellorDirectoryPage() {
  const { data, error, isLoading, mutate } = useApi<Overview>('/counselling/admin/directory');
  const [action, setAction] = React.useState<Action | null>(null);
  const [q, setQ] = React.useState('');
  const rows = (data?.items ?? []).filter((r) => !q || `${r.name} ${r.department ?? ''} ${r.email}`.toLowerCase().includes(q.toLowerCase()));
  const pending = (data?.items ?? []).filter((r) => r.pendingCredentials);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Counsellor Directory"
        description="Control what students see when they choose a counsellor. Ratings and comments stay hidden until enough different students have given feedback."
      />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {isLoading && <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-40" /></div>}
      {data && (
        <>
          <ThresholdSettings settings={data.settings} onSaved={() => mutate()} />

          {pending.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={`Credentials to review (${pending.length})`} description="Qualifications appear on a public profile only after approval. Verify them against institutional records first." />
              <ul className="divide-y divide-line">
                {pending.map((r) => (
                  <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-ink-strong">{r.name}</p>
                      <p className="text-ink-soft">Submitted {new Date(r.pendingCredentials!.submittedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>
                      <ul className="mt-2 list-inside list-disc text-ink">{r.pendingCredentials!.qualifications.map((x) => <li key={x}>{x}</li>)}</ul>
                      {r.pendingCredentials!.yearsExperience != null && <p className="mt-1 text-ink">{r.pendingCredentials!.yearsExperience} years of experience</p>}
                      {r.credentialsApprovedAt && <p className="mt-1 text-xs text-ink-soft">Currently approved: {r.qualifications.join('; ') || 'none'}{r.yearsExperience != null ? ` · ${r.yearsExperience} years` : ''}</p>}
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setAction({ row: r, change: { credentials: 'approve' }, label: `Approve ${r.name}'s credentials` })}><BadgeCheck className="h-4 w-4" /> Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => setAction({ row: r, change: { credentials: 'reject' }, label: `Reject ${r.name}'s credentials` })}>Reject</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader
              title="Counsellors"
              description="Listing and photo changes take effect immediately and are recorded in the audit log with your reason."
              action={<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search counsellors" aria-label="Search counsellors" className="w-56" />}
            />
            {!rows.length && <EmptyState icon={<UserRoundSearch className="h-6 w-6" />} title="No counsellors" description={q ? 'Nothing matches your search.' : 'Counsellor accounts appear here once created.'} />}
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const why = visibilityReason(r);
                return (
                  <li key={r.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto]">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink-strong">{r.name}</span>
                        <span className="text-sm text-ink-soft">{r.title}{r.department ? ` · ${r.department}` : ''}</span>
                        {why ? <Badge tone="amber">Hidden from students: {why}</Badge> : <Badge tone="brand">Visible to students</Badge>}
                        {r.credentialsApprovedAt && <Badge tone="dark"><BadgeCheck className="h-3 w-3" /> Credentials approved</Badge>}
                      </div>
                      {!r.listed && r.listingReason && <p className="text-xs text-ink-soft">Removed: {r.listingReason}</p>}
                      <p className="text-xs text-ink-soft">
                        {r.specializations.map(humanize).join(' · ') || 'No specialisations'} · {r.languages.join(', ') || 'No languages'}
                      </p>
                      <RatingLine row={r} />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
                      <Button size="sm" variant={r.listed ? 'outline' : 'default'} disabled={r.accountStatus !== 'active'}
                        onClick={() => setAction({ row: r, change: { listed: !r.listed }, label: r.listed ? `Remove ${r.name} from the directory` : `List ${r.name} in the directory` })}>
                        {r.listed ? <><EyeOff className="h-4 w-4" /> Unlist</> : 'List in directory'}
                      </Button>
                      <Button size="sm" variant="outline" disabled={!r.hasPhoto}
                        onClick={() => setAction({ row: r, change: { photoVisible: !r.photoVisible }, label: r.photoVisible ? `Hide ${r.name}'s photo` : `Show ${r.name}'s photo` })}>
                        <ImageOff className="h-4 w-4" /> {!r.hasPhoto ? 'No photo' : r.photoVisible ? 'Hide photo' : 'Show photo'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
      {action && <ReasonDialog action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); void mutate(); }} />}
    </div>
  );
}

function RatingLine({ row }: { row: Row }) {
  const f = row.feedback;
  const r = row.rating;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
      <span className="inline-flex items-center gap-1">
        <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden />
        {r?.status === 'available' && r.average != null
          ? <span className="font-semibold text-ink">{r.average.toFixed(1)} from {r.ratingCount} ratings (public)</span>
          : <span>Not public yet — {f.distinctRaters} of {r?.minimum ?? 3} students needed</span>}
      </span>
      <span>{f.total} feedback</span>
      {f.concerns > 0 && <span className="inline-flex items-center gap-1 text-rose-700"><ShieldAlert className="h-3.5 w-3.5" /> {f.concerns} concerns (staff only)</span>}
      {f.pendingComments > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><MessageSquareHeart className="h-3.5 w-3.5" /> {f.pendingComments} comments awaiting review</span>}
      {f.reported > 0 && <span className="text-rose-700">{f.reported} reported</span>}
      {f.hidden > 0 && <span>{f.hidden} hidden by moderators</span>}
      {f.legacy > 0 && <span title="Submitted before distinct-student counting existed; kept out of public figures.">{f.legacy} older items not counted publicly</span>}
    </div>
  );
}

function ThresholdSettings({ settings, onSaved }: { settings: Overview['settings']; onSaved: () => void }) {
  const run = useSensitiveAction();
  const [min, setMin] = React.useState(String(settings.feedbackMinimum));
  const [comments, setComments] = React.useState(settings.showComments);
  const [busy, setBusy] = React.useState(false);
  const n = Number(min);
  const invalid = !Number.isInteger(n) || n < 3 || n > 50;
  const dirty = n !== settings.feedbackMinimum || comments !== settings.showComments;
  async function save() {
    setBusy(true);
    try {
      const done = await run(() => api.patch('/super-admin/settings', { settings: { counsellorDirectory: { feedbackMinimum: n, showComments: comments } } }));
      if (done !== undefined) { toast.success('Feedback privacy settings saved'); onSaved(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Public feedback privacy" description="Applies to every public surface: directory cards, profiles and the API. Concerns are never public." />
      <div className="grid gap-4 p-5 pt-0 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <Field id="fb-min" label="Students needed before feedback is shown" error={invalid ? 'Choose 3–50' : undefined} hint="Distinct students, so repeat sessions don't count twice.">
          <Input id="fb-min" type="number" min={3} max={50} value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        <SwitchRow id="fb-comments" label="Show approved comments" description="Anonymised comments that the student agreed to share and a moderator approved." checked={comments} onCheckedChange={setComments} />
        <Button loading={busy} disabled={invalid || !dirty} onClick={save}>Save</Button>
      </div>
    </Card>
  );
}

function ReasonDialog({ action, onClose, onDone }: { action: Action; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const short = reason.trim().length < 5;
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/counselling/admin/counsellors/${action.row.id}/directory`, { ...action.change, reason: reason.trim() });
      toast.success('Saved. The counsellor has been notified.');
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const tellsCounsellor = action.change.credentials === 'reject' || action.change.listed === false;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={action.label} description="Your reason is recorded in the audit log.">
        <div className="space-y-4">
          {tellsCounsellor && <Alert tone="amber">The counsellor will see this reason in their notification.</Alert>}
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Reason (at least 5 characters)" aria-label="Reason" className={cn(short && reason && 'border-rose-300')} />
          <Button className="w-full" loading={busy} disabled={short} onClick={save}>Confirm</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
