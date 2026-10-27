'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Download,
  Eye,
  History,
  Layers,
  Radio,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi, useRealtime } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export interface AuditEntry {
  id: string;
  seq: number;
  at: string;
  action: string;
  collectionName: string;
  operation: 'insert' | 'update' | 'delete' | 'restore' | 'bulk' | 'auth' | 'export' | 'schema_migration' | 'access_denied';
  severity: 'info' | 'warn' | 'critical';
  source: 'app' | 'change_stream' | 'system' | 'migration' | 'worker';
  correlated: boolean;
  actor: string;
  actorEmail?: string | null;
  actorRole: string | null;
  actorType: 'user' | 'system' | 'job' | 'database_direct' | 'migration';
  targetType: string | null;
  targetId: string | null;
  changedFields: string[];
  diff: Array<{ path: string; prev: unknown; next: unknown }>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  outcome: 'success' | 'failure' | 'denied';
  ipHash?: string;
  reason: string | null;
  correlationId: string | null;
  hash: string;
  prevHash: string;
}

export interface AuditMetrics {
  total: number;
  last24h: number;
  byOperation: Record<string, number>;
  byCollection: Record<string, number>;
  bySeverity: Record<string, number>;
  uncorrelatedDirectEdits: number;
  securityAlerts: number;
  lastIngestionAt: string | null;
}

export interface AuditListResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  metrics: AuditMetrics;
}

export interface RecordHistoryResponse {
  recordId: string;
  count: number;
  events: Array<{
    id: string;
    seq: number;
    at: string;
    action: string;
    operation: string;
    actor: string;
    actorRole: string | null;
    severity: string;
    changedFields: string[];
    diff: Array<{ path: string; prev: unknown; next: unknown }>;
    outcome: string;
    reason: string | null;
  }>;
}

export interface AuditHealthResponse {
  status: 'healthy' | 'degraded';
  changeStream: {
    status: 'active' | 'unsupported_standalone' | 'reconnecting' | 'stopped' | 'error';
    monitoredCollections: string[];
    lastHeartbeat?: string;
    eventCount: number;
  };
  integrity: {
    ok: boolean;
    checked: number;
    brokenAtSeq?: number;
  };
  totalRecordedEvents: number;
}

const COLLECTIONS = [
  { value: '', label: 'All Collections' },
  { value: 'users', label: 'Users & Accounts' },
  { value: 'emergencyalerts', label: 'SOS Emergencies' },
  { value: 'incidents', label: 'Incidents & Evidence' },
  { value: 'settings', label: 'Platform Settings' },
  { value: 'supporttickets', label: 'Support Tickets' },
  { value: 'counsellingappointments', label: 'Counselling Appointments' },
  { value: 'safewalkrequests', label: 'Safe Walk Requests' },
  { value: 'communityposts', label: 'Community Posts' },
  { value: 'auditlogs', label: 'Audit Logs' },
];

const OPERATIONS = [
  { value: '', label: 'All Operations' },
  { value: 'insert', label: 'Document Insert' },
  { value: 'update', label: 'Field Update' },
  { value: 'delete', label: 'Deletion / Archive' },
  { value: 'restore', label: 'Document Restore' },
  { value: 'bulk', label: 'Bulk Operation' },
  { value: 'auth', label: 'Authentication & MFA' },
  { value: 'export', label: 'Data Export' },
  { value: 'schema_migration', label: 'Database Migration' },
];

