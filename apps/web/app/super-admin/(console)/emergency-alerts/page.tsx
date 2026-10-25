'use client';

import * as React from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Filter, MapPin, Radio, RefreshCw, Send, ShieldAlert,
  Siren, UserCheck, Users, Volume2, VolumeX, XCircle, ArrowUpRight, ChevronRight, Phone
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Badge, Alert, Card, Input } from '@/components/ui/primitives';
import { Kpi, SosBadge, AssignmentBadge, DataTable, useNow, ageLabel } from '@/components/super-admin/ops-ui';
import { toast } from 'sonner';

interface EmergencyAlertItem {
  id: string;
  alertNumber: string;
  status: string;
  assignmentState: string;
  reporterRef: string;
  createdAt: string;
  dispatchedAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  escalationLevel: number;
  campus: string;
  zone: string | null;
  locationAvailable: boolean;
  accuracyMeters: number | null;
  unassignedSince: string | null;
  assignees: Array<{ name: string; status: string }>;
  delivery: Record<string, number>;
}

interface AlertDetail {
  alert: {
    id: string;
    alertNumber: string;
    status: string;
    reporterRef: string;
    createdAt: string;
    campus: string;
    zone: string | null;
    student?: { fullName: string; phone: string | null; studentId: string | null; hostel: string | null };
  };
  assignments: Array<{
    id: string;
    responder: string;
    status: string;
    offeredAt: string;
    acknowledgedAt: string | null;
    rankExplanation: string | null;
  }>;
  candidates: Array<{ userId: string; name: string; distanceMeters: number | null; explanation: string }>;
}

