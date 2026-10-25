'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, SwitchRow } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

function SosSettings() {
  const s = useSectionDraft('sos');
  const [confirmOff, setConfirmOff] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  if (!s.draft) return <Skeleton className="h-64" />;
  const d = s.draft;
  const disabling = !d.enabled;
  return (
    <>
      <SectionCard title="SOS emergency alerts" description="The 10-second countdown gives students time to cancel accidental presses." dirty={s.dirty} saving={s.saving} onSave={() => (disabling ? setConfirmOff(true) : void s.save())} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
        <SwitchRow id="sos-on" label="SOS enabled" description="Turning this off removes the SOS button for every student." checked={d.enabled} onCheckedChange={(v) => s.setDraft({ ...d, enabled: v })} />
        {disabling && <Alert tone="rose" icon={<AlertTriangle className="h-4 w-4" />} className="my-3">Students will not be able to raise an SOS. Make sure emergency phone numbers are prominent in the contacts directory.</Alert>}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field id="sos-cd" label="Countdown (seconds)" hint="3–30. Default 10."><Input type="number" min={3} max={30} value={d.countdownSeconds} onChange={(e) => s.setDraft({ ...d, countdownSeconds: Number(e.target.value) })} /></Field>
          <Field id="sos-esc1" label="Escalate to backup recipients after (seconds)" hint="If no responder acknowledges. Default 120."><Input type="number" min={30} max={1800} value={d.escalateAfterSeconds} onChange={(e) => s.setDraft({ ...d, escalateAfterSeconds: Number(e.target.value) })} /></Field>
          <Field id="sos-esc2" label="Escalate to administrators after (seconds)" hint="Second level. Must be later than the first. Default 300."><Input type="number" min={60} max={3600} value={d.secondEscalationAfterSeconds} onChange={(e) => s.setDraft({ ...d, secondEscalationAfterSeconds: Number(e.target.value) })} /></Field>
        </div>
        {d.secondEscalationAfterSeconds <= d.escalateAfterSeconds && <Alert tone="amber" className="my-3">The second escalation should happen after the first.</Alert>}
        <SwitchRow id="sos-cancel" label="Allow cancel after sending" description="Students can mark an alert as a false alarm; responders are notified." checked={d.allowCancelAfterSend} onCheckedChange={(v) => s.setDraft({ ...d, allowCancelAfterSend: v })} />
        <SwitchRow id="sos-email" label="Email emergency recipients" description="In addition to realtime and in-app alerts to on-duty security officers." checked={d.emailRecipients} onCheckedChange={(v) => s.setDraft({ ...d, emailRecipients: v })} />
      </SectionCard>
      <ConfirmDialog open={confirmOff} onOpenChange={(o) => { setConfirmOff(o); if (!o) setTyped(''); }} title="Turn off SOS for everyone?" description="Type DISABLE SOS to confirm. This is recorded in the audit log." destructive confirmLabel="Turn off SOS" loading={s.saving} onConfirm={async () => { if (typed !== 'DISABLE SOS') { toast.error('Type DISABLE SOS exactly.'); return; } if (await s.save({ confirm: typed })) { setConfirmOff(false); setTyped(''); } }}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DISABLE SOS" aria-label="Confirmation text" />
      </ConfirmDialog>
    </>
  );
}

function SafeWalkSettings() {
  const sw = useSectionDraft('safeWalk');
  const loc = useSectionDraft('locationSharing');
  if (!sw.draft || !loc.draft) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <SectionCard title="Safe Walk" dirty={sw.dirty} saving={sw.saving} onSave={() => void sw.save()} onDiscard={sw.discard} onDefaults={sw.resetToDefaults}>
        <SwitchRow id="sw-on" label="Safe Walk enabled" checked={sw.draft.enabled} onCheckedChange={(v) => sw.setDraft({ ...sw.draft!, enabled: v })} />
        <Field id="sw-grace" label="Grace period after expected arrival (minutes)" className="mt-3"><Input type="number" min={1} max={60} value={sw.draft.graceMinutes} onChange={(e) => sw.setDraft({ ...sw.draft!, graceMinutes: Number(e.target.value) })} /></Field>
        <SwitchRow id="sw-sec" label="Alert security when overdue" description="Trusted contacts are always notified first." checked={sw.draft.notifySecurityOnEscalation} onCheckedChange={(v) => sw.setDraft({ ...sw.draft!, notifySecurityOnEscalation: v })} />
      </SectionCard>
      <SectionCard title="Live location sharing" dirty={loc.dirty} saving={loc.saving} onSave={() => void loc.save()} onDiscard={loc.discard} onDefaults={loc.resetToDefaults}>
        <SwitchRow id="loc-on" label="Location sharing enabled" description="Always opt-in, time-limited and stoppable by the student." checked={loc.draft.enabled} onCheckedChange={(v) => loc.setDraft({ ...loc.draft!, enabled: v })} />
        <Field id="loc-max" label="Maximum share duration (minutes)" className="mt-3"><Input type="number" min={5} max={480} value={loc.draft.maxDurationMinutes} onChange={(e) => loc.setDraft({ ...loc.draft!, maxDurationMinutes: Number(e.target.value) })} /></Field>
        <Field id="loc-ret" label="Delete location points after (hours)" className="mt-3"><Input type="number" min={1} max={720} value={loc.draft.retentionHours} onChange={(e) => loc.setDraft({ ...loc.draft!, retentionHours: Number(e.target.value) })} /></Field>
      </SectionCard>
    </div>
  );
}

