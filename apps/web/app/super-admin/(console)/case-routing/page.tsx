'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { CATEGORY_INFO, INCIDENT_CATEGORIES, PRIORITIES, type IncidentCategory } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Button, Card, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';
import { Field, SwitchRow } from '@/components/ui/primitives';

interface Rule { id: string; category: IncidentCategory; committeeId: string; defaultPriority: string; escalateAfterHours: number; escalateToCommitteeId: string | null }
interface Data { rules: Rule[]; committees: { id: string; name: string; type: string }[] }
type Row = { committeeId: string; defaultPriority: string; escalateAfterHours: number; escalateToCommitteeId: string };

function IncidentPolicy() {
  const s = useSectionDraft('incidents');
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Reporting policy" description="Deadlines and anonymous reporting rules." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <SwitchRow id="anon" label="Allow anonymous reports" description="Reporter identity is stored as a keyed hash; committees cannot see who filed." checked={d.anonymousReportingEnabled} onCheckedChange={(v) => s.setDraft({ ...d, anonymousReportingEnabled: v })} />
      {d.anonymousReportingEnabled && (
        <fieldset className="mt-3"><legend className="mb-2 text-sm font-medium">Categories that allow anonymity</legend>
          <div className="grid gap-1 sm:grid-cols-2">{INCIDENT_CATEGORIES.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={d.anonymousCategories.includes(c)} onChange={(e) => s.setDraft({ ...d, anonymousCategories: e.target.checked ? [...d.anonymousCategories, c] : d.anonymousCategories.filter((x) => x !== c) })} /> {CATEGORY_INFO[c].label}</label>)}</div>
        </fieldset>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id="ack" label="Default acknowledge deadline (hours)"><Input type="number" min={1} value={d.acknowledgeWithinHours} onChange={(e) => s.setDraft({ ...d, acknowledgeWithinHours: Number(e.target.value) })} /></Field>
        <Field id="res" label="Default resolution target (days)"><Input type="number" min={1} value={d.resolveWithinDays} onChange={(e) => s.setDraft({ ...d, resolveWithinDays: Number(e.target.value) })} /></Field>
        <Field id="evmb" label="Evidence file limit (MB)"><Input type="number" min={1} max={50} value={d.evidenceMaxMb} onChange={(e) => s.setDraft({ ...d, evidenceMaxMb: Number(e.target.value) })} /></Field>
        <Field id="evn" label="Evidence files per report"><Input type="number" min={1} max={10} value={d.evidenceMaxFiles} onChange={(e) => s.setDraft({ ...d, evidenceMaxFiles: Number(e.target.value) })} /></Field>
      </div>
    </SectionCard>
  );
}

export default function CaseRoutingPage() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<Data>('/super-admin/case-routing');
  const [rows, setRows] = React.useState<Record<string, Row>>({});
  const [saving, setSaving] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!data) return;
    const next: Record<string, Row> = {};
    for (const c of INCIDENT_CATEGORIES) {
      const r = data.rules.find((x) => x.category === c);
      next[c] = { committeeId: r?.committeeId ?? '', defaultPriority: r?.defaultPriority ?? 'normal', escalateAfterHours: r?.escalateAfterHours ?? 48, escalateToCommitteeId: r?.escalateToCommitteeId ?? '' };
    }
    setRows(next);
  }, [data]);

  async function save(category: IncidentCategory) {
    const r = rows[category];
    if (!r?.committeeId) { toast.error('Choose a committee first.'); return; }
    setSaving(category);
    try {
      const res = await run(() => api.put('/super-admin/case-routing', { category, ...r, escalateToCommitteeId: r.escalateToCommitteeId || null }));
      if (res !== undefined) { toast.success(`Routing for ${CATEGORY_INFO[category].label} saved`); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  }

  const unrouted = data ? INCIDENT_CATEGORIES.filter((c) => !data.rules.some((r) => r.category === c)) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Case routing" description="Which committee receives each category of report, and when unacknowledged cases escalate." />
      {unrouted.length > 0 && <Alert tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>{unrouted.length} categor{unrouted.length === 1 ? 'y has' : 'ies have'} no rule. Those reports wait in the admin triage queue until someone routes them manually.</Alert>}
      {!data ? <Skeleton className="h-96" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft"><tr><th className="px-4 py-3">Category</th><th className="px-4 py-3">Committee</th><th className="px-4 py-3">Default priority</th><th className="px-4 py-3">Escalate after (h)</th><th className="px-4 py-3">Escalate to</th><th className="px-4 py-3" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {INCIDENT_CATEGORIES.map((c) => {
                const r = rows[c];
                if (!r) return null;
                const set = (patch: Partial<Row>) => setRows({ ...rows, [c]: { ...r, ...patch } });
                return (
                  <tr key={c}>
                    <td className="px-4 py-2 font-medium">{CATEGORY_INFO[c].label}</td>
                    <td className="px-4 py-2"><Select className="h-9" value={r.committeeId} onChange={(e) => set({ committeeId: e.target.value })} aria-label={`Committee for ${CATEGORY_INFO[c].label}`}><option value="">— Unrouted —</option>{data.committees.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></td>
                    <td className="px-4 py-2"><Select className="h-9" value={r.defaultPriority} onChange={(e) => set({ defaultPriority: e.target.value })} aria-label="Default priority">{PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></td>
                    <td className="px-4 py-2"><Input className="h-9 w-24" type="number" min={1} value={r.escalateAfterHours} onChange={(e) => set({ escalateAfterHours: Number(e.target.value) })} aria-label="Escalate after hours" /></td>
                    <td className="px-4 py-2"><Select className="h-9" value={r.escalateToCommitteeId} onChange={(e) => set({ escalateToCommitteeId: e.target.value })} aria-label="Escalate to"><option value="">Notify administrators</option>{data.committees.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select></td>
                    <td className="px-4 py-2 text-right"><Button size="sm" variant="outline" loading={saving === c} onClick={() => save(c)}>Save</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      <IncidentPolicy />
    </div>
  );
}
