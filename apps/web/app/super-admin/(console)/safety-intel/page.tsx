'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Flame, MapPin, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { HAZARD_STATUSES, PLACE_KINDS, type PlaceKind } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize, timeAgo } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

interface Place { id: string; name: string; kind: PlaceKind; latitude: number; longitude: number; description: string; phone?: string | null; hours?: string | null; verified: boolean; active: boolean }
interface Hazard { id: string; category: string; description: string; locationLabel: string; latitude?: number | null; longitude?: number | null; status: string; publicNote?: string | null; anonymous: boolean; createdAt: string }
interface MapData { center: { latitude: number; longitude: number }; heatmap: { cellDegrees: number; minCount: number; days: number; cells: { latitude: number; longitude: number; count: number }[] }; places: { id: string; latitude: number; longitude: number; kind: string; name: string }[]; hazards: { id: string; latitude?: number | null; longitude?: number | null }[] }

const emptyPlace = { name: '', kind: 'help_point' as PlaceKind, latitude: '', longitude: '', description: '', phone: '', hours: '', verified: true, active: true };

function Places() {
  const { data, mutate } = useApi<Place[]>('/community/manage/places');
  const [editing, setEditing] = React.useState<{ id?: string; v: typeof emptyPlace } | null>(null);
  const [removing, setRemoving] = React.useState<Place | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!editing) return;
    const v = editing.v;
    const body = { ...v, latitude: Number(v.latitude), longitude: Number(v.longitude) };
    if (!v.name.trim() || Number.isNaN(body.latitude) || Number.isNaN(body.longitude)) { toast.error('Name, latitude and longitude are required.'); return; }
    setBusy(true);
    try {
      if (editing.id) await api.patch(`/community/manage/places/${editing.id}`, body);
      else await api.post('/community/manage/places', body);
      toast.success('Saved — it appears on the app’s Safety Map.');
      setEditing(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Campus places" description="Help points, security posts, medical rooms and safe zones shown on the Safety Map." action={<Button size="sm" onClick={() => setEditing({ v: { ...emptyPlace } })}><Plus className="h-4 w-4" /> Add place</Button>} />
      {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : !data.length ? <EmptyState icon={<MapPin className="h-6 w-6" />} title="No places yet" description="Add security posts and help points so students can find help on the map." /> : (
        <ul className="divide-y divide-line">
          {data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-strong">{p.name} {!p.active && <Badge>Hidden</Badge>} {p.verified && <Badge tone="brand"><ShieldCheck className="h-3 w-3" /> Verified</Badge>}</p>
                <p className="text-xs text-ink-soft">{humanize(p.kind)} · {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}{p.phone ? ` · ${p.phone}` : ''}</p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" aria-label={`Edit ${p.name}`} onClick={() => setEditing({ id: p.id, v: { name: p.name, kind: p.kind, latitude: String(p.latitude), longitude: String(p.longitude), description: p.description ?? '', phone: p.phone ?? '', hours: p.hours ?? '', verified: p.verified, active: p.active } })}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" aria-label={`Delete ${p.name}`} onClick={() => setRemoving(p)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title={editing?.id ? 'Edit place' : 'Add place'} description="Tip: in Google Maps, long-press a spot to copy its latitude and longitude.">
          {editing && (
            <div className="space-y-3">
              <Field id="p-name" label="Name" required><Input value={editing.v.name} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, name: e.target.value } })} /></Field>
              <Field id="p-kind" label="Type"><Select value={editing.v.kind} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, kind: e.target.value as PlaceKind } })}>{PLACE_KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="p-lat" label="Latitude" required><Input inputMode="decimal" value={editing.v.latitude} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, latitude: e.target.value } })} /></Field>
                <Field id="p-lng" label="Longitude" required><Input inputMode="decimal" value={editing.v.longitude} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, longitude: e.target.value } })} /></Field>
              </div>
              <Field id="p-desc" label="Description"><Textarea rows={2} value={editing.v.description} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, description: e.target.value } })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="p-phone" label="Phone"><Input value={editing.v.phone} onChange={(e) => setEditing({ ...editing, v: { ...editing.v, phone: e.target.value } })} /></Field>
                <Field id="p-hours" label="Hours"><Input value={editing.v.hours} placeholder="24×7" onChange={(e) => setEditing({ ...editing, v: { ...editing.v, hours: e.target.value } })} /></Field>
              </div>
              <SwitchRow id="p-ver" label="Verified by the university" checked={editing.v.verified} onCheckedChange={(v) => setEditing({ ...editing, v: { ...editing.v, verified: v } })} />
              <SwitchRow id="p-act" label="Show on the map" checked={editing.v.active} onCheckedChange={(v) => setEditing({ ...editing, v: { ...editing.v, active: v } })} />
              <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(null)} title={`Delete ${removing?.name ?? 'place'}?`} description="It disappears from the Safety Map." destructive confirmLabel="Delete"
        onConfirm={async () => { try { await api.delete(`/community/manage/places/${removing!.id}`); setRemoving(null); void mutate(); } catch (err) { toast.error(errorMessage(err)); } }} />
    </Card>
  );
}

