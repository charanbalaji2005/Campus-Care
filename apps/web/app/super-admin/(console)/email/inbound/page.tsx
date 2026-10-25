'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Info } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Skeleton, SwitchRow } from '@/components/ui/primitives';
import { EmailTabs } from '@/components/super-admin/email-tabs';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

interface Inbound {
  config: { enabled: boolean; allowCaseCreation: boolean; allowReplies: boolean; webhookUrl: string; secretConfigured: boolean; mailbox: string | null };
  items: { id: string; provider: string; from: string; to: string; subject: string; outcome: string; reason: string | null; incidentId: string | null; createdAt: string }[];
  total: number;
}

function InboundSettings() {
  const s = useSectionDraft('inboundEmail');
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Inbound email" description="Lets students reply to case emails, or report by email, through a signed webhook from your mail provider." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <SwitchRow id="in-on" label="Accept inbound email" checked={d.enabled} onCheckedChange={(v) => s.setDraft({ ...d, enabled: v })} />
      <SwitchRow id="in-reply" label="Link replies to existing cases" description="Only from the reporter's verified address and with a valid reply token." checked={d.allowReplies} onCheckedChange={(v) => s.setDraft({ ...d, allowReplies: v })} />
      <SwitchRow id="in-new" label="Create new cases from email" description="Only from registered, verified student addresses. Anything else is quarantined." checked={d.allowCaseCreation} onCheckedChange={(v) => s.setDraft({ ...d, allowCaseCreation: v })} />
    </SectionCard>
  );
}

export default function InboundEmailPage() {
  const { data } = useApi<Inbound>('/super-admin/email/inbound?limit=50', { refreshInterval: 30000 });
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Email" />
      <EmailTabs />
      <div className="space-y-6">
        {!data ? <Skeleton className="h-40" /> : (
          <Card>
            <CardHeader title="Webhook" />
            <div className="space-y-3 px-5 pb-5">
              <Field id="wh" label="Webhook URL (configure in your inbound mail provider)">
                <div className="flex items-center gap-2"><code className="flex-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">{data.config.webhookUrl}</code><Button size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(data.config.webhookUrl); toast.success('Copied'); }} aria-label="Copy webhook URL"><Copy className="h-4 w-4" /></Button></div>
              </Field>
              <p className="text-sm">Signing secret: {data.config.secretConfigured ? <Badge tone="brand">Configured</Badge> : <Badge tone="rose">Missing — set INBOUND_EMAIL_WEBHOOK_SECRET</Badge>}</p>
              <p className="text-sm">Mailbox: {data.config.mailbox ?? <span className="text-ink-soft">not set (INBOUND_EMAIL_ADDRESS)</span>}</p>
              <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>Requests without a valid HMAC signature and fresh timestamp are rejected. Sender headers can be forged, so inbound email never authenticates a user on its own.</Alert>
            </div>
          </Card>
        )}
        <InboundSettings />
        <Card>
          <CardHeader title="Recent inbound messages" description="Sender addresses are masked. Bodies are not shown here." />
          {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : !data.items.length ? <EmptyState title="Nothing received" /> : (
            <ul className="divide-y divide-slate-100">
              {data.items.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">{e.subject || '(no subject)'}</p><p className="text-xs text-ink-soft">{e.from} → {e.to} · {formatDateTime(e.createdAt)}{e.reason ? ` · ${e.reason}` : ''}</p></div>
                  <Badge tone={e.outcome === 'quarantined' || e.outcome === 'rejected' ? 'amber' : 'brand'}>{humanize(e.outcome)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
