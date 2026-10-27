'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  Building2,
  Calendar,
  CalendarClock,
  CheckCircle2,
  CheckCheck,
  Clock,
  Database,
  ExternalLink,
  FileClock,
  FlaskConical,
  FolderKanban,
  FolderOpen,
  GraduationCap,
  HeartHandshake,
  HeartPulse,
  KeyRound,
  LifeBuoy,
  ListTodo,
  MapPin,
  Megaphone,
  Radio,
  RadioTower,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sparkles,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { ROLE_LABELS, ROLES } from '@campuscare/shared';
import { useApi, useRealtime } from '@/lib/hooks';
import { useCurrentUser } from '@/components/layout/portal-shell';
import { cn, formatDateTime, timeAgo } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';
import { DutyBadge, Freshness, Kpi, ageLabel, secondsSince, useNow } from '@/components/super-admin/ops-ui';

interface Overview {
  generatedAt: string;
  environment: string;
  sampleData: { present: boolean; demoAccounts: number; sampleIncidents: number };
  duty: {
    onDuty: number;
    onBreak: number;
    offDuty: number;
    unavailable: number;
    stale: number;
    responding: number;
    reachableActive: number;
    heartbeatIntervalSeconds: number;
    staleThresholdSeconds: number;
  };
  sos: { active: number; unacknowledged: number; unassigned: number; respondersAssigned: number };
  incidents: { open: number; overdueAcknowledgement: number; overdueResolution: number };
  location: { activeSecurityShares: number; activeTrustedContactShares: number };
  delivery: { emailFailed24h: number; alertDeliveryFailed24h: number; pushFailed24h: number; jobsFailed: number };
  security: {
    loginFailures7d: number;
    mfaFailures7d: number;
    replayBlocked7d: number;
    mfaLockouts7d: number;
    recoveryCodesUsed7d: number;
    accessDenied7d: number;
    turnstileFailed7d: number;
    privateChatReviews7d: number;
    locationDetailViews7d: number;
    lockedAccounts: number;
  };
  health: {
    database: string;
    worker: string;
    push: string;
    turnstile: string;
    email: string;
    googleOAuth: string;
    sms: string;
  };
}

interface PlatformOverview {
  users: { total: number; activeSessions: number; byRole: Record<string, number> };
  health: { emailProvider: string; jobsPending: number; jobsFailed: number; googleOAuth?: string };
}

function DutyBar({ d }: { d: Overview['duty'] }) {
  const total = d.onDuty + d.onBreak + d.offDuty + d.unavailable + d.stale;
  if (!total) return <p className="text-xs text-ink-soft">No responders enrolled.</p>;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {d.onDuty > 0 && <div style={{ width: pct(d.onDuty) }} className="bg-brand-600 transition-all" title={`On duty: ${d.onDuty}`} />}
        {d.onBreak > 0 && <div style={{ width: pct(d.onBreak) }} className="bg-sky-400 transition-all" title={`On break: ${d.onBreak}`} />}
        {d.unavailable > 0 && <div style={{ width: pct(d.unavailable) }} className="bg-amber-400 transition-all" title={`Unavailable: ${d.unavailable}`} />}
        {d.stale > 0 && <div style={{ width: pct(d.stale) }} className="bg-rose-500 transition-all" title={`Stale heartbeat: ${d.stale}`} />}
        {d.offDuty > 0 && <div style={{ width: pct(d.offDuty) }} className="bg-slate-300 transition-all" title={`Off duty: ${d.offDuty}`} />}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-600" /> On duty ({d.onDuty})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> On break ({d.onBreak})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Unavailable ({d.unavailable})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" /> Stale ({d.stale})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-300" /> Off duty ({d.offDuty})</span>
      </div>
    </div>
  );
}

function HealthRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean | null }) {
  return (
    <li className="flex items-center justify-between px-5 py-2.5 text-xs">
      <span className="flex items-center gap-2 text-ink-strong">{icon}{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-ink-soft">{value}</span>
        {ok === true && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Operational" />}
        {ok === false && <span className="h-2 w-2 rounded-full bg-rose-500" title="Degraded / Not Configured" />}
        {ok === null && <span className="h-2 w-2 rounded-full bg-slate-300" />}
      </span>
    </li>
  );
}

export default function SuperAdminDashboardPage() {
  const me = useCurrentUser();
  const now = useNow(5000);

  const { data: d, error, isLoading, mutate: mutateOps } = useApi<Overview>('/admin/ops-overview', { refreshInterval: 15000 });
  const { data: platform, mutate: mutatePlatform } = useApi<PlatformOverview>('/admin/overview', { refreshInterval: 30000 });
  const { data: verifQueue, mutate: mutateVerif } = useApi<any>('/admin/users/students/verifications/queue?status=pending&limit=5');
  const { data: supportQueue, mutate: mutateSupport } = useApi<any>('/support/admin/tickets?status=open&limit=5');
  const { data: auditHealth } = useApi<any>('/admin/audit/health');

  // Real-time synchronization
  useRealtime('ops:overview', {
    'overview:update': () => {
      void mutateOps();
      void mutatePlatform();
      void mutateVerif();
      void mutateSupport();
    },
    'sos:new': () => {
      void mutateOps();
    },
  });

  if (isLoading || !d) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (error) return <ErrorState message={error.message} onRetry={() => mutateOps()} />;

  const sec = d.security;
  const failures = d.delivery.emailFailed24h + d.delivery.alertDeliveryFailed24h + d.delivery.pushFailed24h + d.delivery.jobsFailed;
  const updated = secondsSince(d.generatedAt, now);

  const pendingVerifCount = verifQueue?.total || 0;
  const openSupportCount = supportQueue?.total || 0;
  const totalActionTasks = d.sos.unacknowledged + pendingVerifCount + d.incidents.overdueAcknowledgement + openSupportCount;

  return (
    <div className="space-y-6">
      {/* 1. Welcome Header with Admin Identity & Live Status */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-forest to-emerald-900 p-6 text-white shadow-lift">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300 border border-emerald-400/30">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Control Center
              </span>
              <span className="text-xs text-white/60">Updated {ageLabel(updated)}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Welcome back, {me.user.fullName}
            </h1>
            <p className="text-xs text-white/80 max-w-xl">
              CampusCare Super Admin Portal · SRM University AP · Authenticated with full system governance and emergency dispatch oversight.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs">
              <Link href="/super-admin/activity-center" className="flex items-center gap-1.5">
                <ListTodo className="h-4 w-4" />
                Activity Center
                {totalActionTasks > 0 && (
                  <span className="ml-1 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-bold text-white">
                    {totalActionTasks}
                  </span>
                )}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild className="bg-white/10 text-white border-white/20 hover:bg-white/20 text-xs">
              <Link href="/super-admin/emergency-alerts" className="flex items-center gap-1.5">
                <Siren className="h-4 w-4 text-rose-300" />
                Emergency Operations
              </Link>
            </Button>
          </div>
        </div>

        {/* Ambient subtle glow decoration */}
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      </div>

      {/* 2. Urgent Emergency & Stale Heartbeat Alerts */}
      {d.sos.unacknowledged > 0 && (
        <Alert
          tone="rose"
          icon={<Siren className="h-5 w-5 text-rose-600 animate-spin" />}
          title={`${d.sos.unacknowledged} Emergency SOS alert(s) awaiting responder acknowledgement!`}
        >
          {d.sos.unassigned > 0 && (
            <span className="block font-bold mb-1">
              {d.sos.unassigned} alert(s) could not be automatically assigned to eligible on-duty officers.
            </span>
          )}
          <Link href="/super-admin/emergency-alerts" className="font-bold underline text-rose-800 hover:text-rose-950">
            Open Emergency Dispatch Queue Immediately →
          </Link>
        </Alert>
      )}

      {d.duty.stale > 0 && (
        <Alert
          tone="amber"
          icon={<RadioTower className="h-4 w-4 text-amber-600" />}
          title={`${d.duty.stale} Security Responder heartbeat(s) stale`}
        >
          Responder GPS connectivity ceased while marked on duty. They are preserved as stale rather than off duty until supervisor intervention.{' '}
          <Link href="/super-admin/duty-roster?status=stale" className="font-semibold underline">
            Review Active Duty Roster →
          </Link>
        </Alert>
      )}

      {/* 3. Quick Action Hub Grid */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-700" /> Quick Management Workflows
          </h2>
          <span className="text-[11px] text-ink-soft">Shortcuts</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Link
            href="/super-admin/users/verifications"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-amber-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700 group-hover:scale-105 transition-transform">
                <CheckCheck className="h-4 w-4" />
              </span>
              {pendingVerifCount > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingVerifCount}
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-amber-800">Verify Students</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Enrollment credentials</p>
          </Link>

          <Link
            href="/super-admin/emergency-alerts"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-rose-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-700 group-hover:scale-105 transition-transform">
                <Siren className="h-4 w-4" />
              </span>
              {d.sos.active > 0 && (
                <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white animate-pulse">
                  {d.sos.active}
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-rose-800">SOS Operations</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Emergency response</p>
          </Link>

          <Link
            href="/super-admin/incidents"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-blue-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 group-hover:scale-105 transition-transform">
                <FolderKanban className="h-4 w-4" />
              </span>
              {d.incidents.open > 0 && (
                <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-ink">
                  {d.incidents.open}
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-blue-800">Incident Triage</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Formal complaints</p>
          </Link>

          <Link
            href="/super-admin/support"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-emerald-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 group-hover:scale-105 transition-transform">
                <LifeBuoy className="h-4 w-4" />
              </span>
              {openSupportCount > 0 && (
                <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {openSupportCount}
                </span>
              )}
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-emerald-800">Support Center</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Help desk & FAQs</p>
          </Link>

          <Link
            href="/super-admin/announcements"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-purple-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700 group-hover:scale-105 transition-transform">
                <Megaphone className="h-4 w-4" />
              </span>
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-purple-800">Announcements</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Broadcast notices</p>
          </Link>

          <Link
            href="/super-admin/audit-logs"
            className="group rounded-xl border border-line bg-white p-3 shadow-2xs hover:border-teal-300 hover:shadow-sm transition"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700 group-hover:scale-105 transition-transform">
                <FileClock className="h-4 w-4" />
              </span>
              {auditHealth?.integrity?.ok && (
                <span className="h-2 w-2 rounded-full bg-emerald-500" title="Hash chain verified" />
              )}
            </div>
            <p className="text-xs font-bold text-ink-strong group-hover:text-teal-800">Database Audit</p>
            <p className="text-[11px] text-ink-soft mt-0.5">Activity & hash chain</p>
          </Link>
        </div>
      </div>

      {/* 4. Core Operational KPIs (Live Data Only) */}
      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Officers on duty"
          value={d.duty.onDuty}
          icon={<UserCheck className="h-4 w-4" />}
          tone="brand"
          hint={`${d.duty.reachableActive} with active heartbeats · ${d.duty.responding} responding`}
          href="/super-admin/duty-roster"
        />
        <Kpi
          label="Active SOS Alerts"
          value={d.sos.active}
          icon={<Siren className="h-4 w-4" />}
          tone={d.sos.unacknowledged > 0 ? 'rose' : d.sos.active > 0 ? 'amber' : 'neutral'}
          hint={`${d.sos.unacknowledged} unacknowledged · ${d.sos.unassigned} unassigned`}
          href="/super-admin/emergency-alerts"
        />
        <Kpi
          label="Open Incidents"
          value={d.incidents.open}
          icon={<FolderOpen className="h-4 w-4" />}
          tone={d.incidents.overdueAcknowledgement + d.incidents.overdueResolution > 0 ? 'amber' : 'neutral'}
          hint={`${d.incidents.overdueAcknowledgement} overdue triage · ${d.incidents.overdueResolution} overdue resolution`}
          href="/super-admin/incidents"
        />
        <Kpi
          label="Delivery Health (24h)"
          value={failures}
          icon={<BellOff className="h-4 w-4" />}
          tone={failures > 0 ? 'rose' : 'neutral'}
          hint={`${d.delivery.emailFailed24h} emails · ${d.delivery.pushFailed24h} push · ${d.delivery.jobsFailed} jobs failed`}
          href="/super-admin/notifications"
        />
      </section>

      {/* 5. Tasks Requiring Attention & Live Action Preview */}
      <Card className="p-4 shadow-sm border border-slate-200/80">
        <div className="flex items-center justify-between border-b border-line pb-3 mb-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-ink-strong flex items-center gap-1.5">
              <ListTodo className="h-4 w-4 text-emerald-700" /> Tasks Requiring Administrator Attention
            </h3>
            <p className="text-xs text-ink-soft">
              Prioritized queue of pending verifications, unassigned cases, and student inquiries.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/super-admin/activity-center" className="flex items-center gap-1">
              View All Tasks in Activity Center <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        <div className="divide-y divide-slate-100">
          {d.sos.unacknowledged > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-700">
                  <Siren className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink-strong">
                    {d.sos.unacknowledged} Emergency SOS alert(s) unacknowledged
                  </p>
                  <p className="text-[11px] text-ink-soft">Requires immediate responder dispatch and verification</p>
                </div>
              </div>
              <Button variant="danger" size="sm" asChild className="h-7 text-xs">
                <Link href="/super-admin/emergency-alerts">Dispatch</Link>
              </Button>
            </div>
          )}

          {pendingVerifCount > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink-strong">
                    {pendingVerifCount} Student enrollment verification(s) pending review
                  </p>
                  <p className="text-[11px] text-ink-soft">Inspect student IDs and enrollment documents</p>
                </div>
              </div>
              <Button variant="brand" size="sm" asChild className="h-7 text-xs">
                <Link href="/super-admin/users/verifications">Review Queue</Link>
              </Button>
            </div>
          )}

          {d.incidents.overdueAcknowledgement > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <FolderKanban className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink-strong">
                    {d.incidents.overdueAcknowledgement} Incident complaint(s) past SLA acknowledgement
                  </p>
                  <p className="text-[11px] text-ink-soft">Assign handlers and begin formal inquiry</p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                <Link href="/super-admin/incidents">Triage Cases</Link>
              </Button>
            </div>
          )}

          {openSupportCount > 0 && (
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                  <LifeBuoy className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-ink-strong">
                    {openSupportCount} Open student support ticket(s)
                  </p>
                  <p className="text-[11px] text-ink-soft">Questions awaiting campus administrative answer</p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                <Link href="/super-admin/support">Answer Tickets</Link>
              </Button>
            </div>
          )}

          {totalActionTasks === 0 && (
            <div className="py-4 text-center text-xs text-ink-soft flex items-center justify-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>All action queues are clear. No pending items require immediate attention.</span>
            </div>
          )}
        </div>
      </Card>

      {/* 6. Duty Distribution & Security Overview */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Duty Roster Distribution"
            description="Real-time availability of campus safety responders enrolled in emergency dispatch."
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href="/super-admin/duty-roster">Manage Roster</Link>
              </Button>
            }
          />
          <div className="p-5">
            <DutyBar d={d.duty} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Authentication & Security (Past 7 Days)"
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href="/super-admin/security">Security Center</Link>
              </Button>
            }
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-5 text-sm">
            {[
              ['Failed sign-ins', sec.loginFailures7d],
              ['Failed 2-step codes', sec.mfaFailures7d],
              ['Replayed codes blocked', sec.replayBlocked7d],
              ['2-step lockouts', sec.mfaLockouts7d],
              ['Recovery codes used', sec.recoveryCodesUsed7d],
              ['Access denied events', sec.accessDenied7d],
              ['Private chat reviews', sec.privateChatReviews7d],
              ['Location detail views', sec.locationDetailViews7d],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-ink-soft">{k}</dt>
                <dd className="tabular text-lg font-bold text-ink-strong">{v}</dd>
              </div>
            ))}
          </dl>
          {sec.lockedAccounts > 0 && (
            <div className="px-5 pb-5">
              <Badge tone="amber">
                <ShieldAlert className="h-3 w-3 mr-1" /> {sec.lockedAccounts} account(s) locked now
              </Badge>
            </div>
          )}
        </Card>
      </div>

      {/* 7. System Health & Platform Accounts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="System Health & Infrastructure"
            description="Operational health of connected database, workers, and external notification providers."
          />
          <ul className="divide-y divide-line">
            <HealthRow
              icon={<Database className="h-4 w-4 text-emerald-700" />}
              label="MongoDB Atlas Database"
              value={d.health.database}
              ok={d.health.database === 'ok'}
            />
            <HealthRow
              icon={<Server className="h-4 w-4 text-emerald-700" />}
              label="Background Queue Worker"
              value={d.health.worker}
              ok={d.health.worker.startsWith('running')}
            />
            <HealthRow
              icon={<RadioTower className="h-4 w-4 text-emerald-700" />}
              label="Firebase Push Notifications (FCM)"
              value={d.health.push}
              ok={d.health.push === 'configured'}
            />
            <HealthRow
              icon={<ShieldCheck className="h-4 w-4 text-emerald-700" />}
              label="Cloudflare Turnstile Bot Defense"
              value={d.health.turnstile}
              ok={d.health.turnstile === 'configured'}
            />
            <HealthRow
              icon={<Server className="h-4 w-4 text-emerald-700" />}
              label="Transactional Email Provider"
              value={platform?.health?.emailProvider ?? d.health.email}
              ok={platform ? platform.health.emailProvider !== 'console' : true}
            />
            <HealthRow
              icon={<FileClock className="h-4 w-4 text-emerald-700" />}
              label="Database Audit Hash Chain"
              value={auditHealth?.integrity?.ok ? 'Cryptographically Sound' : 'Append-Only Active'}
              ok={auditHealth ? auditHealth.integrity.ok : true}
            />
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Platform Accounts by Role"
            description="Total registered accounts active on CampusCare."
            action={
              <Button size="sm" variant="outline" asChild>
                <Link href="/super-admin/users">User Directory</Link>
              </Button>
            }
          />
          {!platform ? (
            <div className="p-5">
              <Skeleton className="h-40" />
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {ROLES.map((r) => (
                  <li key={r} className="flex justify-between px-5 py-2.5 text-xs">
                    <span className="font-medium text-ink">{ROLE_LABELS[r]}</span>
                    <strong className="tabular font-bold text-ink-strong">
                      {platform.users.byRole[r] ?? 0}
                    </strong>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between border-t border-line px-5 py-3 text-xs text-ink-soft bg-slate-50/50">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-brand-700" />
                  Total Registered Accounts: <strong className="text-ink-strong">{platform.users.total}</strong>
                </span>
                <span>
                  Active Sessions: <strong className="text-ink-strong">{platform.users.activeSessions}</strong>
                </span>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
