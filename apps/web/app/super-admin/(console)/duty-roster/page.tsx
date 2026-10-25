'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarPlus, History, MoreHorizontal, RefreshCw, Search, ShieldAlert, SlidersHorizontal, Wifi } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  DEFAULT_SETTINGS, DUTY_LIMITS, DUTY_STATUSES, DUTY_STATUS_LABELS, RESPONDER_SKILLS, RESPONDER_SKILL_LABELS, hasPermission, type DutyStatus,
} from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi, useRealtime } from '@/lib/hooks';
import { formatDateTime, formatTime } from '@/lib/utils';
import { useCurrentUser } from '@/components/layout/portal-shell';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';
import { DataTable, DutyBadge, FilterChip, Freshness, toLocalInput, useNow } from '@/components/super-admin/ops-ui';

interface Row {
  userId: string; name: string; identifier: string; phone: string | null; accountStatus: string; status: DutyStatus; statusChangedAt: string | null; staleSince: string | null;
  lastHeartbeatAt: string | null; heartbeatAgeSeconds: number | null; heartbeatFresh: boolean; campus: string; zoneId: string | null; zone: string | null;
  skills: string[]; responsibilities: string[]; activeAssignmentCount: number; lastAssignedAt: string | null; locationConsent: boolean; supervisor: string | null;
  currentShift: { id: string; startAt: string; endAt: string; status: string } | null; nextShift: { id: string; startAt: string; endAt: string; status: string } | null;
}
interface Roster { policy: { heartbeatIntervalSeconds: number; staleThresholdSeconds: number; ackDeadlineSeconds: number; dispatchPolicy: string }; counts: Record<DutyStatus, number>; rows: Row[]; generatedAt: string }
interface Shift { id: string; responderId: string; responder: string; startAt: string; endAt: string; status: string; campus: string; notes: string | null; createdBy: string | null; assignedDirectly: boolean; startedAt: string | null; endedAt: string | null; endReason: string | null; declinedReason: string | null }
interface Zone { id: string; name: string; code: string; campus: string }

const ACTIVE: DutyStatus[] = ['on_duty', 'on_break', 'busy', 'responding', 'stale'];

function OverrideDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = React.useState<DutyStatus>('on_duty');
  const [reason, setReason] = React.useState('');
  const [force, setForce] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setReason(''); setForce(false); setStatus(row?.status === 'off_duty' ? 'on_duty' : 'off_duty'); }, [row]);
  if (!row) return null;
  const leaving = status === 'off_duty' || status === 'unavailable';
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/admin/responders/${row!.userId}/duty-status`, { status, reason, force });
      toast.success(`${row!.name} is now ${DUTY_STATUS_LABELS[status].toLowerCase()}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Override duty status — ${row.name}`} description="Manual overrides are recorded with your name and reason in the audit log.">
        <div className="space-y-4">
          <p className="text-sm">Current status: <DutyBadge status={row.status} /></p>
          <Field id="ov-status" label="New status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as DutyStatus)}>
              {(['on_duty', 'on_break', 'busy', 'unavailable', 'off_duty'] as DutyStatus[]).filter((s) => s !== row.status).map((s) => <option key={s} value={s}>{DUTY_STATUS_LABELS[s]}</option>)}
            </Select>
          </Field>
          {row.status === 'stale' && status === 'on_duty' && <Alert tone="amber">Setting a stale responder on duty does not make them reachable. They will only receive alerts again once their phone sends a heartbeat.</Alert>}
          <Field id="ov-reason" label="Reason (required)" hint="E.g. confirmed by radio, phone battery failed, shift handover.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          {leaving && row.activeAssignmentCount > 0 && (
            <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <input type="checkbox" className="mt-0.5 accent-rose-600" checked={force} onChange={(e) => setForce(e.target.checked)} />
              This responder is handling {row.activeAssignmentCount} emergency alert(s). Move their alerts to the next eligible responder and take them off duty.
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button loading={busy} disabled={reason.trim().length < 5 || (leaving && row.activeAssignmentCount > 0 && !force)} onClick={submit}>Apply override</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateShiftDialog({ open, onClose, rows, zones, onDone, preset }: { open: boolean; onClose: () => void; rows: Row[]; zones: Zone[]; onDone: () => void; preset?: string }) {
  const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
  const [v, setV] = React.useState({ responderId: preset ?? '', startAt: toLocalInput(start), endAt: toLocalInput(new Date(start.getTime() + 8 * 3600_000)), campus: 'main', zoneId: '', notes: '', assignDirectly: false });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) setV((x) => ({ ...x, responderId: preset ?? x.responderId })); }, [open, preset]);
  async function submit() {
    setBusy(true);
    setErrors({});
    try {
      await api.post('/admin/duty-shifts', { ...v, startAt: new Date(v.startAt).toISOString(), endAt: new Date(v.endAt).toISOString(), zoneId: v.zoneId || null, notes: v.notes || undefined });
      toast.success(v.assignDirectly ? 'Shift assigned' : 'Shift offered — the responder must accept it in the app');
      onDone();
      onClose();
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Create shift" description="Offer a shift for the responder to accept, or assign it directly as their supervisor." className="max-w-xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="sh-r" label="Responder" error={errors.responderId} className="sm:col-span-2">
            <Select value={v.responderId} onChange={(e) => setV({ ...v, responderId: e.target.value })}>
              <option value="">Choose…</option>
              {rows.filter((r) => r.accountStatus === 'active').map((r) => <option key={r.userId} value={r.userId}>{r.name} ({r.identifier})</option>)}
            </Select>
          </Field>
          <Field id="sh-s" label="Starts" error={errors.startAt}><Input type="datetime-local" value={v.startAt} onChange={(e) => setV({ ...v, startAt: e.target.value })} /></Field>
          <Field id="sh-e" label="Ends" error={errors.endAt} hint="At most 16 hours"><Input type="datetime-local" value={v.endAt} onChange={(e) => setV({ ...v, endAt: e.target.value })} /></Field>
          <Field id="sh-c" label="Campus"><Input value={v.campus} onChange={(e) => setV({ ...v, campus: e.target.value })} /></Field>
          <Field id="sh-z" label="Response zone">
            <Select value={v.zoneId} onChange={(e) => setV({ ...v, zoneId: e.target.value })}>
              <option value="">Any zone</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </Select>
          </Field>
          <Field id="sh-n" label="Notes" className="sm:col-span-2"><Input value={v.notes} maxLength={500} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Post, briefing, equipment…" /></Field>
          <div className="sm:col-span-2"><SwitchRow id="sh-d" label="Assign directly" description="As supervisor, accept the shift on the responder's behalf. They still confirm the start of duty in the app." checked={v.assignDirectly} onCheckedChange={(x) => setV({ ...v, assignDirectly: x })} /></div>
        </div>
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!v.responderId} onClick={submit}><CalendarPlus className="h-4 w-4" /> Create shift</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const { data } = useApi<{ events: { at: string; from: DutyStatus; to: DutyStatus; actor: string; actorName: string | null; reason: string | null }[]; shifts: { id: string; startAt: string; endAt: string; status: string; endReason: string | null }[]; assignments: { id: string; alertNumber: string | null; status: string; offeredAt: string; acknowledgedAt: string | null; closeReason: string | null }[] }>(row ? `/admin/responders/${row.userId}/history` : null);
  if (!row) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`History — ${row.name}`} description="Duty changes, shifts and SOS assignments (most recent first)." className="max-w-3xl">
        {!data ? <Skeleton className="h-64" /> : (
          <Tabs defaultValue="duty">
            <TabsList><TabsTrigger value="duty">Duty changes</TabsTrigger><TabsTrigger value="shifts">Shifts</TabsTrigger><TabsTrigger value="sos">Assignments</TabsTrigger></TabsList>
            <TabsContent value="duty" className="mt-3">
              {!data.events.length ? <EmptyState title="No duty changes yet" /> : (
                <ol className="space-y-2">
                  {data.events.map((e, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                      <span className="tabular w-36 shrink-0 text-xs text-ink-soft">{formatDateTime(e.at)}</span>
                      <DutyBadge status={e.from} /> → <DutyBadge status={e.to} />
                      <Badge tone={e.actor === 'supervisor' ? 'amber' : e.actor === 'system' ? 'neutral' : 'brand'}>{e.actor === 'supervisor' ? `Override · ${e.actorName ?? 'supervisor'}` : e.actor}</Badge>
                      {e.reason && <span className="text-xs text-ink-soft">“{e.reason}”</span>}
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
            <TabsContent value="shifts" className="mt-3">
              <DataTable head={['Start', 'End', 'Status', 'End reason']} minWidth={520} empty={!data.shifts.length ? <EmptyState title="No shifts" /> : null}>
                {data.shifts.map((s) => <tr key={s.id}><td className="px-4 py-2">{formatDateTime(s.startAt)}</td><td className="px-4 py-2">{formatDateTime(s.endAt)}</td><td className="px-4 py-2"><Badge>{s.status}</Badge></td><td className="px-4 py-2 text-xs text-ink-soft">{s.endReason ?? '—'}</td></tr>)}
              </DataTable>
            </TabsContent>
            <TabsContent value="sos" className="mt-3">
              <DataTable head={['Alert', 'Offered', 'Acknowledged', 'Outcome']} minWidth={520} empty={!data.assignments.length ? <EmptyState title="No assignments" /> : null}>
                {data.assignments.map((a) => <tr key={a.id}><td className="px-4 py-2 font-medium">{a.alertNumber ?? '—'}</td><td className="px-4 py-2">{formatDateTime(a.offeredAt)}</td><td className="px-4 py-2">{a.acknowledgedAt ? formatTime(a.acknowledgedAt) : '—'}</td><td className="px-4 py-2"><Badge tone={a.status === 'expired' || a.status === 'declined' ? 'amber' : 'neutral'}>{a.status}</Badge> <span className="text-xs text-ink-soft">{a.closeReason ?? ''}</span></td></tr>)}
              </DataTable>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ShiftsPanel({ canManage, rows, zones }: { canManage: boolean; rows: Row[]; zones: Zone[] }) {
  const { data, mutate, error } = useApi<Shift[]>('/admin/duty-shifts');
  const [action, setAction] = React.useState<{ shift: Shift; kind: 'cancel' | 'end' | 'reassign' } | null>(null);
  const [reason, setReason] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  useRealtime('duty:roster', { 'duty:shift': () => void mutate() });
  async function apply() {
    if (!action) return;
    setBusy(true);
    try {
      await api.patch(`/admin/duty-shifts/${action.shift.id}`, { action: action.kind, reason, responderId: target || undefined });
      toast.success('Shift updated');
      setAction(null); setReason(''); setTarget('');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  return (
    <Card>
      <CardHeader title="Shifts (yesterday → next 7 days)" description="Offered shifts wait for the responder to accept. Duty starts only when the officer confirms it in the app." />
      {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : (
        <DataTable head={['Responder', 'When', 'Status', 'Campus', 'Notes', '']} empty={!data.length ? <EmptyState title="No shifts in this period" /> : null}>
          {data.map((s) => (
            <tr key={s.id} className="hover:bg-stone-50">
              <td className="px-4 py-2.5 font-medium">{s.responder}</td>
              <td className="tabular px-4 py-2.5 text-[13px]">{formatDateTime(s.startAt)} – {formatTime(s.endAt)}</td>
              <td className="px-4 py-2.5"><Badge tone={s.status === 'active' ? 'brand' : s.status === 'offered' ? 'amber' : s.status === 'declined' || s.status === 'missed' ? 'rose' : 'neutral'}>{s.status}{s.assignedDirectly && s.status === 'accepted' ? ' (assigned)' : ''}</Badge>{s.declinedReason && <p className="mt-1 text-xs text-rose-700">“{s.declinedReason}”</p>}</td>
              <td className="px-4 py-2.5 text-xs">{s.campus}</td>
              <td className="max-w-[16rem] truncate px-4 py-2.5 text-xs text-ink-soft">{s.notes ?? '—'}</td>
              <td className="px-4 py-2.5 text-right">
                {canManage && ['offered', 'accepted', 'declined', 'active'].includes(s.status) && (
                  <div className="flex justify-end gap-1">
                    {s.status === 'active' ? <Button size="sm" variant="outline" onClick={() => setAction({ shift: s, kind: 'end' })}>End</Button> : <>
                      <Button size="sm" variant="ghost" onClick={() => setAction({ shift: s, kind: 'reassign' })}>Reassign</Button>
                      {s.status !== 'declined' && <Button size="sm" variant="ghost" onClick={() => setAction({ shift: s, kind: 'cancel' })}>Cancel</Button>}
                    </>}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      {action && (
        <Dialog open onOpenChange={(o) => !o && setAction(null)}>
          <DialogContent title={`${action.kind === 'end' ? 'End' : action.kind === 'cancel' ? 'Cancel' : 'Reassign'} shift — ${action.shift.responder}`} description="Recorded with your reason in the audit log.">
            <div className="space-y-4">
              {action.kind === 'reassign' && (
                <Field id="ra-t" label="New responder"><Select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{rows.filter((r) => r.userId !== action.shift.responderId).map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}</Select></Field>
              )}
              {action.kind === 'end' && <Alert tone="amber">Ending an active shift takes the responder off duty. If they are handling an emergency you will be asked to confirm moving it.</Alert>}
              <Field id="ra-r" label="Reason (required)"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAction(null)}>Back</Button><Button loading={busy} disabled={reason.trim().length < 5 || (action.kind === 'reassign' && !target)} onClick={apply}>Confirm</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {zones.length === 0 && null}
    </Card>
  );
}

function PolicyPanel() {
  const duty = useSectionDraft('duty');
  const dispatch = useSectionDraft('dispatch');
  if (!duty.draft || !dispatch.draft) return <Skeleton className="h-96" />;
  const d = duty.draft;
  const p = dispatch.draft;
  const num = (v: string) => Number(v);
  const staleTooLow = d.staleThresholdSeconds < d.heartbeatIntervalSeconds * 2;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Heartbeats & duty" description={`Defaults: heartbeat ${DEFAULT_SETTINGS.duty.heartbeatIntervalSeconds}s, stale after ${DEFAULT_SETTINGS.duty.staleThresholdSeconds}s.`} dirty={duty.dirty} saving={duty.saving} onSave={() => void duty.save()} onDiscard={duty.discard} onDefaults={duty.resetToDefaults}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="hb-i" label="Heartbeat interval (seconds)" hint={`${DUTY_LIMITS.heartbeatIntervalSeconds.min}–${DUTY_LIMITS.heartbeatIntervalSeconds.max}`}><Input type="number" min={DUTY_LIMITS.heartbeatIntervalSeconds.min} max={DUTY_LIMITS.heartbeatIntervalSeconds.max} value={d.heartbeatIntervalSeconds} onChange={(e) => duty.setDraft({ ...d, heartbeatIntervalSeconds: num(e.target.value) })} /></Field>
          <Field id="hb-s" label="Stale threshold (seconds)" hint="At least twice the interval"><Input type="number" min={DUTY_LIMITS.staleThresholdSeconds.min} max={DUTY_LIMITS.staleThresholdSeconds.max} value={d.staleThresholdSeconds} onChange={(e) => duty.setDraft({ ...d, staleThresholdSeconds: num(e.target.value) })} /></Field>
          <Field id="hb-g" label="Shift start grace (minutes)"><Input type="number" min={0} max={120} value={d.shiftStartGraceMinutes} onChange={(e) => duty.setDraft({ ...d, shiftStartGraceMinutes: num(e.target.value) })} /></Field>
        </div>
        {staleTooLow && <Alert tone="amber" className="mt-3">The stale threshold must be at least twice the heartbeat interval, so one dropped heartbeat never marks someone unreachable.</Alert>}
        <SwitchRow id="hb-w" label="Allow duty without a shift" description="Off by default: responders go on duty by starting an accepted shift." checked={d.allowDutyWithoutShift} onCheckedChange={(v) => duty.setDraft({ ...d, allowDutyWithoutShift: v })} />
        <SwitchRow id="hb-l" label="Responder location while on duty" description="Responders may opt in to share position with dispatch while on duty. Never collected off duty." checked={d.responderLocationSharing} onCheckedChange={(v) => duty.setDraft({ ...d, responderLocationSharing: v })} />
        <SwitchRow id="hb-n" label="Alert supervisors when someone goes stale" checked={d.notifySupervisorsOnStale} onCheckedChange={(v) => duty.setDraft({ ...d, notifySupervisorsOnStale: v })} />
      </SectionCard>
      <SectionCard title="SOS assignment" description="How alerts are matched to responders." dirty={dispatch.dirty} saving={dispatch.saving} onSave={() => void dispatch.save()} onDiscard={dispatch.discard} onDefaults={dispatch.resetToDefaults}>
        <SwitchRow id="dp-a" label="Assign automatically" description="Off: every active officer is notified instead (no targeted assignment)." checked={p.autoAssign} onCheckedChange={(v) => dispatch.setDraft({ ...p, autoAssign: v })} />
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <Field id="dp-p" label="Policy"><Select value={p.policy} onChange={(e) => dispatch.setDraft({ ...p, policy: e.target.value as 'single' | 'group' })}><option value="single">Single responder at a time</option><option value="group">Group (first to acknowledge owns it)</option></Select></Field>
          {p.policy === 'group' && <Field id="dp-g" label="Group size"><Input type="number" min={1} max={5} value={p.groupSize} onChange={(e) => dispatch.setDraft({ ...p, groupSize: num(e.target.value) })} /></Field>}
          <Field id="dp-d" label="Acknowledge within (seconds)" hint={`${DUTY_LIMITS.ackDeadlineSeconds.min}–${DUTY_LIMITS.ackDeadlineSeconds.max}`}><Input type="number" value={p.ackDeadlineSeconds} onChange={(e) => dispatch.setDraft({ ...p, ackDeadlineSeconds: num(e.target.value) })} /></Field>
          <Field id="dp-m" label="Attempts before fallback group" hint="Assignment continues afterwards"><Input type="number" min={1} max={10} value={p.maxAttempts} onChange={(e) => dispatch.setDraft({ ...p, maxAttempts: num(e.target.value) })} /></Field>
          <Field id="dp-c" label="Alerts per responder"><Input type="number" min={1} max={5} value={p.maxActiveAssignmentsPerResponder} onChange={(e) => dispatch.setDraft({ ...p, maxActiveAssignmentsPerResponder: num(e.target.value) })} /></Field>
          <Field id="dp-t" label="Trusted GPS accuracy (m)" hint="Less precise fixes are not used for distance"><Input type="number" min={5} max={1000} value={p.trustedLocationAccuracyMeters} onChange={(e) => dispatch.setDraft({ ...p, trustedLocationAccuracyMeters: num(e.target.value) })} /></Field>
          <Field id="dp-b" label="Distance band (m)" hint="Distances within a band count as equal"><Input type="number" min={50} max={2000} value={p.proximityBandMeters} onChange={(e) => dispatch.setDraft({ ...p, proximityBandMeters: num(e.target.value) })} /></Field>
        </div>
        <SwitchRow id="dp-busy" label="Use busy responders when nobody else is free" checked={p.allowBusyResponders} onCheckedChange={(v) => dispatch.setDraft({ ...p, allowBusyResponders: v })} />
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-ink-strong">Skills</legend>
          <p className="text-xs text-ink-soft">Required skills exclude responders without them; preferred skills rank responders higher.</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {RESPONDER_SKILLS.map((k) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-line px-3 py-1.5 text-sm">
                <span>{RESPONDER_SKILL_LABELS[k]}</span>
                <Select className="h-8 w-28 text-xs" value={p.requiredSkills.includes(k) ? 'required' : p.preferredSkills.includes(k) ? 'preferred' : ''} aria-label={`${RESPONDER_SKILL_LABELS[k]} policy`}
                  onChange={(e) => dispatch.setDraft({ ...p, requiredSkills: e.target.value === 'required' ? [...p.requiredSkills.filter((x) => x !== k), k] : p.requiredSkills.filter((x) => x !== k), preferredSkills: e.target.value === 'preferred' ? [...p.preferredSkills.filter((x) => x !== k), k] : p.preferredSkills.filter((x) => x !== k) })}>
                  <option value="">—</option><option value="preferred">Preferred</option><option value="required">Required</option>
                </Select>
              </div>
            ))}
          </div>
        </fieldset>
      </SectionCard>
    </div>
  );
}

export default function DutyRosterPage() {
  const me = useCurrentUser();
  const router = useRouter();
  const params = useSearchParams();
  const now = useNow(1000);
  const canManage = hasPermission({ role: me.user.role, permissions: me.user.permissions }, 'duty:manage');
  const canPolicy = hasPermission({ role: me.user.role, permissions: me.user.permissions }, 'settings:manage');
  const [f, setF] = React.useState({ q: '', campus: '', zoneId: '', status: params.get('status') ?? '', skill: '', workload: '' });
  const query = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const { data, error, mutate, isLoading } = useApi<Roster>(`/admin/duty-roster${query ? `?${query}` : ''}`, { refreshInterval: 30_000, keepPreviousData: true });
  const { data: all } = useApi<Roster>('/admin/duty-roster', { refreshInterval: 60_000 });
  const { data: zones } = useApi<Zone[]>('/admin/response-zones');
  const [override, setOverride] = React.useState<Row | null>(null);
  const [history, setHistory] = React.useState<Row | null>(null);
  const [create, setCreate] = React.useState<{ open: boolean; preset?: string }>({ open: false });
  const live = useRealtime('duty:roster', { 'duty:updated': () => void mutate(), 'duty:heartbeat': () => void mutate() });

  const setFilter = (k: keyof typeof f, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    if (k === 'status') router.replace(v ? `/super-admin/duty-roster?status=${v}` : '/super-admin/duty-roster');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Duty roster"
        description={data ? <>Server-time heartbeats every {data.policy.heartbeatIntervalSeconds}s · stale after {data.policy.staleThresholdSeconds}s · acknowledge within {data.policy.ackDeadlineSeconds}s · {data.policy.dispatchPolicy} dispatch</> : 'Who is on duty, reachable and available — from the server, not the phones.'}
        actions={<>
          <Badge tone={live ? 'brand' : 'neutral'}><Wifi className="h-3 w-3" /> {live ? 'Live' : 'Polling'}</Badge>
          <Button variant="outline" onClick={() => mutate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          {canManage && <Button onClick={() => setCreate({ open: true })}><CalendarPlus className="h-4 w-4" /> Create shift</Button>}
        </>}
      />
      <Tabs defaultValue="roster">
        <TabsList><TabsTrigger value="roster">Roster</TabsTrigger><TabsTrigger value="shifts">Shifts</TabsTrigger>{canPolicy && <TabsTrigger value="policy"><SlidersHorizontal className="h-4 w-4" /> Policy</TabsTrigger>}</TabsList>

        <TabsContent value="roster" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            <FilterChip active={!f.status} onClick={() => setFilter('status', '')} count={all?.rows.length}>All</FilterChip>
            {DUTY_STATUSES.map((s) => <FilterChip key={s} active={f.status === s} onClick={() => setFilter('status', f.status === s ? '' : s)} count={all?.counts[s]}>{s === 'stale' ? 'Stale' : DUTY_STATUS_LABELS[s]}</FilterChip>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="relative lg:col-span-2"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-soft" /><Input className="pl-9" placeholder="Search officers" value={f.q} onChange={(e) => setFilter('q', e.target.value)} aria-label="Search officers" /></div>
            <Input placeholder="Campus" value={f.campus} onChange={(e) => setFilter('campus', e.target.value)} aria-label="Campus" />
            <Select value={f.zoneId} onChange={(e) => setFilter('zoneId', e.target.value)} aria-label="Zone"><option value="">All zones</option>{zones?.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select>
            <div className="grid grid-cols-2 gap-2">
              <Select value={f.skill} onChange={(e) => setFilter('skill', e.target.value)} aria-label="Skill"><option value="">Any skill</option>{RESPONDER_SKILLS.map((k) => <option key={k} value={k}>{RESPONDER_SKILL_LABELS[k]}</option>)}</Select>
              <Select value={f.workload} onChange={(e) => setFilter('workload', e.target.value)} aria-label="Workload"><option value="">Any load</option><option value="idle">No alerts</option><option value="assigned">Handling alerts</option></Select>
            </div>
          </div>
          {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
          <Card className="overflow-hidden">
            {isLoading && !data ? <div className="p-5"><Skeleton className="h-64" /></div> : data && (
              <DataTable head={['Officer', 'Duty status', 'Shift', 'Campus · zone', 'Heartbeat', 'Alerts', 'Qualifications', 'Supervisor', '']} minWidth={1100}
                empty={!data.rows.length ? <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="No responders match" description="Responders are staff accounts with the security officer role or an individual sos:respond permission." /> : null}>
                {data.rows.map((r) => {
                  const active = ACTIVE.includes(r.status);
                  return (
                    <tr key={r.userId} className="align-top hover:bg-stone-50">
                      <td className="px-4 py-3"><p className="font-medium text-ink-strong">{r.name}</p><p className="font-mono text-[11px] text-ink-soft">{r.identifier}{r.accountStatus !== 'active' && ` · ${r.accountStatus}`}</p></td>
                      <td className="px-4 py-3"><DutyBadge status={r.status} />{r.status === 'stale' && r.staleSince && <p className="mt-1 text-[11px] text-rose-700">since {formatTime(r.staleSince)}</p>}</td>
                      <td className="px-4 py-3 text-[13px]">
                        {r.currentShift ? <><p className="tabular">{formatTime(r.currentShift.startAt)}–{formatTime(r.currentShift.endAt)}</p><p className="text-[11px] text-brand-700">active</p></>
                          : r.nextShift ? <><p className="tabular">{formatDateTime(r.nextShift.startAt)}</p><p className="text-[11px] text-ink-soft">next · {r.nextShift.status}</p></> : <span className="text-ink-soft">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[13px]">{r.campus}{r.zone && <span className="text-ink-soft"> · {r.zone}</span>}</td>
                      <td className="px-4 py-3"><Freshness lastAt={r.lastHeartbeatAt} thresholdSeconds={data.policy.staleThresholdSeconds} now={now} active={active} />{r.locationConsent && <p className="mt-0.5 text-[11px] text-ink-soft">shares position</p>}</td>
                      <td className="tabular px-4 py-3">{r.activeAssignmentCount > 0 ? <Badge tone="rose">{r.activeAssignmentCount} open</Badge> : <span className="text-ink-soft">0</span>}</td>
                      <td className="px-4 py-3"><div className="flex max-w-[14rem] flex-wrap gap-1">{r.skills.length ? r.skills.map((s) => <Badge key={s} className="font-medium">{RESPONDER_SKILL_LABELS[s as keyof typeof RESPONDER_SKILL_LABELS] ?? s}</Badge>) : <span className="text-xs text-ink-soft">None recorded</span>}{!r.responsibilities.includes('sos_response') && <Badge tone="amber">No SOS duty</Badge>}</div></td>
                      <td className="px-4 py-3 text-xs text-ink-soft">{r.supervisor ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger className="rounded-lg p-1.5 hover:bg-stone-100" aria-label={`Actions for ${r.name}`}><MoreHorizontal className="h-4 w-4" /></DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content align="end" className="z-50 w-56 rounded-xl border border-line bg-white p-1 text-sm shadow-lift">
                              <DropdownMenu.Item onSelect={() => setHistory(r)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-brand-50"><History className="h-4 w-4" /> History</DropdownMenu.Item>
                              {canManage && <DropdownMenu.Item onSelect={() => setOverride(r)} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-brand-50"><ShieldAlert className="h-4 w-4" /> Override status…</DropdownMenu.Item>}
                              {canManage && <DropdownMenu.Item onSelect={() => setCreate({ open: true, preset: r.userId })} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-brand-50"><CalendarPlus className="h-4 w-4" /> Create shift</DropdownMenu.Item>}
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </Card>
          <p className="text-xs text-ink-soft">“Stale” means the server has not received a heartbeat within the threshold — the responder may be unreachable or out of signal. Stale responders are never offered new alerts and are not treated as off duty.</p>
        </TabsContent>

        <TabsContent value="shifts" className="mt-4"><ShiftsPanel canManage={canManage} rows={all?.rows ?? []} zones={zones ?? []} /></TabsContent>
        {canPolicy && <TabsContent value="policy" className="mt-4"><PolicyPanel /></TabsContent>}
      </Tabs>

      <OverrideDialog row={override} onClose={() => setOverride(null)} onDone={() => void mutate()} />
      <HistoryDialog row={history} onClose={() => setHistory(null)} />
      <CreateShiftDialog open={create.open} preset={create.preset} onClose={() => setCreate({ open: false })} rows={all?.rows ?? []} zones={zones ?? []} onDone={() => void mutate()} />
    </div>
  );
}