interface Recipients { recipients: { id: string; name: string; type: 'user' | 'email'; tier: 'primary' | 'backup'; userId: string | null; email: string | null; active: boolean }[]; automaticSecurityOfficers: { id: string; name: string; email: string }[] }

function EmergencyRecipients() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<Recipients>('/super-admin/emergency-recipients');
  const { data: staff } = useApi<{ id: string; name: string; role: string }[]>('/admin/staff');
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: '', type: 'email' as 'user' | 'email', tier: 'primary' as 'primary' | 'backup', userId: '', email: '' });
  const [busy, setBusy] = React.useState(false);

  async function add() {
    setBusy(true);
    try {
      const r = await run(() => api.post('/super-admin/emergency-recipients', { name: v.name, type: v.type, tier: v.tier, userId: v.type === 'user' ? v.userId : null, email: v.type === 'email' ? v.email : '' }));
      if (r !== undefined) { toast.success('Recipient added'); setOpen(false); setV({ name: '', type: 'email', tier: 'primary', userId: '', email: '' }); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    try {
      const r = await run(() => api.delete(`/super-admin/emergency-recipients/${id}`));
      if (r !== undefined) void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader title="Who receives SOS alerts" description="Every active security officer is alerted automatically. Add a control room mailbox or additional staff here." action={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add</Button>} />
      {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : (
        <div className="space-y-4 px-5 pb-5">
          <div>
            <p className="mb-2 text-sm font-medium">Automatic — security officers ({data.automaticSecurityOfficers.length})</p>
            {!data.automaticSecurityOfficers.length ? <Alert tone="rose" icon={<AlertTriangle className="h-4 w-4" />}>No active security officer accounts. SOS alerts will only reach the recipients below. Invite security staff from Users.</Alert> : (
              <div className="flex flex-wrap gap-2">{data.automaticSecurityOfficers.map((o) => <Badge key={o.id} tone="brand">{o.name}</Badge>)}</div>
            )}
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Additional recipients</p>
            {!data.recipients.length ? <EmptyState title="None" /> : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {data.recipients.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{r.name} <span className="text-xs text-ink-soft">· {r.type === 'email' ? r.email : 'staff account'}</span> <Badge tone={r.tier === 'backup' ? 'amber' : 'brand'}>{r.tier === 'backup' ? 'Backup (escalation)' : 'Primary'}</Badge></span><Button variant="ghost" size="icon" onClick={() => remove(r.id)} aria-label={`Remove ${r.name}`}><Trash2 className="h-4 w-4" /></Button></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Add SOS recipient">
          <div className="space-y-4">
            <Field id="r-name" label="Label" required><Input value={v.name} placeholder="Main gate control room" onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field id="r-tier" label="When to alert"><Select value={v.tier} onChange={(e) => setV({ ...v, tier: e.target.value as 'primary' | 'backup' })}><option value="primary">Primary — every SOS immediately</option><option value="backup">Backup — only when an SOS is not acknowledged in time</option></Select></Field>
            <Field id="r-type" label="Type"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as 'user' | 'email' })}><option value="email">Email address</option><option value="user">Staff account</option></Select></Field>
            {v.type === 'email' ? <Field id="r-email" label="Email" required><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field> : <Field id="r-user" label="Staff member" required><Select value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })}><option value="">Choose…</option>{staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={add}>Add</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function SosConfigPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="SOS & safety" description="Emergency alerting, escalation, Safe Walk and live location sharing. Changes reach the app on next launch or resume." />
      <Alert tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>CampusCare does not contact police or ambulance services automatically. SMS delivery is not configured. Students are always shown national emergency numbers alongside SOS.</Alert>
      <SosSettings />
      <EmergencyRecipients />
      <SafeWalkSettings />
    </div>
  );
}
