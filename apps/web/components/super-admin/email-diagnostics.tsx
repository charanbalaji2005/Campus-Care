'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, Skeleton } from '@/components/ui/primitives';

interface Diagnostics {
  provider: { type: string; service: string | null; from: string; problem: string | null; login: { ok: boolean; error: string | null } };
  readiness: { ready: true } | { ready: false; reason: string; message: string };
  worker: { runningInThisInstance: boolean; startedAt: string | null; secondsSinceLastTick: number | null; lastJobDoneAt: string | null; lastJobError: string | null; slowOrFailingTasks: { name: string; runningForSeconds: number | null; lastError: string | null }[] };
  queue: { pendingEmailJobs: number; oldestPendingSeconds: number | null; oldestPendingLastError: string | null; failedEmailJobs24h: number };
  lastAcceptedAt: string | null;
  recentAccountEmails: { id: string; template: string; to: string; status: string; attempts: number; providerResponse: string | null; lastError: string | null; bounceReason: string | null; createdAt: string; sentAt: string | null }[];
  bounces: { enabled: boolean; supported: boolean; lastRunAt: string | null; notices: number; matched: number; error: string | null };
  deployment: Record<string, string | boolean | null>;
}

/** Status words as they should be read: "accepted" is the provider's hand-off, not delivery. */
export const DELIVERY_STATUS: Record<string, { label: string; tone: 'brand' | 'rose' | 'amber' | 'neutral' }> = {
  queued: { label: 'Queued', tone: 'amber' },
  sending: { label: 'Sending', tone: 'amber' },
  accepted_by_provider: { label: 'Accepted by provider', tone: 'brand' },
  sent: { label: 'Accepted by provider', tone: 'brand' },
  delivered: { label: 'Delivered', tone: 'brand' },
  bounced: { label: 'Bounced', tone: 'rose' },
  rejected: { label: 'Rejected', tone: 'rose' },
  failed: { label: 'Failed', tone: 'rose' },
};

