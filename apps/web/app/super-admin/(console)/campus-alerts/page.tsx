'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { BellRing, Send } from 'lucide-react';
import { ALERT_SEVERITIES, DEPARTMENTS } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';

interface CampusAlert { id: string; title: string; body: string; severity: string; requestCheckIn: boolean; createdAt: string; expiresAt: string | null; checkIns: { safe: number; need_help: number } }

const tone = (s: string) => (s === 'emergency' ? 'rose' : s === 'warning' ? 'amber' : s === 'advisory' ? 'brand' : 'neutral') as 'rose' | 'amber' | 'brand' | 'neutral';

export default function CampusAlertsPage() {
  const { data, error, mutate } = useApi<CampusAlert[]>('/admin/campus-alerts', { refreshInterval: 30000 });
  const [v, setV] = React.useState({ title: '', body: '', severity: 'advisory', all: true, hostels: '', departments: [] as string[], requestCheckIn: false, expiresAt: '' });
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function publish() {
    setBusy(true);
    try {
      const r = await api.post<{ recipients: number }>('/admin/campus-alerts', {
        title: v.title, body: v.body, severity: v.severity, requestCheckIn: v.requestCheckIn, expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
        audience: { all: v.all, hostels: v.all ? [] : v.hostels.split(',').map((h) => h.trim()).filter(Boolean), departments: v.all ? [] : v.departments },
      });
      toast.success(`Alert sent to ${r.recipients} student(s)`);
      setConfirm(false);
      setV({ ...v, title: '', body: '', requestCheckIn: false });
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function expire(id: string) {
    try {
      await api.delete(`/admin/campus-alerts/${id}`);
      toast.success('Alert ended');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const active = (a: CampusAlert) => !a.expiresAt || new Date(a.expiresAt) > new Date();

  return (
    <div className="space-y-6">
      <PageHeader title="Campus alerts" description="Safety notices pushed to students’ dashboards and notifications. Optionally ask students to check in as safe." />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="New alert" />
          <div className="space-y-4 p-5">
            <Field id="al-title" label="Title" required><Input value={v.title} maxLength={140} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field id="al-body" label="Message" required hint="Say what happened, where, and what students should do."><Textarea rows={5} value={v.body} maxLength={2000} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="al-sev" label="Severity"><Select value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })}>{ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
              <Field id="al-exp" label="Ends at (optional)"><Input type="datetime-local" value={v.expiresAt} onChange={(e) => setV({ ...v, expiresAt: e.target.value })} /></Field>
            </div>
            <SwitchRow id="al-all" label="All students" checked={v.all} onCheckedChange={(x) => setV({ ...v, all: x })} />
            {!v.all && (
              <>
                <Field id="al-hostels" label="Hostels" hint="Comma-separated names exactly as on student profiles."><Input value={v.hostels} onChange={(e) => setV({ ...v, hostels: e.target.value })} /></Field>
                <fieldset><legend className="mb-2 text-sm font-medium">Departments</legend><div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-3">{DEPARTMENTS.map((d) => <label key={d} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={v.departments.includes(d)} onChange={(e) => setV({ ...v, departments: e.target.checked ? [...v.departments, d] : v.departments.filter((x) => x !== d) })} /> {d}</label>)}</div></fieldset>
              </>
            )}
            <SwitchRow id="al-check" label="Request safety check-in" description="Students can tap “I’m safe” or “I need help”. Need-help responses notify security." checked={v.requestCheckIn} onCheckedChange={(x) => setV({ ...v, requestCheckIn: x })} />
            <Button className="w-full" disabled={v.title.trim().length < 3 || v.body.trim().length < 3} onClick={() => setConfirm(true)}><Send className="h-4 w-4" /> Review & send</Button>
          </div>
        </Card>
        <div className="space-y-3 lg:col-span-3">
          {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
          {!data && !error && <Skeleton className="h-48" />}
          {data && !data.length && <Card><EmptyState icon={<BellRing className="h-6 w-6" />} title="No alerts sent" /></Card>}
          {data?.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div><div className="flex flex-wrap items-center gap-2"><Badge tone={tone(a.severity)}>{humanize(a.severity)}</Badge>{active(a) ? <Badge tone="brand">Active</Badge> : <Badge>Ended</Badge>}</div><h3 className="mt-2 font-semibold">{a.title}</h3></div>
                {active(a) && <Button size="sm" variant="outline" onClick={() => expire(a.id)}>End alert</Button>}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{a.body}</p>
              <p className="mt-2 text-xs text-ink-soft">Sent {formatDateTime(a.createdAt)}</p>
              {a.requestCheckIn && <div className="mt-3 flex gap-3 text-sm"><Badge tone="brand">{a.checkIns.safe} safe</Badge><Badge tone="rose">{a.checkIns.need_help} need help</Badge></div>}
            </Card>
          ))}
        </div>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Send this alert now?" description="Students are notified immediately. This cannot be unsent, but you can end it." confirmLabel="Send alert" loading={busy} onConfirm={publish}>
        {v.severity === 'emergency' && <Alert tone="rose">Emergency alerts should be reserved for immediate threats to safety.</Alert>}
      </ConfirmDialog>
    </div>
  );
}
