'use client';

import { Activity, AlertTriangle, Clock, Footprints, Siren, Smartphone, TrendingUp, XCircle } from 'lucide-react';
import { SOS_STATUS_LABELS } from '@campuscare/shared';
import { useApi, useUserEvents } from '@/lib/hooks';
import { formatTime, timeAgo } from '@/lib/utils';
import { Alert, Badge, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '@/components/ui/primitives';

interface LiveOps {
  activeAlerts: { id: string; alertNumber: string; status: keyof typeof SOS_STATUS_LABELS; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null; escalationLevel: number; locationShared: boolean; lastDeliveryError: string | null }[];
  metrics30d: { alerts: number; acknowledged: number; medianSecondsToAcknowledge: number | null; p90SecondsToAcknowledge: number | null; escalated: number; falseAlarms: number; cancelled: number };
  safeWalksNeedingAttention: number;
  app: { installsByVersion: { version: string | null; devices: number; pushEnabled: number }[]; pushConfigured: boolean };
  jobsFailed: number;
}

function secs(n: number | null) {
  if (n == null) return '—';
  return n < 90 ? `${n}s` : `${Math.round(n / 60)}m`;
}

/**
 * Live operations for the Super Admin: the health of emergency response, without student identities
 * or locations (those stay with Campus Security responders in the app).
 */
export default function LiveOpsPage() {
  const { data, error, mutate } = useApi<LiveOps>('/super-admin/live-ops', { refreshInterval: 15_000 });
  useUserEvents({ notification: () => void mutate() });

  if (error) return <ErrorState message={error.message} onRetry={() => void mutate()} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Live operations" description="Emergency response health, refreshed every 15 seconds. Student names and locations are visible only to responders in the app." />
      {!data ? <Skeleton className="h-96" /> : (
        <>
          {data.activeAlerts.some((a) => !a.acknowledgedAt) && (
            <Alert tone="rose" icon={<Siren className="h-4 w-4" />} title="Unacknowledged SOS">
              At least one SOS has not been acknowledged by a responder. Escalation runs automatically; check that security staff are on duty.
            </Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Active SOS" value={data.activeAlerts.length} icon={<Siren className="h-5 w-5" />} tone={data.activeAlerts.length ? 'rose' : 'brand'} />
            <StatCard label="Median time to acknowledge" value={secs(data.metrics30d.medianSecondsToAcknowledge)} hint={`p90 ${secs(data.metrics30d.p90SecondsToAcknowledge)} · last 30 days`} icon={<Clock className="h-5 w-5" />} />
            <StatCard label="Safe Walks needing attention" value={data.safeWalksNeedingAttention} icon={<Footprints className="h-5 w-5" />} tone={data.safeWalksNeedingAttention ? 'amber' : 'brand'} />
            <StatCard label="Failed background jobs" value={data.jobsFailed} icon={<XCircle className="h-5 w-5" />} tone={data.jobsFailed ? 'amber' : 'brand'} />
          </div>

          <Card>
            <CardHeader title="Active alerts" description="Alert numbers and response status only." />
            {!data.activeAlerts.length ? <EmptyState icon={<Activity className="h-6 w-6" />} title="No active SOS alerts" /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-ink-soft">
                    <tr><th className="px-4 py-2">Alert</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Raised</th><th className="px-4 py-2">Acknowledged</th><th className="px-4 py-2">Escalation</th><th className="px-4 py-2">Location</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.activeAlerts.map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-2.5 font-medium">{a.alertNumber}</td>
                        <td className="px-4 py-2.5"><Badge tone={a.acknowledgedAt ? 'brand' : 'rose'}>{SOS_STATUS_LABELS[a.status] ?? a.status}</Badge>{a.lastDeliveryError && <p className="mt-1 text-xs text-rose-700">{a.lastDeliveryError}</p>}</td>
                        <td className="px-4 py-2.5">{formatTime(a.createdAt)} <span className="text-xs text-ink-soft">({timeAgo(a.createdAt)})</span></td>
                        <td className="px-4 py-2.5">{a.acknowledgedAt ? `${formatTime(a.acknowledgedAt)} · ${a.acknowledgedBy ?? 'Responder'}` : <span className="font-semibold text-rose-700">Waiting</span>}</td>
                        <td className="px-4 py-2.5">{a.escalationLevel ? <Badge tone="amber"><TrendingUp className="h-3 w-3" /> Level {a.escalationLevel}</Badge> : '—'}</td>
                        <td className="px-4 py-2.5">{a.locationShared ? 'Shared' : <span className="text-amber-700">Unavailable</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Last 30 days" />
              <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
                {[
                  ['SOS raised', data.metrics30d.alerts],
                  ['Acknowledged', data.metrics30d.acknowledged],
                  ['Escalated', data.metrics30d.escalated],
                  ['Cancelled by student', data.metrics30d.cancelled],
                  ['False alarms', data.metrics30d.falseAlarms],
                ].map(([k, v]) => (
                  <div key={String(k)}><dt className="text-ink-soft">{k}</dt><dd className="tabular text-2xl font-bold text-ink-strong">{v}</dd></div>
                ))}
              </dl>
            </Card>
            <Card>
              <CardHeader title="Installed apps" description="Devices registered with the API, by app version." action={<Badge tone={data.app.pushConfigured ? 'brand' : 'amber'}>{data.app.pushConfigured ? 'Push configured' : 'Push not configured'}</Badge>} />
              {!data.app.installsByVersion.length ? <EmptyState icon={<Smartphone className="h-6 w-6" />} title="No devices registered yet" /> : (
                <ul className="divide-y divide-line px-5 pb-3 text-sm">
                  {data.app.installsByVersion.map((v) => (
                    <li key={v.version ?? 'unknown'} className="flex items-center justify-between py-2.5">
                      <span className="font-medium">v{v.version ?? 'unknown'}</span>
                      <span className="text-ink-soft">{v.devices} device{v.devices === 1 ? '' : 's'} · {v.pushEnabled} with push</span>
                    </li>
                  ))}
                </ul>
              )}
              {!data.app.pushConfigured && (
                <div className="px-5 pb-5"><Alert tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>Without push, alerts reach phones only while the app is open or a responder is On duty. See DEPLOYMENT.md → Push notifications.</Alert></div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
