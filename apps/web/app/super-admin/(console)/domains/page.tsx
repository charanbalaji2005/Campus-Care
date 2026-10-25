'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';
import { SwitchRow } from '@/components/ui/primitives';

interface Domain { id: string; domain: string; purpose: 'students' | 'staff' | 'both'; status: 'pending_verification' | 'active' | 'disabled'; verifiedAt: string | null; lastCheckedAt: string | null; note: string | null; txtRecord: string; users: number }

function RegistrationPolicy() {
  const s = useSectionDraft('registration');
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Registration policy" dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <SwitchRow id="reg-open" label="Student self-registration open" checked={d.studentRegistrationOpen} onCheckedChange={(v) => s.setDraft({ ...d, studentRegistrationOpen: v })} />
      <SwitchRow id="reg-domain" label="Only approved domains" description="Registration and Google sign-in require an address on an active domain below." checked={d.restrictToApprovedDomains} onCheckedChange={(v) => s.setDraft({ ...d, restrictToApprovedDomains: v })} />
      <SwitchRow id="reg-verify" label="Require email verification" description="Strongly recommended. Unverified accounts cannot sign in." checked={d.requireEmailVerification} onCheckedChange={(v) => s.setDraft({ ...d, requireEmailVerification: v })} />
    </SectionCard>
  );
}

export default function DomainsPage() {
  const run = useSensitiveAction();
  const { data, error, mutate } = useApi<Domain[]>('/super-admin/domains');
  const [adding, setAdding] = React.useState(false);
  const [v, setV] = React.useState({ domain: '', purpose: 'both', note: '' });
  const [del, setDel] = React.useState<Domain | null>(null);
  const [manual, setManual] = React.useState<Domain | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(id: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(id);
    try {
      const r = await run(fn);
      if (r !== undefined) { toast.success(msg); void mutate(); }
      return r !== undefined;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Approved email domains" description="Only addresses on active domains can register or be invited. Verify ownership with a DNS TXT record." actions={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add domain</Button>} />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <Skeleton className="h-48" />}
      {data && !data.length && <Card><EmptyState icon={<Globe className="h-6 w-6" />} title="No domains yet" description="Add your university's student and staff email domains. Until one is active, nobody can register when domain restriction is on." /></Card>}
      <div className="space-y-3">
        {data?.map((d) => (
          <Card key={d.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2"><h2 className="font-mono font-semibold">@{d.domain}</h2><Badge tone={d.status === 'active' ? 'brand' : d.status === 'pending_verification' ? 'amber' : 'neutral'}>{humanize(d.status)}</Badge><Badge>{d.purpose === 'both' ? 'Students & staff' : humanize(d.purpose)}</Badge></div>
                <p className="mt-1 text-xs text-ink-soft">{d.users} account(s){d.verifiedAt ? ` · verified ${formatDateTime(d.verifiedAt)}` : ''}{d.lastCheckedAt ? ` · last checked ${formatDateTime(d.lastCheckedAt)}` : ''}</p>
                {d.note && <p className="mt-1 text-sm text-ink-soft">{d.note}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={d.purpose} onChange={(e) => act(d.id, () => api.patch(`/super-admin/domains/${d.id}`, { purpose: e.target.value }), 'Purpose updated')} className="h-9 w-40 text-sm" aria-label="Purpose"><option value="students">Students</option><option value="staff">Staff</option><option value="both">Students & staff</option></Select>
                {d.status === 'active' && <Button size="sm" variant="outline" loading={busy === d.id} onClick={() => act(d.id, () => api.patch(`/super-admin/domains/${d.id}`, { status: 'disabled' }), 'Domain disabled')}>Disable</Button>}
                {d.status === 'disabled' && d.verifiedAt && <Button size="sm" variant="outline" loading={busy === d.id} onClick={() => act(d.id, () => api.patch(`/super-admin/domains/${d.id}`, { status: 'active' }), 'Domain activated')}>Activate</Button>}
                <Button size="sm" variant="ghost" onClick={() => setDel(d)} aria-label={`Remove ${d.domain}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            {d.status === 'pending_verification' && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-sm font-medium">Add this TXT record to <span className="font-mono">{d.domain}</span></p>
                <div className="mt-2 flex items-center gap-2"><code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200">{d.txtRecord}</code><Button size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(d.txtRecord); toast.success('Copied'); }} aria-label="Copy TXT record"><Copy className="h-4 w-4" /></Button></div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={busy === d.id} onClick={() => act(d.id, () => api.post(`/super-admin/domains/${d.id}/verify`, {}), 'Domain verified and active')}><RefreshCw className="h-4 w-4" /> Check DNS now</Button>
                  <Button size="sm" variant="ghost" onClick={() => setManual(d)}>Approve manually…</Button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
      <RegistrationPolicy />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add a domain" description="It starts as pending until ownership is verified.">
          <div className="space-y-4">
            <Field id="d-domain" label="Domain" required hint="Without @, e.g. srmap.edu.in"><Input value={v.domain} onChange={(e) => setV({ ...v, domain: e.target.value.replace(/^@/, '') })} /></Field>
            <Field id="d-purpose" label="Used for"><Select value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}><option value="both">Students & staff</option><option value="students">Students only</option><option value="staff">Staff only</option></Select></Field>
            <Field id="d-note" label="Note"><Textarea value={v.note} maxLength={300} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button loading={busy === 'new'} onClick={async () => { if (await act('new', () => api.post('/super-admin/domains', { ...v, note: v.note || undefined }), 'Domain added')) { setAdding(false); setV({ domain: '', purpose: 'both', note: '' }); } }}>Add domain</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={!!manual} onOpenChange={(o) => !o && setManual(null)} title={`Approve ${manual?.domain} without DNS proof?`} description="Only do this if you have confirmed ownership another way (for example, written confirmation from university IT). The approval is recorded in the audit log." confirmLabel="Approve manually" loading={busy === manual?.id} onConfirm={async () => { if (manual && (await act(manual.id, () => api.post(`/super-admin/domains/${manual.id}/verify`, { manual: true }), 'Domain approved'))) setManual(null); }}>
        <Alert tone="amber">Approving a domain you do not control lets anyone with an address there register.</Alert>
      </ConfirmDialog>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Remove ${del?.domain}?`} description={`${del?.users ?? 0} existing account(s) keep working, but no new registrations or invitations will be accepted for this domain.`} destructive confirmLabel="Remove" loading={busy === del?.id} onConfirm={async () => { if (del && (await act(del.id, () => api.delete(`/super-admin/domains/${del.id}`), 'Domain removed'))) setDel(null); }} />
    </div>
  );
}