const SEVERITIES = [
  { value: '', label: 'All Severities' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

const SOURCES = [
  { value: '', label: 'All Sources' },
  { value: 'app', label: 'Application API' },
  { value: 'change_stream', label: 'MongoDB Change Stream' },
  { value: 'system', label: 'System Service' },
  { value: 'worker', label: 'Background Worker' },
  { value: 'migration', label: 'Database Migration' },
];

export function AuditLogViewer() {
  // Query & Filter states
  const [q, setQ] = React.useState('');
  const [collection, setCollection] = React.useState('');
  const [operation, setOperation] = React.useState('');
  const [severity, setSeverity] = React.useState('');
  const [source, setSource] = React.useState('');
  const [outcome, setOutcome] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Live streaming toggle
  const [isLive, setIsLive] = React.useState(true);
  const [liveStreamEvents, setLiveStreamEvents] = React.useState<AuditEntry[]>([]);

  // Dialog & Detail states
  const [selectedEntry, setSelectedEntry] = React.useState<AuditEntry | null>(null);
  const [recordHistoryId, setRecordHistoryId] = React.useState<string | null>(null);
  const [recordHistoryData, setRecordHistoryData] = React.useState<RecordHistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  // Export Dialog states
  const [exportModalOpen, setExportModalOpen] = React.useState(false);
  const [exportFormat, setExportFormat] = React.useState<'csv' | 'json'>('csv');
  const [exportReason, setExportReason] = React.useState('');
  const [exporting, setExporting] = React.useState(false);

  // Integrity Verification state
  const [verify, setVerify] = React.useState<{ ok: boolean; checked: number; brokenAtSeq?: number } | null>(null);
  const [verifying, setVerifying] = React.useState(false);

  // Build query string
  const queryParams = new URLSearchParams({
    page: String(page),
    limit: '50',
    ...(q ? { q } : {}),
    ...(collection ? { collection } : {}),
    ...(operation ? { operation } : {}),
    ...(severity ? { severity } : {}),
    ...(source ? { source } : {}),
    ...(outcome ? { outcome } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });

  const { data, error, isLoading, mutate } = useApi<AuditListResponse>(`/admin/audit-logs?${queryParams.toString()}`);
  const { data: healthData, mutate: mutateHealth } = useApi<AuditHealthResponse>('/admin/audit/health');

  // Handle incoming realtime socket event
  const handleRealtimeEntry = React.useCallback(
    (newEntry: unknown) => {
      if (!isLive) return;
      const entry = newEntry as AuditEntry;
      if (!entry || !entry.id) return;

      setLiveStreamEvents((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        return [entry, ...prev.slice(0, 19)];
      });
      void mutate();
      void mutateHealth();
    },
    [isLive, mutate, mutateHealth],
  );

  // Subscribe to ops:audit room
  useRealtime('ops:audit', {
    'audit:entry': handleRealtimeEntry,
  });

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  async function runVerify() {
    setVerifying(true);
    try {
      const res = await api.get<{ ok: boolean; checked: number; brokenAtSeq?: number }>('/admin/audit-logs/verify');
      setVerify(res);
      if (res.ok) {
        toast.success(`Chain intact: checked ${res.checked} entries. Cryptographic hashes match.`);
      } else {
        toast.error(`Integrity mismatch detected at sequence #${res.brokenAtSeq}!`);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setVerifying(false);
    }
  }

  async function openRecordHistory(recId: string) {
    setRecordHistoryId(recId);
    setLoadingHistory(true);
    try {
      const res = await api.get<RecordHistoryResponse>(`/admin/audit/records/${encodeURIComponent(recId)}/history`);
      setRecordHistoryData(res);
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to fetch record history timeline'));
      setRecordHistoryId(null);
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleExportDownload() {
    if (!exportReason || exportReason.trim().length < 4) {
      toast.error('Please enter a specific administrative reason for this export.');
      return;
    }
    setExporting(true);
    try {
      const blob = await api.download('/admin/audit/exports', {
        format: exportFormat,
        reason: exportReason.trim(),
        filters: {
          q: q || undefined,
          collection: collection || undefined,
          operation: operation || undefined,
          severity: severity || undefined,
          source: source || undefined,
          outcome: outcome || undefined,
          from: from || undefined,
          to: to || undefined,
        },
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `campuscare-audit-${new Date().toISOString().slice(0, 10)}.${exportFormat}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      toast.success('Audit log export generated and downloaded successfully.');
      setExportModalOpen(false);
      setExportReason('');
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to export audit logs'));
    } finally {
      setExporting(false);
    }
  }

  function resetFilters() {
    setQ('');
    setCollection('');
    setOperation('');
    setSeverity('');
    setSource('');
    setOutcome('');
    setFrom('');
    setTo('');
    setPage(1);
    setLiveStreamEvents([]);
  }

  const displayItems = React.useMemo(() => {
    if (!data?.items) return [];
    if (page !== 1 || !isLive || liveStreamEvents.length === 0) return data.items;

    const existingIds = new Set(data.items.map((i) => i.id));
    const newItems = liveStreamEvents.filter((item) => !existingIds.has(item.id));
    return [...newItems, ...data.items];
  }, [data?.items, page, isLive, liveStreamEvents]);

  const metrics = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Header with Title and Actions */}
      <PageHeader
        title="Database Activity & Audit Logs"
        description="Continuous database mutation tracking, MongoDB change streams, security event history, and tamper-evident cryptographic hash verification."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isLive ? 'brand' : 'outline'}
              size="sm"
              onClick={() => setIsLive(!isLive)}
              className="gap-2"
            >
              <Radio className={`h-4 w-4 ${isLive ? 'animate-pulse text-emerald-300' : 'text-ink-soft'}`} />
              {isLive ? 'Live Stream: On' : 'Live Stream: Off'}
            </Button>
            <Button variant="outline" size="sm" loading={verifying} onClick={runVerify} className="gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Verify Chain Integrity
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExportModalOpen(true)} className="gap-2">
              <Download className="h-4 w-4" />
              Export Logs
            </Button>
          </div>
        }
      />

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Total Events</span>
            <Database className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-strong">
            {metrics?.total?.toLocaleString() ?? data?.total?.toLocaleString() ?? '—'}
          </p>
          <p className="text-xs text-ink-soft">
            <span className="font-semibold text-emerald-700">+{metrics?.last24h ?? 0}</span> in last 24h
          </p>
        </Card>

        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">DB Mutations</span>
            <Activity className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-strong">
            {(
              (metrics?.byOperation?.insert || 0) +
              (metrics?.byOperation?.update || 0) +
              (metrics?.byOperation?.delete || 0) +
              (metrics?.byOperation?.bulk || 0)
            ).toLocaleString()}
          </p>
          <p className="text-xs text-ink-soft">Inserts, updates & deletions</p>
        </Card>

        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Security Events</span>
            <Shield className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-strong">
            {((metrics?.byOperation?.auth || 0) + (metrics?.securityAlerts || 0)).toLocaleString()}
          </p>
          <p className="text-xs text-ink-soft">Logins, elevation & exports</p>
        </Card>

        <Card className="p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Chain Integrity</span>
            {verify?.ok || healthData?.integrity?.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : verify && !verify.ok ? (
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-ink-soft" />
            )}
          </div>
          <p className="mt-2 text-lg font-bold text-ink-strong">
            {verify ? (verify.ok ? 'Verified Intact' : 'Gap Detected') : healthData?.integrity?.ok ? 'Cryptographically Sound' : 'Append-Only'}
          </p>
          <p className="text-xs text-ink-soft">SHA-256 hash chaining</p>
        </Card>

        <Card className="p-4 shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Change Stream</span>
            <Server className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-2 text-lg font-bold capitalize text-ink-strong">
            {healthData?.changeStream?.status === 'active'
              ? 'Monitoring Active'
              : healthData?.changeStream?.status === 'unsupported_standalone'
                ? 'App Polling'
                : healthData?.changeStream?.status || 'Connecting'}
          </p>
          <p className="text-xs text-ink-soft">
            {healthData?.changeStream?.eventCount || 0} stream events reconciled
          </p>
        </Card>
      </div>

      {/* Verification Result Banner */}
      {verify && (
        verify.ok ? (
          <Alert tone="brand" icon={<ShieldCheck className="h-5 w-5" />} title="Hash Chain Verified">
            Checked {verify.checked} contiguous audit log records. Every SHA-256 sequence hash and backlink was verified
            without gaps or external alterations.
          </Alert>
        ) : (
          <Alert tone="rose" icon={<ShieldAlert className="h-5 w-5" />} title="Integrity Anomaly Detected">
            The cryptographic hash chain broke at sequence #{verify.brokenAtSeq}. An entry may have been modified or deleted
            outside authorized application channels. Escalate immediately to the security team.
          </Alert>
        )
      )}

      {/* Uncorrelated Direct Edits Warning */}
      {metrics && metrics.uncorrelatedDirectEdits > 0 && (
        <Alert tone="amber" icon={<AlertTriangle className="h-5 w-5" />} title="Uncorrelated Direct Database Edits Detected">
          Found {metrics.uncorrelatedDirectEdits} mutation(s) logged via MongoDB change streams that bypassed application services
          (e.g., direct Mongo Compass, MongoDB shell, or administrative scripts).
        </Alert>
      )}

      {/* Filter Toolbar */}
      <Card className="p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
          {/* Free Text Search */}
          <div className="sm:col-span-2 lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-soft" />
              <Input
                placeholder="Search action, actor, reason, ID..."
                className="pl-9"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>

          {/* Collection Filter */}
          <div>
            <Select
              value={collection}
              onChange={(e) => {
                setCollection(e.target.value);
                setPage(1);
              }}
            >
              {COLLECTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Operation Filter */}
          <div>
            <Select
              value={operation}
              onChange={(e) => {
                setOperation(e.target.value);
                setPage(1);
              }}
            >
              {OPERATIONS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Severity Filter */}
          <div>
            <Select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                setPage(1);
              }}
            >
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Source Filter */}
          <div>
            <Select
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setPage(1);
              }}
            >
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Outcome Filter */}
          <div>
            <Select
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="denied">Denied</option>
            </Select>
          </div>

          {/* Clear Filters Button */}
          <div className="flex items-center">
            <Button variant="ghost" size="sm" onClick={resetFilters} className="w-full text-xs text-ink-soft hover:text-ink-strong">
              Reset Filters
            </Button>
          </div>
        </div>

        {/* Date presets row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-ink-soft">
          <span className="flex items-center gap-1 font-semibold text-ink-strong">
            <Calendar className="h-3.5 w-3.5" /> Date Range:
          </span>
          <Input
            type="date"
            className="h-8 w-36 text-xs"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
          <span>to</span>
          <Input
            type="date"
            className="h-8 w-36 text-xs"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setFrom(today);
                setTo(today);
                setPage(1);
              }}
              className="rounded px-2 py-1 hover:bg-slate-100 text-ink-soft"
            >
              Today
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                setFrom(d.toISOString().slice(0, 10));
                setTo(new Date().toISOString().slice(0, 10));
                setPage(1);
              }}
              className="rounded px-2 py-1 hover:bg-slate-100 text-ink-soft"
            >
              Past 7 Days
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                setFrom(d.toISOString().slice(0, 10));
                setTo(new Date().toISOString().slice(0, 10));
                setPage(1);
              }}
              className="rounded px-2 py-1 hover:bg-slate-100 text-ink-soft"
            >
              Past 30 Days
            </button>
          </div>
        </div>
      </Card>

      {/* Main Events Table */}
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}

      <Card className="overflow-hidden shadow-sm">
        {isLoading && (
          <div className="space-y-3 p-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {data && !displayItems.length && !isLoading && (
          <EmptyState
            title="No audit events matched"
            description="Try loosening your filters or resetting the date range."
            action={
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Clear All Filters
              </Button>
            }
          />
        )}

        {data && displayItems.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm text-left">
              <thead className="bg-slate-50/80 text-xs uppercase tracking-wider text-ink-soft border-b border-slate-200/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Timestamp (UTC)</th>
                  <th className="px-4 py-3 font-semibold">Action & Operation</th>
                  <th className="px-4 py-3 font-semibold">Actor / Origin</th>
                  <th className="px-4 py-3 font-semibold">Target / Collection</th>
                  <th className="px-4 py-3 font-semibold">Changed Fields</th>
                  <th className="px-4 py-3 font-semibold">Outcome</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayItems.map((entry) => {
                  const isNewLive = liveStreamEvents.some((l) => l.id === entry.id);
                  return (
                    <tr
                      key={entry.id}
                      className={`group transition-colors hover:bg-mint/30 ${
                        isNewLive ? 'bg-emerald-50/60 animate-fadeIn' : ''
                      }`}
                    >
                      {/* Seq */}
                      <td className="px-4 py-3 font-mono text-xs text-ink-soft font-semibold">
                        #{entry.seq}
                      </td>

                      {/* Timestamp */}
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
                        <div className="font-medium text-ink-strong">{formatDateTime(entry.at)}</div>
                        <div className="text-[11px] text-ink-soft flex items-center gap-1">
                          <Clock className="h-3 w-3 inline" />
                          {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>

                      {/* Action & Operation */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="font-mono text-xs font-semibold text-ink-strong">{entry.action}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone={
                                entry.operation === 'insert' || entry.operation === 'restore'
                                  ? 'brand'
                                  : entry.operation === 'delete'
                                    ? 'rose'
                                    : entry.operation === 'bulk'
                                      ? 'amber'
                                      : entry.operation === 'auth' ? 'brand' : 'neutral'
                              }
                            >
                              {entry.operation}
                            </Badge>
                            {entry.source === 'change_stream' && (
                              <Badge tone="amber" className="text-[10px] tracking-tight">
                                Direct DB
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Actor */}
                      <td className="px-4 py-3">
                        <div className="text-xs">
                          <div className="font-medium text-ink-strong flex items-center gap-1.5">
                            {entry.actorType === 'database_direct' ? (
                              <Database className="h-3.5 w-3.5 text-amber-600" />
                            ) : entry.actorType === 'system' || entry.actorType === 'job' ? (
                              <Server className="h-3.5 w-3.5 text-blue-600" />
                            ) : (
                              <User className="h-3.5 w-3.5 text-ink-soft" />
                            )}
                            {entry.actor}
                          </div>
                          <div className="text-[11px] text-ink-soft">
                            {entry.actorEmail ? entry.actorEmail : entry.actorRole ? `Role: ${entry.actorRole}` : 'Automated System'}
                          </div>
                        </div>
                      </td>

                      {/* Target */}
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-ink-strong capitalize">{entry.collectionName}</div>
                        {entry.targetId ? (
                          <button
                            onClick={() => openRecordHistory(entry.targetId!)}
                            className="font-mono text-[11px] text-emerald-700 hover:underline flex items-center gap-1 mt-0.5"
                            title="Inspect complete history of this record"
                          >
                            <History className="h-3 w-3" />
                            {entry.targetId.slice(0, 16)}...
                          </button>
                        ) : (
                          <span className="text-ink-soft text-[11px]">—</span>
                        )}
                      </td>

                      {/* Changed Fields */}
                      <td className="px-4 py-3 text-xs">
                        {entry.changedFields && entry.changedFields.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {entry.changedFields.slice(0, 3).map((f) => (
                              <span
                                key={f}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft border border-slate-200"
                              >
                                {f}
                              </span>
                            ))}
                            {entry.changedFields.length > 3 && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-ink-soft">
                                +{entry.changedFields.length - 3} more
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-soft text-xs">—</span>
                        )}
                      </td>

                      {/* Outcome */}
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            entry.outcome === 'success'
                              ? 'brand'
                              : entry.outcome === 'denied'
                                ? 'rose'
                                : 'amber'
                          }
                        >
                          {entry.outcome}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs gap-1"
                            onClick={() => setSelectedEntry(entry)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Diff
                          </Button>
                          {entry.targetId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-ink-soft hover:text-ink-strong"
                              onClick={() => openRecordHistory(entry.targetId!)}
                              title="View Record Timeline"
                            >
                              <History className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination Controls */}
      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-soft">
          <span>
            Showing page <strong className="text-ink-strong">{page}</strong> of{' '}
            <strong className="text-ink-strong">{pages}</strong> ({data.total.toLocaleString()} total entries)
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => {
                setPage((p) => Math.max(1, p - 1));
                setLiveStreamEvents([]);
              }}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" /> Newer
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => {
                setPage((p) => Math.min(pages, p + 1));
                setLiveStreamEvents([]);
              }}
              className="gap-1"
            >
              Older <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* BEFORE / AFTER DIFF MODAL */}
      <Dialog open={Boolean(selectedEntry)} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        {selectedEntry && (
          <DialogContent
            title={`Audit Event #${selectedEntry.seq}: ${selectedEntry.action}`}
            description={`Recorded on ${formatDateTime(selectedEntry.at)} by ${selectedEntry.actor}`}
            className="max-w-3xl max-h-[85vh] overflow-y-auto"
          >
            <div className="space-y-4 pt-2">
              {/* Event Metadata Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 text-xs border border-slate-100">
                <div>
                  <span className="text-ink-soft uppercase text-[10px] font-semibold block">Operation</span>
                  <span className="font-semibold text-ink-strong capitalize">{selectedEntry.operation}</span>
                </div>
                <div>
                  <span className="text-ink-soft uppercase text-[10px] font-semibold block">Collection</span>
                  <span className="font-semibold text-ink-strong capitalize">{selectedEntry.collectionName}</span>
                </div>
                <div>
                  <span className="text-ink-soft uppercase text-[10px] font-semibold block">Target Record ID</span>
                  <span className="font-mono text-ink-strong text-[11px] truncate block">
                    {selectedEntry.targetId || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-ink-soft uppercase text-[10px] font-semibold block">Outcome</span>
                  <Badge tone={selectedEntry.outcome === 'success' ? 'brand' : 'rose'}>
                    {selectedEntry.outcome}
                  </Badge>
                </div>
              </div>

              {/* Justification / Reason */}
              {selectedEntry.reason && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-900">
                  <span className="font-semibold block mb-0.5">Administrative Justification:</span>
                  {selectedEntry.reason}
                </div>
              )}

              {/* Changed Field Diffs Table */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-soft mb-2 flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-emerald-600" />
                  Field-Level Differences ({selectedEntry.diff?.length || 0})
                </h4>

                {selectedEntry.diff && selectedEntry.diff.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-ink-soft border-b border-slate-200 font-semibold uppercase text-[10px]">
                        <tr>
                          <th className="px-3 py-2">Field Path</th>
                          <th className="px-3 py-2 bg-rose-50/50 text-rose-900">Previous Value (Before)</th>
                          <th className="px-3 py-2 bg-emerald-50/50 text-emerald-900">New Value (After)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {selectedEntry.diff.map((d, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 font-mono font-semibold text-ink-strong">{d.path}</td>
                            <td className="px-3 py-2 font-mono bg-rose-50/30 text-rose-800 break-all">
                              {d.prev === null || d.prev === undefined ? (
                                <span className="text-ink-soft italic">null (undefined)</span>
                              ) : typeof d.prev === 'object' ? (
                                JSON.stringify(d.prev)
                              ) : (
                                String(d.prev)
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono bg-emerald-50/30 text-emerald-800 break-all">
                              {d.next === null || d.next === undefined ? (
                                <span className="text-ink-soft italic">null (removed)</span>
                              ) : typeof d.next === 'object' ? (
                                JSON.stringify(d.next)
                              ) : (
                                String(d.next)
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-ink-soft">
                    No field-level diff was computed for this action (e.g. system read, authentication, or query).
                  </div>
                )}
              </div>

              {/* Cryptographic Proof Details */}
              <div className="border-t border-slate-200 pt-3 text-[11px] text-ink-soft space-y-1">
                <div className="flex items-center justify-between">
                  <span>SHA-256 Record Hash:</span>
                  <span className="font-mono text-ink-strong truncate max-w-xs">{selectedEntry.hash}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Previous Hash Link:</span>
                  <span className="font-mono text-ink-soft truncate max-w-xs">{selectedEntry.prevHash}</span>
                </div>
                {selectedEntry.correlationId && (
                  <div className="flex items-center justify-between">
                    <span>Correlation ID:</span>
                    <span className="font-mono text-ink-strong">{selectedEntry.correlationId}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedEntry(null)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* RECORD LIFECYCLE TIMELINE MODAL */}
      <Dialog open={Boolean(recordHistoryId)} onOpenChange={(open) => !open && setRecordHistoryId(null)}>
        {recordHistoryId && (
          <DialogContent
            title="Record Lifecycle Timeline"
            description={`Complete audit trail for target ID: ${recordHistoryId}`}
            className="max-w-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="space-y-4 pt-2">
              {loadingHistory && (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}

              {recordHistoryData && recordHistoryData.events.length === 0 && !loadingHistory && (
                <div className="text-center p-6 text-sm text-ink-soft">
                  No historical mutations found for this record ID.
                </div>
              )}

              {recordHistoryData && recordHistoryData.events.length > 0 && (
                <div className="relative pl-6 border-l-2 border-emerald-500/30 space-y-6 my-2">
                  {recordHistoryData.events.map((ev) => (
                    <div key={ev.id} className="relative group">
                      {/* Timeline dot */}
                      <div className="absolute -left-[31px] top-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-600 shadow-sm" />

                      <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm hover:border-emerald-300 transition-colors">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-mono font-semibold text-emerald-800">
                            #{ev.seq} · {ev.action}
                          </span>
                          <span className="text-ink-soft">{formatDateTime(ev.at)}</span>
                        </div>
                        <div className="text-xs text-ink-soft mb-2">
                          By <strong className="text-ink-strong">{ev.actor}</strong> ({ev.actorRole || 'System'})
                        </div>

                        {ev.changedFields && ev.changedFields.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-2">
                            {ev.changedFields.map((f) => (
                              <span
                                key={f}
                                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-soft"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        )}

                        {ev.reason && (
                          <p className="text-[11px] text-blue-900 bg-blue-50/70 p-2 rounded mb-2">
                            <strong>Reason:</strong> {ev.reason}
                          </p>
                        )}

                        {ev.diff && ev.diff.length > 0 && (
                          <div className="space-y-1 text-[11px] font-mono border-t border-slate-100 pt-2">
                            {ev.diff.slice(0, 3).map((d, dIdx) => (
                              <div key={dIdx} className="grid grid-cols-3 gap-1">
                                <span className="text-ink-soft truncate">{d.path}:</span>
                                <span className="text-rose-700 line-through truncate">
                                  {String(d.prev ?? 'null')}
                                </span>
                                <span className="text-emerald-700 truncate">
                                  {String(d.next ?? 'null')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={() => setRecordHistoryId(null)}>
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* EXPORT AUDIT LOGS MODAL */}
      <Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
        <DialogContent
          title="Export Audit Logs"
          description="Download authorized audit reports in CSV or JSON. Exports are permanently audited."
          className="max-w-md"
        >
          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1">
                Export Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExportFormat('csv')}
                  className={`rounded-xl border p-3 text-center text-xs font-semibold transition-colors ${
                    exportFormat === 'csv'
                      ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900'
                      : 'border-slate-200 text-ink-soft hover:border-slate-300'
                  }`}
                >
                  CSV Spreadsheet (.csv)
                </button>
                <button
                  type="button"
                  onClick={() => setExportFormat('json')}
                  className={`rounded-xl border p-3 text-center text-xs font-semibold transition-colors ${
                    exportFormat === 'json'
                      ? 'border-emerald-600 bg-emerald-50/50 text-emerald-900'
                      : 'border-slate-200 text-ink-soft hover:border-slate-300'
                  }`}
                >
                  Structured JSON (.json)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-ink-soft mb-1">
                Administrative Justification (Required)
              </label>
              <textarea
                rows={3}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-emerald-600 focus:outline-none"
                placeholder="State the compliance or investigative reason for exporting this audit log segment..."
                value={exportReason}
                onChange={(e) => setExportReason(e.target.value)}
              />
              <span className="text-[11px] text-ink-soft mt-1 block">
                This reason and your Super Admin identity will be logged in the immutable audit trail.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setExportModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="brand"
                size="sm"
                loading={exporting}
                disabled={!exportReason || exportReason.trim().length < 4}
                onClick={handleExportDownload}
                className="gap-1.5"
              >
                <Download className="h-4 w-4" />
                Generate & Download
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
