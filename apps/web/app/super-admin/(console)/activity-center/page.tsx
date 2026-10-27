'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellOff,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  FolderKanban,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { useApi, useRealtime } from '@/lib/hooks';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui/primitives';

export interface ActionTask {
  id: string;
  title: string;
  description: string;
  category: 'sos' | 'verification' | 'incident' | 'support' | 'security' | 'delivery' | 'audit';
  severity: 'critical' | 'warn' | 'info';
  timestamp: string;
  actionLabel: string;
  actionHref: string;
  badgeText?: string;
}

export default function ActivityCenterPage() {
  const [selectedCategory, setSelectedCategory] = React.useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState<string>('');

  // 1. Live Operations & Security overview
  const {
    data: ops,
    error: opsErr,
    isLoading: opsLoading,
    mutate: mutateOps,
  } = useApi<any>('/admin/ops-overview', { refreshInterval: 15000 });

  // 2. Student Verification Queue
  const {
    data: verifData,
    isLoading: verifLoading,
    mutate: mutateVerif,
  } = useApi<any>('/admin/users/students/verifications/queue?status=pending&limit=15', { refreshInterval: 20000 });

  // 3. Support Tickets Queue
  const {
    data: supportData,
    isLoading: supportLoading,
    mutate: mutateSupport,
  } = useApi<any>('/support/admin/tickets?status=open&limit=15', { refreshInterval: 20000 });

  // 4. Incidents & Complaints Queue
  const {
    data: incidentsData,
    isLoading: incidentsLoading,
    mutate: mutateIncidents,
  } = useApi<any>('/incidents?limit=15', { refreshInterval: 20000 });

  // 5. Audit & Database Health
  const {
    data: auditHealth,
    mutate: mutateAudit,
  } = useApi<any>('/admin/audit/health', { refreshInterval: 30000 });

  // Real-time synchronization
  useRealtime('ops:overview', {
    'overview:update': () => {
      void mutateOps();
      void mutateVerif();
      void mutateIncidents();
    },
    'sos:new': () => {
      void mutateOps();
    },
    'incident:new': () => {
      void mutateIncidents();
    },
  });
  useRealtime('ops:audit', {
    'audit:entry': () => {
      void mutateAudit();
    },
  });

  // Construct actionable tasks from all real endpoints
  const tasks = React.useMemo(() => {
    const list: ActionTask[] = [];

    // --- SOS Alerts (Critical Priority) ---
    if (ops?.sos?.unacknowledged && ops.sos.unacknowledged > 0) {
      list.push({
        id: 'sos-unack',
        title: `${ops.sos.unacknowledged} Emergency SOS alert(s) unacknowledged`,
        description: `${ops.sos.active} active emergency alert(s) require immediate on-duty officer dispatch and response verification.`,
        category: 'sos',
        severity: 'critical',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Dispatch Responders',
        actionHref: '/super-admin/emergency-alerts',
        badgeText: 'IMMEDIATE ACTION',
      });
    }

    if (ops?.sos?.unassigned && ops.sos.unassigned > 0) {
      list.push({
        id: 'sos-unassigned',
        title: `${ops.sos.unassigned} Emergency SOS alert(s) unassigned to any responder`,
        description: 'No eligible on-duty officers acknowledged this emergency alert. Check duty roster and escalation policy.',
        category: 'sos',
        severity: 'critical',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Assign Responders',
        actionHref: '/super-admin/emergency-alerts',
        badgeText: 'ESCALATION NEEDED',
      });
    }

    // --- Stale Responders ---
    if (ops?.duty?.stale && ops.duty.stale > 0) {
      list.push({
        id: 'duty-stale',
        title: `${ops.duty.stale} Officer heartbeat(s) stale`,
        description: 'Responder location heartbeats stopped transmitting. Check duty connectivity to ensure coverage.',
        category: 'security',
        severity: 'warn',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Review Roster',
        actionHref: '/super-admin/duty-roster?status=stale',
        badgeText: 'DUTY STALE',
      });
    }

    // --- Overdue Incidents ---
    if (ops?.incidents?.overdueAcknowledgement && ops.incidents.overdueAcknowledgement > 0) {
      list.push({
        id: 'incidents-overdue-ack',
        title: `${ops.incidents.overdueAcknowledgement} Incident complaint(s) overdue for acknowledgement`,
        description: 'Formal student complaints exceeded the SLA acknowledgement window without assigned investigation.',
        category: 'incident',
        severity: 'warn',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Triage Cases',
        actionHref: '/super-admin/incidents',
        badgeText: 'SLA OVERDUE',
      });
    }

    if (ops?.incidents?.overdueResolution && ops.incidents.overdueResolution > 0) {
      list.push({
        id: 'incidents-overdue-res',
        title: `${ops.incidents.overdueResolution} Incident complaint(s) overdue for resolution`,
        description: 'Assigned cases past standard committee resolution timelines.',
        category: 'incident',
        severity: 'warn',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Review Cases',
        actionHref: '/super-admin/incidents',
        badgeText: 'RESOLUTION OVERDUE',
      });
    }

    // --- Student Enrollment Verifications ---
    if (verifData?.items && Array.isArray(verifData.items)) {
      verifData.items.forEach((item: any) => {
        list.push({
          id: `verif-${item.id || item._id}`,
          title: `Verify enrollment: ${item.fullName}`,
          description: `Student ID: ${item.studentId || 'None'} · Dept: ${item.department || 'Undeclared'} · Year: ${item.academicYear || 'N/A'}${item.isDuplicateStudentId ? ' · [DUPLICATE ID DETECTED]' : ''}`,
          category: 'verification',
          severity: item.isDuplicateStudentId ? 'critical' : 'warn',
          timestamp: item.createdAt || new Date().toISOString(),
          actionLabel: 'Review Verification',
          actionHref: '/super-admin/users/verifications',
          badgeText: item.isDuplicateStudentId ? 'DUPLICATE WARNING' : 'PENDING APPROVAL',
        });
      });
    }

    // --- Support Center Tickets ---
    if (supportData?.tickets && Array.isArray(supportData.tickets)) {
      supportData.tickets.forEach((ticket: any) => {
        list.push({
          id: `support-${ticket._id}`,
          title: `Support Question: ${ticket.subject}`,
          description: `Category: ${ticket.category} · Priority: ${ticket.priority} · From: ${ticket.studentId?.fullName || 'Student'}`,
          category: 'support',
          severity: ticket.priority === 'urgent' || ticket.priority === 'high' ? 'warn' : 'info',
          timestamp: ticket.createdAt || new Date().toISOString(),
          actionLabel: 'Respond to Ticket',
          actionHref: '/super-admin/support',
          badgeText: ticket.status?.toUpperCase() || 'OPEN',
        });
      });
    }

    // --- Delivery Failures ---
    const totalFailures =
      (ops?.delivery?.emailFailed24h || 0) +
      (ops?.delivery?.alertDeliveryFailed24h || 0) +
      (ops?.delivery?.pushFailed24h || 0) +
      (ops?.delivery?.jobsFailed || 0);

    if (totalFailures > 0) {
      list.push({
        id: 'delivery-failures',
        title: `${totalFailures} Notification delivery / worker failure(s) in last 24h`,
        description: `Failed: ${ops?.delivery?.emailFailed24h || 0} emails · ${ops?.delivery?.pushFailed24h || 0} push alerts · ${ops?.delivery?.jobsFailed || 0} background jobs. Inspect provider logs and retry.`,
        category: 'delivery',
        severity: ops?.delivery?.alertDeliveryFailed24h ? 'critical' : 'warn',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Inspect Delivery Logs',
        actionHref: '/super-admin/notifications',
        badgeText: 'DELIVERY FAILED',
      });
    }

    // --- Security & Account Lockouts ---
    if (ops?.security?.lockedAccounts && ops.security.lockedAccounts > 0) {
      list.push({
        id: 'sec-lockouts',
        title: `${ops.security.lockedAccounts} Account(s) locked due to repeated auth/MFA failures`,
        description: 'Accounts currently restricted under rate-limiting and brute-force defenses.',
        category: 'security',
        severity: 'warn',
        timestamp: ops.generatedAt || new Date().toISOString(),
        actionLabel: 'Manage Security',
        actionHref: '/super-admin/security',
        badgeText: 'ACCOUNT LOCKED',
      });
    }

    // --- Database Audit & Tamper Warnings ---
    if (auditHealth?.integrity && !auditHealth.integrity.ok) {
      list.push({
        id: 'audit-integrity',
        title: `Audit Chain Integrity Anomaly at sequence #${auditHealth.integrity.brokenAtSeq}`,
        description: 'Cryptographic hash mismatch detected in append-only database logs. Immediate investigation required.',
        category: 'audit',
        severity: 'critical',
        timestamp: new Date().toISOString(),
        actionLabel: 'Verify Audit Chain',
        actionHref: '/super-admin/audit-logs',
        badgeText: 'INTEGRITY ALERT',
      });
    }

    // Sort by severity (critical first), then newest
    const order = { critical: 0, warn: 1, info: 2 };
    return list.sort((a, b) => {
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [ops, verifData, supportData, incidentsData, auditHealth]);

  // Filtering
  const filteredTasks = React.useMemo(() => {
    return tasks.filter((t) => {
      if (selectedCategory !== 'all' && t.category !== selectedCategory) return false;
      if (selectedSeverity !== 'all' && t.severity !== selectedSeverity) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tasks, selectedCategory, selectedSeverity, searchQuery]);

  const counts = React.useMemo(() => {
    return {
      total: tasks.length,
      critical: tasks.filter((t) => t.severity === 'critical').length,
      warn: tasks.filter((t) => t.severity === 'warn').length,
      info: tasks.filter((t) => t.severity === 'info').length,
      sos: tasks.filter((t) => t.category === 'sos').length,
      verification: tasks.filter((t) => t.category === 'verification').length,
      support: tasks.filter((t) => t.category === 'support').length,
      incident: tasks.filter((t) => t.category === 'incident').length,
    };
  }, [tasks]);

  const isLoading = opsLoading && verifLoading && supportLoading;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Activity Center"
        description="Unified operational action queue prioritizing pending verifications, unassigned cases, emergency escalations, and system alerts."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void mutateOps();
                void mutateVerif();
                void mutateSupport();
                void mutateIncidents();
                void mutateAudit();
              }}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Queue
            </Button>
          </div>
        }
      />

      {/* Critical SOS Banner if active */}
      {counts.sos > 0 && (
        <Alert
          tone="rose"
          icon={<Siren className="h-5 w-5 animate-spin" />}
          title={`${counts.sos} Urgent SOS Emergency Alert(s) Active`}
        >
          Active student emergency alerts require immediate attention. Dispatch and confirm on-duty responder attendance.{' '}
          <Link href="/super-admin/emergency-alerts" className="font-bold underline">
            Open Emergency Operations →
          </Link>
        </Alert>
      )}

      {/* KPI Task Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4 shadow-sm border-l-4 border-l-brand-600">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Total Action Items</span>
            <Activity className="h-4 w-4 text-brand-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-ink-strong">{counts.total}</p>
          <p className="text-xs text-ink-soft">Across all campus departments</p>
        </Card>

        <Card className="p-4 shadow-sm border-l-4 border-l-rose-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-700">Critical Priority</span>
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-rose-700">{counts.critical}</p>
          <p className="text-xs text-ink-soft">Urgent SOS & security alerts</p>
        </Card>

        <Card className="p-4 shadow-sm border-l-4 border-l-amber-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">Pending Review</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-700">{counts.warn}</p>
          <p className="text-xs text-ink-soft">Verifications & overdue cases</p>
        </Card>

        <Card className="p-4 shadow-sm border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">Open Inquiries</span>
            <LifeBuoy className="h-4 w-4 text-blue-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-blue-700">{counts.info}</p>
          <p className="text-xs text-ink-soft">Support questions & feedback</p>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-soft" />
            <Input
              placeholder="Search action items..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Category Filter */}
          <div>
            <Select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="all">All Categories ({counts.total})</option>
              <option value="sos">Emergency SOS ({counts.sos})</option>
              <option value="verification">Student Verifications ({counts.verification})</option>
              <option value="incident">Incidents & Complaints ({counts.incident})</option>
              <option value="support">Support Center ({counts.support})</option>
              <option value="security">Security & Roster</option>
              <option value="delivery">Delivery & System Health</option>
            </Select>
          </div>

          {/* Severity Filter */}
          <div>
            <Select value={selectedSeverity} onChange={(e) => setSelectedSeverity(e.target.value)}>
              <option value="all">All Severities</option>
              <option value="critical">Critical Only ({counts.critical})</option>
              <option value="warn">Warning & Pending ({counts.warn})</option>
              <option value="info">Informational ({counts.info})</option>
            </Select>
          </div>
        </div>

        {/* Quick Filter Tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3 text-xs">
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setSelectedSeverity('all');
            }}
            className={cn(
              'rounded-full px-3 py-1 font-semibold transition',
              selectedCategory === 'all' && selectedSeverity === 'all'
                ? 'bg-forest text-white'
                : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
            )}
          >
            All Tasks ({counts.total})
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setSelectedSeverity('critical');
            }}
            className={cn(
              'rounded-full px-3 py-1 font-semibold transition flex items-center gap-1',
              selectedSeverity === 'critical'
                ? 'bg-rose-700 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            )}
          >
            <ShieldAlert className="h-3 w-3" />
            Critical ({counts.critical})
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('verification');
              setSelectedSeverity('all');
            }}
            className={cn(
              'rounded-full px-3 py-1 font-semibold transition flex items-center gap-1',
              selectedCategory === 'verification'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            )}
          >
            <GraduationCap className="h-3 w-3" />
            Verifications ({counts.verification})
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('support');
              setSelectedSeverity('all');
            }}
            className={cn(
              'rounded-full px-3 py-1 font-semibold transition flex items-center gap-1',
              selectedCategory === 'support'
                ? 'bg-blue-600 text-white'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
            )}
          >
            <LifeBuoy className="h-3 w-3" />
            Support ({counts.support})
          </button>
        </div>
      </Card>

      {/* Main Task List */}
      {opsErr && <ErrorState message={opsErr.message} onRetry={() => mutateOps()} />}

      {isLoading && (
        <Card className="p-6 space-y-4 shadow-sm">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </Card>
      )}

      {!isLoading && filteredTasks.length === 0 && (
        <Card className="p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mb-3">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-ink-strong">No Pending Action Items</h3>
          <p className="mt-1 text-xs text-ink-soft max-w-sm mx-auto">
            All student verifications, emergency alerts, support requests, and incident cases are currently handled.
          </p>
        </Card>
      )}

      {!isLoading && filteredTasks.length > 0 && (
        <div className="space-y-3">
          {filteredTasks.map((task) => (
            <Card
              key={task.id}
              className={cn(
                'p-4 shadow-sm transition hover:shadow-md border-l-4',
                task.severity === 'critical'
                  ? 'border-l-rose-500 bg-rose-50/20'
                  : task.severity === 'warn'
                  ? 'border-l-amber-500'
                  : 'border-l-blue-500'
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                      task.severity === 'critical'
                        ? 'bg-rose-100 text-rose-700'
                        : task.severity === 'warn'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-blue-100 text-blue-700'
                    )}
                  >
                    {task.category === 'sos' ? (
                      <Siren className="h-5 w-5" />
                    ) : task.category === 'verification' ? (
                      <GraduationCap className="h-5 w-5" />
                    ) : task.category === 'incident' ? (
                      <FolderKanban className="h-5 w-5" />
                    ) : task.category === 'support' ? (
                      <LifeBuoy className="h-5 w-5" />
                    ) : (
                      <ShieldAlert className="h-5 w-5" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-bold text-ink-strong">{task.title}</h4>
                      {task.badgeText && (
                        <Badge
                          tone={
                            task.severity === 'critical'
                              ? 'rose'
                              : task.severity === 'warn'
                              ? 'amber'
                              : 'neutral'
                          }
                          className="text-[10px]"
                        >
                          {task.badgeText}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-ink-soft leading-relaxed">{task.description}</p>
                    <div className="flex items-center gap-2 text-[11px] text-ink-soft">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3 inline" />
                        {timeAgo(task.timestamp)}
                      </span>
                      <span>·</span>
                      <span className="capitalize">{task.category}</span>
                    </div>
                  </div>
                </div>

                <div className="sm:self-center shrink-0">
                  <Button
                    variant={task.severity === 'critical' ? 'danger' : 'brand'}
                    size="sm"
                    asChild
                    className="gap-1 text-xs w-full sm:w-auto"
                  >
                    <Link href={task.actionHref}>
                      {task.actionLabel}
                      <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