function Row({ label, ok, children }: { label: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      {ok === null ? <span className="mt-0.5 h-4 w-4" /> : ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="text-xs text-ink-soft">{children}</div>
      </div>
    </div>
  );
}

/** Why an account email did or did not arrive: provider, queue, worker, bounces and recent attempts. */
export function EmailDiagnostics() {
  const [checkBounces, setCheckBounces] = React.useState(false);
  const { data, error, mutate, isLoading } = useApi<Diagnostics>(`/super-admin/email/diagnostics${checkBounces ? '?checkBounces=1' : ''}`, { refreshInterval: 30000 });
  if (error) return <Alert tone="rose">Diagnostics unavailable: {error.message}</Alert>;
  if (!data) return <Skeleton className="h-64" />;
  const w = data.worker;
  const stalled = w.runningInThisInstance && (w.secondsSinceLastTick ?? 0) > 30;
  const backlog = (data.queue.oldestPendingSeconds ?? 0) > 120;
  return (
    <Card>
      <CardHeader
        title="Delivery diagnostics"
        description="Live state of this API instance. Accepted by provider means Gmail took the message; a missing mailbox shows up later as Bounced."
        action={<Button size="sm" variant="outline" loading={isLoading} onClick={() => { setCheckBounces(true); void mutate(); }}><RefreshCw className="h-4 w-4" /> Check bounces now</Button>}
      />
      <div className="divide-y divide-slate-100 px-5 pb-5">
        <Row label="Mail service sign-in" ok={data.provider.type !== 'nodemailer' ? null : data.provider.login.ok}>
          {data.provider.type} {data.provider.service ? `· ${data.provider.service}` : ''} · from {data.provider.from}
          {!data.provider.login.ok && data.provider.login.error && <span className="block text-rose-700">{data.provider.login.error}</span>}
          {data.provider.problem && <span className="block text-rose-700">{data.provider.problem}</span>}
        </Row>
        <Row label="Account emails (verification, password reset)" ok={data.readiness.ready}>
          {data.readiness.ready ? 'Accepting requests.' : <span className="text-rose-700">{data.readiness.message}</span>}
        </Row>
        <Row label="Background sender (job worker)" ok={w.runningInThisInstance ? !stalled : null}>
          {w.runningInThisInstance
            ? <>Last tick {w.secondsSinceLastTick ?? '—'}s ago · started {w.startedAt ? formatDateTime(w.startedAt) : '—'} · last job finished {w.lastJobDoneAt ? formatDateTime(w.lastJobDoneAt) : 'none yet'}</>
            : 'Not running in this instance (RUN_WORKER=false). Another instance must run it, or nothing is sent.'}
          {w.lastJobError && <span className="block">Last job error: {w.lastJobError}</span>}
          {w.slowOrFailingTasks.map((t) => <span key={t.name} className="block text-amber-700">{humanize(t.name)}: {t.runningForSeconds != null ? `running for ${t.runningForSeconds}s` : ''} {t.lastError ?? ''}</span>)}
        </Row>
        <Row label="Email queue" ok={!backlog}>
          {data.queue.pendingEmailJobs} waiting{data.queue.oldestPendingSeconds != null ? ` · oldest ${data.queue.oldestPendingSeconds}s` : ''} · {data.queue.failedEmailJobs24h} gave up in 24 h
          {data.queue.oldestPendingLastError && <span className="block">Oldest: {data.queue.oldestPendingLastError}</span>}
          {data.lastAcceptedAt && <span className="block">Last email accepted by the provider: {formatDateTime(data.lastAcceptedAt)}</span>}
        </Row>
        <Row label="Bounce tracking" ok={!data.bounces.enabled || !data.bounces.supported ? null : !data.bounces.error}>
          {!data.bounces.supported ? 'Available for Gmail / Google Workspace mailboxes only.'
            : !data.bounces.enabled ? 'Off (EMAIL_BOUNCE_TRACKING=false).'
            : data.bounces.lastRunAt ? <>Checked {formatDateTime(data.bounces.lastRunAt)}: {data.bounces.notices} failure notice(s), {data.bounces.matched} matched to deliveries. Reads only mailer-daemon notices, read-only.</> : 'Not checked yet (every 10 minutes).'}
          {data.bounces.error && <span className="block text-rose-700">{data.bounces.error}</span>}
        </Row>
      </div>
      <div className="border-t border-slate-100 px-5 py-4">
        <p className="mb-2 text-sm font-medium">Recent verification and password-reset emails</p>
        {!data.recentAccountEmails.length ? <p className="text-xs text-ink-soft">None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="text-left text-ink-soft"><tr><th className="py-1.5 pr-3">Requested</th><th className="pr-3">Type</th><th className="pr-3">To</th><th className="pr-3">Status</th><th>Provider reply / error</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentAccountEmails.map((d) => {
                  const st = DELIVERY_STATUS[d.status] ?? { label: d.status, tone: 'neutral' as const };
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap py-1.5 pr-3">{formatDateTime(d.createdAt)}</td>
                      <td className="pr-3">{d.template.startsWith('verify_email') ? 'Verification' : 'Password reset'}{d.template.endsWith('_code') ? ' (code)' : ' (link)'}</td>
                      <td className="pr-3 font-mono">{d.to}</td>
                      <td className="pr-3"><Badge tone={st.tone}>{st.label}</Badge>{d.attempts > 1 ? ` ×${d.attempts}` : ''}</td>
                      <td className={d.bounceReason || d.lastError ? 'text-rose-700' : 'text-ink-soft'}>{d.bounceReason ?? d.lastError ?? d.providerResponse ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <details className="border-t border-slate-100 px-5 py-3 text-xs text-ink-soft">
        <summary className="cursor-pointer font-medium text-ink">Server settings (no secrets)</summary>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          {Object.entries(data.deployment).map(([k, v]) => <React.Fragment key={k}><dt className="font-mono">{k}</dt><dd>{String(v ?? '—')}</dd></React.Fragment>)}
        </dl>
      </details>
    </Card>
  );
}