export default function EmergencyAlertsPage() {
  const now = useNow(2000);
  const [loading, setLoading] = React.useState(true);
  const [alerts, setAlerts] = React.useState<EmergencyAlertItem[]>([]);
  const [summary, setSummary] = React.useState({ active: 0, unacknowledged: 0, unassigned: 0, escalated: 0 });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<'active' | 'all' | 'resolved'>('active');
  const [sirenPlaying, setSirenPlaying] = React.useState(false);
  const [broadcastOpen, setBroadcastOpen] = React.useState(false);
  const [broadcastText, setBroadcastText] = React.useState('');
  const [broadcastSending, setBroadcastSending] = React.useState(false);

  const fetchAlerts = React.useCallback(async () => {
    try {
      const res = await api.get<{
        items: EmergencyAlertItem[];
        summary: { active: number; unacknowledged: number; unassigned: number; escalated: number };
      }>(`/ops/admin/emergency-alerts?status=${statusFilter}`);
      setAlerts(res.items || []);
      setSummary(res.summary || { active: 0, unacknowledged: 0, unassigned: 0, escalated: 0 });
    } catch (err) {
      toast.error('Failed to load emergency alerts');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const d = await api.get<AlertDetail>(`/ops/admin/emergency-alerts/${id}`);
      setDetail(d);
    } catch {
      toast.error('Failed to load alert details');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAcknowledge = async (id: string) => {
    try {
      await api.post(`/ops/emergency-alerts/${id}/acknowledge`, {});
      toast.success('Alert acknowledged');
      fetchAlerts();
      if (selectedId === id) loadDetail(id);
    } catch (err: any) {
      toast.error(err.message || 'Could not acknowledge alert');
    }
  };

  const handleSendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setBroadcastSending(true);
    try {
      await api.post('/superadmin/campus-alerts', {
        title: 'EMERGENCY CAMPUS ALERT',
        body: broadcastText,
        severity: 'critical',
        scope: 'campus',
        push: true,
      });
      toast.success('Emergency broadcast sent to all devices');
      setBroadcastText('');
      setBroadcastOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Broadcast failed');
    } finally {
      setBroadcastSending(false);
    }
  };

  const toggleSirenSimulator = () => {
    setSirenPlaying(!sirenPlaying);
    if (!sirenPlaying) {
      toast.info('Simulated siren active (Audio visual test mode)');
    } else {
      toast.success('Simulated siren silenced');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
              <Siren className="h-6 w-6 text-rose-600 animate-pulse" />
              Emergency alerts &amp; SOS Dispatch
            </h1>
            {summary.active > 0 && (
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600" />
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft">
            Realtime university safety control centre, responder auto-dispatch and SOS monitoring.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSirenSimulator}
            className={sirenPlaying ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse' : ''}
          >
            {sirenPlaying ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            {sirenPlaying ? 'Silence Siren' : 'Test Siren'}
          </Button>

          <Button
            variant="default"
            size="sm"
            className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2 shadow-sm"
            onClick={() => setBroadcastOpen(true)}
          >
            <Radio className="h-4 w-4" />
            Broadcast Emergency
          </Button>

          <Button variant="outline" size="sm" onClick={fetchAlerts} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Critical Alarm Banner if Active */}
      {summary.active > 0 && (
        <Alert tone="rose" className="border-rose-400 bg-rose-50/90 text-rose-900 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 animate-bounce" />
            <div>
              <p className="font-bold text-sm">
                CRITICAL: {summary.active} ACTIVE EMERGENCY {summary.active === 1 ? 'ALERT' : 'ALERTS'} REPORTED
              </p>
              <p className="text-xs text-rose-800">
                {summary.unacknowledged} unacknowledged · {summary.unassigned} unassigned · {summary.escalated} escalated. Responders are alerted automatically.
              </p>
            </div>
          </div>
          <Badge tone="rose" className="font-mono text-xs">
            LIVE MONITORING
          </Badge>
        </Alert>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Active SOS Alerts"
          value={summary.active}
          tone={summary.active > 0 ? 'rose' : 'neutral'}
          icon={<Siren className="h-4 w-4" />}
          hint="Incidents currently requiring attention"
        />
        <Kpi
          label="Unacknowledged"
          value={summary.unacknowledged}
          tone={summary.unacknowledged > 0 ? 'rose' : 'neutral'}
          icon={<Clock className="h-4 w-4" />}
          hint="Alerts waiting for responder pickup"
        />
        <Kpi
          label="Unassigned"
          value={summary.unassigned}
          tone={summary.unassigned > 0 ? 'amber' : 'neutral'}
          icon={<ShieldAlert className="h-4 w-4" />}
          hint="Pending algorithm or supervisor assignment"
        />
        <Kpi
          label="Escalated to Control"
          value={summary.escalated}
          tone={summary.escalated > 0 ? 'rose' : 'brand'}
          icon={<AlertTriangle className="h-4 w-4" />}
          hint="Triggered level 1 or 2 supervisor alert"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <span className="text-xs font-semibold uppercase text-ink-soft flex items-center gap-1.5 mr-2">
          <Filter className="h-3.5 w-3.5" /> Filter:
        </span>
        <button
          onClick={() => setStatusFilter('active')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            statusFilter === 'active' ? 'bg-stone-900 text-white' : 'text-ink-soft hover:bg-stone-100'
          }`}
        >
          Active Emergencies ({summary.active})
        </button>
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            statusFilter === 'all' ? 'bg-stone-900 text-white' : 'text-ink-soft hover:bg-stone-100'
          }`}
        >
          All Incident History
        </button>
        <button
          onClick={() => setStatusFilter('resolved')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            statusFilter === 'resolved' ? 'bg-stone-900 text-white' : 'text-ink-soft hover:bg-stone-100'
          }`}
        >
          Resolved Cases
        </button>
      </div>

      {/* Main Content Layout: Table + Detail Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Alerts Table */}
        <div className={`space-y-4 ${selectedId ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
          <div className="card overflow-hidden">
            {alerts.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500 opacity-80" />
                <h3 className="mt-3 text-base font-semibold text-ink-strong">All Clear</h3>
                <p className="mt-1 text-sm text-ink-soft">
                  {statusFilter === 'active'
                    ? 'There are currently no active SOS alerts on campus.'
                    : 'No emergency alerts match the selected filter.'}
                </p>
              </div>
            ) : (
              <DataTable
                head={['Alert', 'Status', 'Zone & Location', 'Reported', 'Assignees', 'Actions']}
                minWidth={680}
              >
                {alerts.map((alert) => {
                  const isSelected = selectedId === alert.id;
                  const ageSec = Math.max(0, Math.round((now - new Date(alert.createdAt).getTime()) / 1000));
                  return (
                    <tr
                      key={alert.id}
                      onClick={() => loadDetail(alert.id)}
                      className={`cursor-pointer transition hover:bg-stone-50/80 ${
                        isSelected ? 'bg-stone-100/80 ring-1 ring-inset ring-brand-500' : ''
                      }`}
                    >
                      <td className="p-3 font-semibold text-ink-strong">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs">{alert.alertNumber}</span>
                          {alert.escalationLevel > 0 && (
                            <Badge tone="rose" className="text-[10px] px-1.5 py-0">
                              Lvl {alert.escalationLevel}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[11px] text-ink-soft font-normal">{alert.reporterRef}</span>
                      </td>

                      <td className="p-3">
                        <div className="flex flex-col gap-1 items-start">
                          <SosBadge status={alert.status} />
                          <AssignmentBadge state={alert.assignmentState} />
                        </div>
                      </td>

                      <td className="p-3 text-xs">
                        <div className="flex items-center gap-1.5 font-medium text-ink">
                          <MapPin className="h-3.5 w-3.5 text-rose-500" />
                          {alert.zone || 'Campus Perimeter'}
                        </div>
                        <span className="text-[11px] text-ink-soft">
                          {alert.locationAvailable ? 'GPS live coordinates' : 'Approximate cell/wifi'}
                        </span>
                      </td>

                      <td className="p-3 text-xs text-ink-soft whitespace-nowrap">
                        <span className="font-medium text-ink">{ageLabel(ageSec)}</span>
                        <br />
                        <span className="text-[10px]">{new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </td>

                      <td className="p-3 text-xs">
                        {alert.assignees.length > 0 ? (
                          <div className="space-y-0.5">
                            {alert.assignees.map((a, i) => (
                              <div key={i} className="flex items-center gap-1 text-[11px] font-medium text-ink">
                                <UserCheck className="h-3 w-3 text-emerald-600" />
                                {a.name}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-rose-600 font-semibold animate-pulse">Waiting for guard...</span>
                        )}
                      </td>

                      <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {alert.status === 'queued' || !alert.acknowledgedAt ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleAcknowledge(alert.id)}
                              className="text-xs py-1 h-7 border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                            >
                              Acknowledge
                            </Button>
                          ) : null}
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => loadDetail(alert.id)}>
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
            )}
          </div>
        </div>

        {/* Selected Alert Details Drawer */}
        {selectedId && (
          <div className="space-y-4">
            <Card className="p-5 border-brand-200 shadow-sm relative">
              <button
                onClick={() => setSelectedId(null)}
                className="absolute top-4 right-4 text-ink-soft hover:text-ink"
              >
                <XCircle className="h-5 w-5" />
              </button>

              {detailLoading ? (
                <div className="p-8 text-center text-sm text-ink-soft">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-brand-600" />
                  Loading incident telemetry...
                </div>
              ) : detail ? (
                <div className="space-y-5">
                  <div>
                    <Badge tone="rose" className="text-xs font-mono mb-2">
                      {detail.alert.alertNumber}
                    </Badge>
                    <h3 className="text-lg font-bold text-ink-strong">Emergency Incident</h3>
                    <p className="text-xs text-ink-soft">Reporter Ref: {detail.alert.reporterRef}</p>
                  </div>

                  {detail.alert.student && (
                    <div className="p-3 bg-stone-50 rounded-xl space-y-1 text-xs border border-line">
                      <p className="font-semibold text-ink-strong">Student Identification (Dispatched)</p>
                      <p className="text-ink">Name: {detail.alert.student.fullName}</p>
                      <p className="text-ink">Hostel / Campus: {detail.alert.student.hostel || 'Main Campus'}</p>
                      {detail.alert.student.phone && (
                        <p className="text-ink flex items-center gap-1 font-mono">
                          <Phone className="h-3 w-3 text-emerald-600" /> {detail.alert.student.phone}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Responders */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-2 flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> Dispatched Responders
                    </h4>
                    {detail.assignments.length === 0 ? (
                      <p className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200">
                        Dispatch algorithm is actively querying nearby on-duty security officers.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {detail.assignments.map((as) => (
                          <div key={as.id} className="p-2.5 rounded-lg bg-stone-50 border border-line flex items-center justify-between text-xs">
                            <div>
                              <p className="font-semibold text-ink">{as.responder}</p>
                              <p className="text-[11px] text-ink-soft">{as.rankExplanation || 'Direct dispatch'}</p>
                            </div>
                            <Badge tone={as.status === 'acknowledged' ? 'brand' : 'amber'}>{as.status}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Nearest Candidates */}
                  {detail.candidates && detail.candidates.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-ink-soft mb-2">
                        Eligible Security Guards Nearby
                      </h4>
                      <div className="space-y-1.5 text-xs">
                        {detail.candidates.slice(0, 3).map((c) => (
                          <div key={c.userId} className="flex items-center justify-between p-2 rounded bg-stone-50 border border-line/60">
                            <span>{c.name}</span>
                            <span className="font-mono text-ink-soft">{c.distanceMeters ? `${c.distanceMeters}m away` : 'On duty'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-line flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs text-rose-700 hover:bg-rose-50 border-rose-200"
                      onClick={() => handleAcknowledge(detail.alert.id)}
                    >
                      Acknowledge Alert
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          </div>
        )}
      </div>

      {/* Broadcast Modal Dialog */}
      {broadcastOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 shadow-2xl bg-white animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-600 font-bold">
                <Siren className="h-5 w-5" />
                <h3>Campus-Wide Emergency Broadcast</h3>
              </div>
              <button onClick={() => setBroadcastOpen(false)} className="text-ink-soft hover:text-ink">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <p className="text-xs text-ink-soft">
              This message will trigger a high-priority push notification and in-app emergency alert across all registered student and staff mobile devices.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-ink">Broadcast Alert Message</label>
              <textarea
                rows={4}
                className="w-full rounded-xl border border-line p-3 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
                placeholder="e.g. Urgent: Severe weather advisory. All students advised to remain indoors inside academic blocks until further notice."
                value={broadcastText}
                onChange={(e) => setBroadcastText(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setBroadcastOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5"
                disabled={!broadcastText.trim() || broadcastSending}
                onClick={handleSendBroadcast}
              >
                <Send className="h-4 w-4" />
                {broadcastSending ? 'Broadcasting…' : 'Send Emergency Alert'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
