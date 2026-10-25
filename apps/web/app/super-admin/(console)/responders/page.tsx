'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { MapPinned, Pencil, Plus, Search, UserRoundCheck } from 'lucide-react';
import { RESPONDER_RESPONSIBILITIES, RESPONDER_SKILLS, RESPONDER_SKILL_LABELS, hasPermission } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/components/layout/portal-shell';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DataTable, DutyBadge, Freshness, useNow } from '@/components/super-admin/ops-ui';
import type { DutyStatus } from '@campuscare/shared';

interface Responder {
  userId: string; name: string; identifier: string; phone: string | null; status: DutyStatus; lastHeartbeatAt: string | null; campus: string; zoneId: string | null; zone: string | null;
  skills: string[]; responsibilities: string[]; activeAssignmentCount: number; locationConsent: boolean; supervisor: string | null; accountStatus: string;
  stats30d: { offers: number; acknowledged: number; declined: number; expired: number; medianAckSeconds: number | null };
}
interface Zone { id: string; name: string; code: string; campus: string; latitude: number; longitude: number; radiusMeters: number; description: string; active: boolean }

const RESP_LABELS: Record<string, string> = { sos_response: 'SOS response', patrol: 'Patrol', escort: 'Escort', gate: 'Gate', control_room: 'Control room', supervisor: 'Supervisor' };