function Hazards() {
  const [status, setStatus] = React.useState('open');
  const { data, mutate } = useApi<Hazard[]>(`/community/manage/hazards?status=${status}`);
  const [review, setReview] = React.useState<{ h: Hazard; status: string; note: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function save() {
    if (!review) return;
    setBusy(true);
    try {
      await api.patch(`/community/manage/hazards/${review.h.id}`, { status: review.status, publicNote: review.note || undefined });
      toast.success('Hazard updated');
      setReview(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Hazard reports" description="Reviewers see what was reported, never who reported it. Only verified hazards appear on the map." action={<Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="w-40">{HAZARD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>} />
      {!data ? <div className="p-5"><Skeleton className="h-40" /></div> : !data.length ? <EmptyState title="Nothing here" /> : (
        <ul className="divide-y divide-line">
          {data.map((h) => (
            <li key={h.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium text-ink-strong">{humanize(h.category)} · {h.locationLabel}</p>
                <p className="text-ink">{h.description}</p>
                <p className="mt-1 text-xs text-ink-soft">{timeAgo(h.createdAt)}{h.latitude != null ? ' · pinned' : ''}{h.publicNote ? ` · note: ${h.publicNote}` : ''}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setReview({ h, status: h.status === 'open' ? 'verified' : h.status, note: h.publicNote ?? '' })}>Review</Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={Boolean(review)} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent title="Review hazard">
          {review && (
            <div className="space-y-3">
              <p className="text-sm">{review.h.description}</p>
              <Field id="h-st" label="Status"><Select value={review.status} onChange={(e) => setReview({ ...review, status: e.target.value })}>{HAZARD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
              <Field id="h-note" label="Public note (shown on the map)"><Textarea rows={2} maxLength={300} value={review.note} onChange={(e) => setReview({ ...review, note: e.target.value })} /></Field>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReview(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Aggregate heatmap preview (exactly what students see — k-anonymous cells only). */
function Heatmap() {
  const { data } = useApi<MapData>('/community/map');
  if (!data) return <Skeleton className="h-72" />;
  const pts = [...data.heatmap.cells.map((c) => [c.latitude, c.longitude]), ...data.places.map((p) => [p.latitude, p.longitude]), [data.center.latitude, data.center.longitude]];
  const lats = pts.map((p) => p[0]!); const lngs = pts.map((p) => p[1]!);
  const pad = 0.002;
  const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad, minLng = Math.min(...lngs) - pad, maxLng = Math.max(...lngs) + pad;
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng || 1)) * 600;
  const y = (lat: number) => (1 - (lat - minLat) / (maxLat - minLat || 1)) * 360;
  const max = Math.max(1, ...data.heatmap.cells.map((c) => c.count));
  return (
    <Card>
      <CardHeader title="Incident heatmap" description={`Reports with a map pin in the last ${data.heatmap.days} days, grouped into ~165 m cells. Cells with fewer than ${data.heatmap.minCount} reports are never shown, so no single report can be located.`} />
      <div className="p-5">
        {!data.heatmap.cells.length && <Alert tone="neutral" className="mb-3" icon={<Flame className="h-4 w-4" />}>No cell has reached the privacy threshold yet.</Alert>}
        <svg viewBox="0 0 600 360" className="w-full rounded-xl border border-line bg-brand-50/40" role="img" aria-label="Heatmap preview">
          {data.heatmap.cells.map((c, i) => <circle key={i} cx={x(c.longitude)} cy={y(c.latitude)} r={14 + 26 * (c.count / max)} fill="#dc2626" fillOpacity={0.15 + 0.45 * (c.count / max)} />)}
          {data.places.map((p) => <circle key={p.id} cx={x(p.longitude)} cy={y(p.latitude)} r={5} fill="#064e3b"><title>{p.name}</title></circle>)}
          <circle cx={x(data.center.longitude)} cy={y(data.center.latitude)} r={4} fill="none" stroke="#0d9488" strokeWidth={2}><title>Map centre</title></circle>
        </svg>
        <p className="mt-2 text-xs text-ink-soft">Red: heat cells · Dark green: campus places · Teal ring: map centre.</p>
      </div>
    </Card>
  );
}

function MapSettings() {
  const s = useSectionDraft('map');
  if (!s.draft) return <Skeleton className="h-48" />;
  const d = s.draft;
  return (
    <SectionCard title="Map & privacy threshold" dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="m-lat" label="Centre latitude"><Input type="number" step="0.0001" value={d.centerLatitude} onChange={(e) => s.setDraft({ ...d, centerLatitude: Number(e.target.value) })} /></Field>
        <Field id="m-lng" label="Centre longitude"><Input type="number" step="0.0001" value={d.centerLongitude} onChange={(e) => s.setDraft({ ...d, centerLongitude: Number(e.target.value) })} /></Field>
        <Field id="m-zoom" label="Zoom"><Input type="number" min={12} max={19} value={d.zoom} onChange={(e) => s.setDraft({ ...d, zoom: Number(e.target.value) })} /></Field>
        <Field id="m-k" label="Minimum reports per cell (k)" hint="At least 3. Higher = more privacy."><Input type="number" min={3} max={50} value={d.heatmapMinCount} onChange={(e) => s.setDraft({ ...d, heatmapMinCount: Number(e.target.value) })} /></Field>
        <Field id="m-days" label="Look-back (days)"><Input type="number" min={7} max={365} value={d.heatmapDays} onChange={(e) => s.setDraft({ ...d, heatmapDays: Number(e.target.value) })} /></Field>
      </div>
    </SectionCard>
  );
}

export default function SafetyIntelPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Safety intelligence" description="Campus places, hazard reports and the privacy-preserving incident heatmap used by the app's Safety Map." />
      <Tabs defaultValue="places">
        <TabsList><TabsTrigger value="places">Places</TabsTrigger><TabsTrigger value="hazards">Hazards</TabsTrigger><TabsTrigger value="heatmap">Heatmap</TabsTrigger></TabsList>
        <TabsContent value="places" className="mt-4 space-y-6"><Places /><MapSettings /></TabsContent>
        <TabsContent value="hazards" className="mt-4"><Hazards /></TabsContent>
        <TabsContent value="heatmap" className="mt-4"><Heatmap /></TabsContent>
      </Tabs>
    </div>
  );
}