function ProfileDialog({ r, zones, onClose, onDone }: { r: Responder | null; zones: Zone[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = React.useState({ campus: '', zoneId: '', skills: [] as string[], responsibilities: [] as string[], reason: '' });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (r) setV({ campus: r.campus, zoneId: r.zoneId ?? '', skills: r.skills, responsibilities: r.responsibilities, reason: '' }); }, [r]);
  if (!r) return null;
  const toggle = (k: 'skills' | 'responsibilities', x: string) => setV((s) => ({ ...s, [k]: s[k].includes(x) ? s[k].filter((y) => y !== x) : [...s[k], x] }));
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/responders/${r!.userId}/profile`, { campus: v.campus, zoneId: v.zoneId || null, skills: v.skills, responsibilities: v.responsibilities, reason: v.reason });
      toast.success('Responder profile updated');
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
      <DialogContent title={`Responder profile — ${r.name}`} description="Qualifications and responsibilities decide which emergencies this responder can be assigned." className="max-w-2xl">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rp-c" label="Campus"><Input value={v.campus} onChange={(e) => setV({ ...v, campus: e.target.value })} /></Field>
          <Field id="rp-z" label="Home zone"><Select value={v.zoneId} onChange={(e) => setV({ ...v, zoneId: e.target.value })}><option value="">None</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</Select></Field>
        </div>
        <fieldset className="mt-4"><legend className="text-sm font-medium">Qualifications</legend>
          <div className="mt-2 flex flex-wrap gap-2">{RESPONDER_SKILLS.map((k) => <button key={k} type="button" aria-pressed={v.skills.includes(k)} onClick={() => toggle('skills', k)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', v.skills.includes(k) ? 'border-forest bg-forest text-white' : 'border-line bg-white')}>{RESPONDER_SKILL_LABELS[k]}</button>)}</div>
        </fieldset>
        <fieldset className="mt-4"><legend className="text-sm font-medium">Permitted responsibilities</legend>
          <div className="mt-2 flex flex-wrap gap-2">{RESPONDER_RESPONSIBILITIES.map((k) => <button key={k} type="button" aria-pressed={v.responsibilities.includes(k)} onClick={() => toggle('responsibilities', k)} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', v.responsibilities.includes(k) ? 'border-forest bg-forest text-white' : 'border-line bg-white')}>{RESP_LABELS[k]}</button>)}</div>
          {!v.responsibilities.includes('sos_response') && <Alert tone="amber" className="mt-3">Without “SOS response” this person will never be assigned an SOS automatically.</Alert>}
        </fieldset>
        <Field id="rp-r" label="Reason for the change (required)" className="mt-4"><Textarea rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={v.reason.trim().length < 5} onClick={save}>Save profile</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ZonesCard({ canManage }: { canManage: boolean }) {
  const { data, mutate } = useApi<Zone[]>('/admin/response-zones');
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: '', code: '', campus: 'main', latitude: '', longitude: '', radiusMeters: '300', description: '', active: true });
  const [busy, setBusy] = React.useState(false);
  async function create() {
    setBusy(true);
    try {
      await api.post('/admin/response-zones', { ...v, latitude: Number(v.latitude), longitude: Number(v.longitude), radiusMeters: Number(v.radiusMeters) });
      toast.success('Zone created');
      setOpen(false);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(z: Zone) {
    try {
      await api.patch(`/admin/response-zones/${z.id}`, { active: !z.active });
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <Card>
      <CardHeader title="Response zones" description="Alerts inside a zone prefer responders assigned to it — only when the alert's location is precise enough to say so." action={canManage && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add zone</Button>} />
      {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : (
        <DataTable head={['Zone', 'Code', 'Campus', 'Centre', 'Radius', 'Active']} minWidth={640} empty={!data.length ? <EmptyState icon={<MapPinned className="h-6 w-6" />} title="No zones yet" description="Without zones, dispatch ranks by qualifications, workload, trusted distance and fairness." /> : null}>
          {data.map((z) => (
            <tr key={z.id}>
              <td className="px-4 py-2.5 font-medium">{z.name}</td><td className="px-4 py-2.5 font-mono text-xs">{z.code}</td><td className="px-4 py-2.5">{z.campus}</td>
              <td className="tabular px-4 py-2.5 text-xs">{z.latitude.toFixed(5)}, {z.longitude.toFixed(5)}</td><td className="tabular px-4 py-2.5">{z.radiusMeters} m</td>
              <td className="px-4 py-2.5">{canManage ? <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => toggle(z)}>{z.active ? 'Active' : 'Inactive'}</button> : (z.active ? 'Active' : 'Inactive')}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add response zone" description="A circle around a centre point. Use the live map to read coordinates.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="z-n" label="Name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field id="z-c" label="Code" hint="lowercase-with-dashes"><Input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
            <Field id="z-lat" label="Latitude"><Input inputMode="decimal" value={v.latitude} onChange={(e) => setV({ ...v, latitude: e.target.value })} /></Field>
            <Field id="z-lng" label="Longitude"><Input inputMode="decimal" value={v.longitude} onChange={(e) => setV({ ...v, longitude: e.target.value })} /></Field>
            <Field id="z-r" label="Radius (m)"><Input type="number" min={25} max={5000} value={v.radiusMeters} onChange={(e) => setV({ ...v, radiusMeters: e.target.value })} /></Field>
            <Field id="z-cp" label="Campus"><Input value={v.campus} onChange={(e) => setV({ ...v, campus: e.target.value })} /></Field>
          </div>
          <SwitchRow id="z-a" label="Active" checked={v.active} onCheckedChange={(x) => setV({ ...v, active: x })} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={create}>Create zone</Button></div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function RespondersPage() {
  const me = useCurrentUser();
  const params = useSearchParams();
  const now = useNow(5000);
  const canManage = hasPermission({ role: me.user.role, permissions: me.user.permissions }, 'duty:manage');
  const [q, setQ] = React.useState('');
  const { data, error, mutate } = useApi<Responder[]>(`/admin/responders${q ? `?q=${encodeURIComponent(q)}` : ''}`, { keepPreviousData: true });
  const { data: zones } = useApi<Zone[]>('/admin/response-zones');
  const { data: roster } = useApi<{ policy: { staleThresholdSeconds: number } }>('/admin/duty-roster');
  const [edit, setEdit] = React.useState<Responder | null>(null);
  const highlight = params.get('id');

  return (
    <div className="space-y-5">
      <PageHeader title="Responders" description="Profiles, qualifications and 30-day response performance for everyone who can answer an SOS." />
      <div className="relative max-w-md"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-soft" /><Input className="pl-9" placeholder="Search responders" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search responders" /></div>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      <Card className="overflow-hidden">
        {!data ? <div className="p-5"><Skeleton className="h-64" /></div> : (
          <DataTable head={['Responder', 'Status', 'Heartbeat', 'Campus · zone', 'Qualifications', 'Responsibilities', '30 days', '']} minWidth={1080}
            empty={!data.length ? <EmptyState icon={<UserRoundCheck className="h-6 w-6" />} title="No responders" description="Invite staff with the security officer role from Users." /> : null}>
            {data.map((r) => {
              const s = r.stats30d;
              const ackRate = s.offers ? Math.round((s.acknowledged / s.offers) * 100) : null;
              return (
                <tr key={r.userId} className={cn('align-top', highlight === r.userId && 'bg-brand-50/60')}>
                  <td className="px-4 py-3"><p className="font-medium text-ink-strong">{r.name}</p><p className="text-[11px] text-ink-soft">{r.identifier}{r.phone ? ` · ${r.phone}` : ''}</p></td>
                  <td className="px-4 py-3"><DutyBadge status={r.status} /></td>
                  <td className="px-4 py-3"><Freshness lastAt={r.lastHeartbeatAt} thresholdSeconds={roster?.policy.staleThresholdSeconds ?? 120} now={now} active={r.status !== 'off_duty' && r.status !== 'unavailable'} /><p className="mt-0.5 text-[11px] text-ink-soft">{r.locationConsent ? 'Position shared on duty' : 'Position not shared'}</p></td>
                  <td className="px-4 py-3 text-[13px]">{r.campus}{r.zone && <span className="text-ink-soft"> · {r.zone}</span>}</td>
                  <td className="px-4 py-3"><div className="flex max-w-[14rem] flex-wrap gap-1">{r.skills.length ? r.skills.map((k) => <Badge key={k}>{RESPONDER_SKILL_LABELS[k as keyof typeof RESPONDER_SKILL_LABELS] ?? k}</Badge>) : <span className="text-xs text-ink-soft">None</span>}</div></td>
                  <td className="px-4 py-3"><div className="flex max-w-[12rem] flex-wrap gap-1">{r.responsibilities.map((k) => <Badge key={k} tone={k === 'sos_response' ? 'brand' : 'neutral'}>{RESP_LABELS[k] ?? k}</Badge>)}</div></td>
                  <td className="px-4 py-3 text-xs">
                    {s.offers ? <>
                      <p><strong className="tabular text-ink-strong">{s.acknowledged}</strong>/{s.offers} acknowledged{ackRate != null && ` (${ackRate}%)`}</p>
                      <p className="text-ink-soft">{s.declined} declined · {s.expired} missed{s.medianAckSeconds != null && ` · median ${s.medianAckSeconds}s`}</p>
                    </> : <span className="text-ink-soft">No assignments</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}><Pencil className="h-4 w-4" /> Edit</Button>}</td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Card>
      <ZonesCard canManage={canManage} />
      <ProfileDialog r={edit} zones={zones ?? []} onClose={() => setEdit(null)} onDone={() => void mutate()} />
    </div>
  );
}
