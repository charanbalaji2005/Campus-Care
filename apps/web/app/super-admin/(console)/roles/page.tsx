'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  Crown,
  ExternalLink,
  EyeOff,
  Filter,
  GraduationCap,
  HeartHandshake,
  Info,
  Lock,
  Radio,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  UserCog,
  Users,
} from 'lucide-react';
import {
  MAIN_ROLES,
  MAIN_ROLE_DEFINITIONS,
  ROLE_LABELS,
  ROLES,
  type MainRole,
  type Role,
} from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';

interface RolesApiResponse {
  roles: Record<Role, string[]>;
  permissions: string[];
  explicitOnly: string[];
  mainRoles?: MainRole[];
  roleLabels?: Record<Role, string>;
  roleDefinitions?: typeof MAIN_ROLE_DEFINITIONS;
  userCounts?: Record<string, number>;
}

// Permission domain groupings for intuitive triage
const PERMISSION_GROUPS: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; permissions: string[] }[] = [
  {
    id: 'emergency',
    label: 'Emergency & SOS',
    icon: Siren,
    permissions: ['sos:raise', 'sos:respond', 'sos:dispatch', 'location:view_live', 'sos:configure'],
  },
  {
    id: 'incidents',
    label: 'Incidents & Complaints',
    icon: ShieldCheck,
    permissions: [
      'incidents:create',
      'incidents:read_own',
      'incidents:read_committee',
      'incidents:update_committee',
      'incidents:triage',
      'incidents:read_sensitive',
    ],
  },
  {
    id: 'duty',
    label: 'Duty Roster & Patrol',
    icon: Radio,
    permissions: ['duty:self', 'duty:view', 'duty:manage', 'safety:self', 'safety:responder_view', 'safety_intel:manage', 'community_safety:manage'],
  },
  {
    id: 'counselling',
    label: 'Counselling & Wellbeing',
    icon: HeartHandshake,
    permissions: [
      'appointments:request',
      'appointments:manage_own',
      'counselling_notes:own',
      'counselling_notes:read_all',
      'appointments:read_aggregate',
      'community_channels:manage',
    ],
  },
  {
    id: 'access',
    label: 'Users & Permissions',
    icon: UserCog,
    permissions: ['users:manage', 'roles:manage', 'committees:manage', 'admin:access', 'super_admin:access'],
  },
  {
    id: 'community',
    label: 'Community & Chat',
    icon: Users,
    permissions: [
      'chat:community',
      'chat:support',
      'chat:moderate',
      'chat:read_private',
      'chat:configure',
      'community:moderate',
      'community:organize_events',
    ],
  },
  {
    id: 'platform',
    label: 'Platform & Security',
    icon: ShieldAlert,
    permissions: [
      'domains:manage',
      'identity_providers:manage',
      'email:manage',
      'routing:manage',
      'security:manage',
      'settings:manage',
      'retention:manage',
      'notifications:manage',
      'announcements:manage',
      'campus_alerts:manage',
      'training:manage',
      'contacts:manage',
      'analytics:read',
      'audit:read',
    ],
  },
];

// Rich metadata for the 5 canonical roles
const ROLE_HERO_CONFIG: Record<
  MainRole,
  {
    badgeTone: 'dark' | 'brand' | 'amber' | 'neutral' | 'rose';
    icon: React.ComponentType<{ className?: string }>;
    accentBorder: string;
    pillBg: string;
    tier: string;
  }
> = {
  super_admin: {
    badgeTone: 'dark',
    icon: Crown,
    accentBorder: 'border-amber-300/80 bg-gradient-to-b from-amber-50/40 via-white to-white',
    pillBg: 'bg-amber-100 text-amber-900 border-amber-200',
    tier: 'Tier 1 · Full System Control',
  },
  admin: {
    badgeTone: 'brand',
    icon: Building2,
    accentBorder: 'border-brand-200 bg-gradient-to-b from-brand-50/30 via-white to-white',
    pillBg: 'bg-emerald-100 text-emerald-900 border-emerald-200',
    tier: 'Tier 2 · Campus Scope',
  },
  student: {
    badgeTone: 'neutral',
    icon: GraduationCap,
    accentBorder: 'border-slate-200 bg-white',
    pillBg: 'bg-slate-100 text-slate-800 border-slate-200',
    tier: 'Tier 3 · Scholar / Resident',
  },
  counsellor: {
    badgeTone: 'brand',
    icon: HeartHandshake,
    accentBorder: 'border-purple-200 bg-gradient-to-b from-purple-50/30 via-white to-white',
    pillBg: 'bg-purple-100 text-purple-900 border-purple-200',
    tier: 'Tier 3 · Wellbeing & Clinical',
  },
  security_officer: {
    badgeTone: 'amber',
    icon: Siren,
    accentBorder: 'border-rose-200 bg-gradient-to-b from-rose-50/30 via-white to-white',
    pillBg: 'bg-rose-100 text-rose-900 border-rose-200',
    tier: 'Tier 3 · Emergency & Duty',
  },
};

export default function RolesPage() {
  const { data, isLoading, error } = useApi<RolesApiResponse>('/super-admin/roles');
  const [activeTab, setActiveTab] = React.useState<'matrix' | 'details' | 'explicit'>('matrix');
  const [search, setSearch] = React.useState('');
  const [selectedGroup, setSelectedGroup] = React.useState<string>('all');
  const [showAuxiliaryRoles, setShowAuxiliaryRoles] = React.useState(false);
  const [selectedRoleDetail, setSelectedRoleDetail] = React.useState<MainRole>('super_admin');

  // List of roles to display in the matrix
  const displayRoles: Role[] = React.useMemo(() => {
    if (showAuxiliaryRoles) {
      return [...ROLES];
    }
    return [...MAIN_ROLES];
  }, [showAuxiliaryRoles]);

  // Filter permissions based on search query and group
  const filteredPermissions = React.useMemo(() => {
    if (!data?.permissions) return [];
    let list = data.permissions;

    if (selectedGroup !== 'all') {
      const grp = PERMISSION_GROUPS.find((g) => g.id === selectedGroup);
      if (grp) {
        list = list.filter((p) => grp.permissions.includes(p));
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((p) => p.toLowerCase().includes(q));
    }

    return list;
  }, [data?.permissions, selectedGroup, search]);

  const totalUsersAcrossRoles = React.useMemo(() => {
    if (!data?.userCounts) return 0;
    return Object.values(data.userCounts).reduce((a, b) => a + b, 0);
  }, [data?.userCounts]);

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <PageHeader
        title="Roles & Permissions"
        description="Comprehensive Role-Based Access Control (RBAC) governance for CampusCare. Authorize, audit, and inspect permissions across all 5 canonical ecosystem roles."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/super-admin/audit-logs?action=user.role_change">
                <ShieldCheck className="h-4 w-4 text-brand-600" />
                Audit Role Changes
              </Link>
            </Button>
            <Button variant="brand" size="sm" asChild>
              <Link href="/super-admin/users">
                <Users className="h-4 w-4" />
                Manage Users
              </Link>
            </Button>
          </div>
        }
      />

      {/* Top Banner & Explicit-Only Guardrail Warning */}
      <Alert
        tone="neutral"
        icon={<Lock className="h-5 w-5 text-rose-600" />}
        title="Zero-Trust Confidentiality Safeguards"
        className="border-rose-200 bg-rose-50/40"
      >
        <p className="text-xs text-ink-soft sm:text-sm">
          CampusCare enforces strict least-privilege security. High-sensitivity operations (such as viewing private counselling therapy
          records via <code className="font-mono text-xs text-rose-700 bg-rose-100 px-1 py-0.5 rounded">counselling_notes:read_all</code> or reading
          sensitive harassment evidence via <code className="font-mono text-xs text-rose-700 bg-rose-100 px-1 py-0.5 rounded">incidents:read_sensitive</code>)
          are <strong>never granted to any role by default</strong> — not even to Super Admins. They require an explicit, time-bounded lawful grant with mandatory justification.
        </p>
      </Alert>

      {/* 5 CANONICAL ROLES SHOWCASE CARDS */}
      <div className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold tracking-tight text-ink-strong">The 5 Canonical Roles</h2>
            <p className="text-xs text-ink-soft">
              Primary authorization hierarchy replacing ambiguous or duplicate administrative definitions.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Database Total: <strong className="font-semibold text-ink-strong">{totalUsersAcrossRoles}</strong> accounts</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {MAIN_ROLES.map((roleKey, idx) => {
            const def = MAIN_ROLE_DEFINITIONS[roleKey];
            const cfg = ROLE_HERO_CONFIG[roleKey];
            const Icon = cfg.icon;
            const count = data?.userCounts?.[roleKey] ?? 0;
            const isSelected = selectedRoleDetail === roleKey;

            return (
              <div
                key={roleKey}
                onClick={() => {
                  setSelectedRoleDetail(roleKey);
                  setActiveTab('details');
                }}
                className={`group relative flex flex-col justify-between rounded-2xl border p-4 shadow-sm transition-all cursor-pointer hover:shadow-md ${cfg.accentBorder} ${
                  isSelected ? 'ring-2 ring-forest shadow-md' : 'hover:border-brand-400'
                }`}
              >
                <div>
                  {/* Top Bar with Number & Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                      {idx + 1}
                    </span>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${cfg.pillBg}`}>
                      {def.badge}
                    </span>
                  </div>

                  {/* Icon & Title */}
                  <div className="mt-3 flex items-start gap-2.5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-xs border border-slate-100 text-forest group-hover:scale-105 transition-transform">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-ink-strong group-hover:text-forest transition-colors">
                        {ROLE_LABELS[roleKey]}
                      </h3>
                      <p className="text-[11px] text-ink-soft line-clamp-1">{def.subtitle}</p>
                    </div>
                  </div>

                  {/* Mission / Description */}
                  <p className="mt-2.5 text-xs text-ink leading-relaxed line-clamp-3">
                    {def.description}
                  </p>
                </div>

                {/* Footer with user count and deep-dive button */}
                <div className="mt-4 pt-3 border-t border-slate-100/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-ink-soft">
                    <Users className="h-3.5 w-3.5" />
                    <span>
                      <strong className="text-ink-strong font-semibold">{count}</strong> user{count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-forest group-hover:translate-x-0.5 transition-transform">
                    Inspect <ChevronRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TABS SECTION */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'matrix' | 'details' | 'explicit')} className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-3">
          <TabsList>
            <TabsTrigger value="matrix">
              <SlidersHorizontal className="h-4 w-4" />
              Permissions Matrix
            </TabsTrigger>
            <TabsTrigger value="details">
              <UserCheck className="h-4 w-4" />
              Role Specifications ({ROLE_LABELS[selectedRoleDetail]})
            </TabsTrigger>
            <TabsTrigger value="explicit">
              <Lock className="h-4 w-4" />
              Explicit Safeguards (Zero-Trust)
            </TabsTrigger>
          </TabsList>

          {activeTab === 'matrix' && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showAuxiliaryRoles}
                  onChange={(e) => setShowAuxiliaryRoles(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span>Include auxiliary roles ({ROLE_LABELS.committee_member}, {ROLE_LABELS.moderator})</span>
              </label>
            </div>
          )}
        </div>

        {/* TAB 1: PERMISSIONS MATRIX */}
        <TabsContent value="matrix" className="space-y-4">
          {/* Controls: Search and Categories */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedGroup('all')}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                  selectedGroup === 'all'
                    ? 'bg-forest text-white shadow-xs'
                    : 'bg-slate-100 text-ink-soft hover:bg-slate-200 hover:text-ink-strong'
                }`}
              >
                All Domains ({data?.permissions?.length ?? 0})
              </button>
              {PERMISSION_GROUPS.map((grp) => {
                const Icon = grp.icon;
                const active = selectedGroup === grp.id;
                return (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => setSelectedGroup(grp.id)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-forest text-white shadow-xs'
                        : 'bg-slate-100 text-ink-soft hover:bg-slate-200 hover:text-ink-strong'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {grp.label}
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter permission names..."
                className="w-full rounded-xl border border-line bg-white pl-9 pr-3.5 py-1.5 text-xs text-ink-strong placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Matrix Table */}
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : error ? (
            <Alert tone="rose" title="Failed to load roles and permissions">
              Please check your network connection or verify that your account retains Super Admin permissions.
            </Alert>
          ) : !data ? null : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="sticky top-0 bg-slate-50/95 backdrop-blur-xs text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                    <tr>
                      <th className="px-5 py-3.5 font-bold text-ink-strong w-[320px]">
                        Permission Name & Scope
                      </th>
                      {displayRoles.map((r) => {
                        const isMain = (MAIN_ROLES as readonly string[]).includes(r);
                        return (
                          <th
                            key={r}
                            className={`px-3 py-3.5 text-center font-bold text-xs ${
                              isMain ? 'text-forest' : 'text-ink-soft'
                            }`}
                          >
                            <div className="flex flex-col items-center">
                              <span>{ROLE_LABELS[r]}</span>
                              <span className="text-[10px] font-normal normal-case text-ink-soft">
                                {data.userCounts?.[r] ?? 0} user{data.userCounts?.[r] !== 1 ? 's' : ''}
                              </span>
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPermissions.length === 0 ? (
                      <tr>
                        <td colSpan={displayRoles.length + 1} className="py-12 text-center text-sm text-ink-soft">
                          <EmptyState
                            icon={<Filter className="h-8 w-8 text-slate-400" />}
                            title="No permissions match your filter"
                            description="Try searching for another keyword or switch category filters."
                          />
                        </td>
                      </tr>
                    ) : (
                      filteredPermissions.map((perm) => {
                        const isExplicit = data.explicitOnly.includes(perm);

                        return (
                          <tr key={perm} className="hover:bg-mint/20 transition-colors">
                            {/* Permission Name and Explicit Badge */}
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-2">
                                <code className="font-mono text-xs font-semibold text-ink-strong bg-slate-100/70 px-2 py-0.5 rounded">
                                  {perm}
                                </code>
                                {isExplicit && (
                                  <Badge tone="rose" className="text-[10px]">
                                    <Lock className="h-3 w-3 mr-0.5" />
                                    Explicit Only
                                  </Badge>
                                )}
                              </div>
                            </td>

                            {/* Checks across each display role */}
                            {displayRoles.map((r) => {
                              const hasPerm = data.roles[r]?.includes(perm);

                              return (
                                <td key={r} className="px-3 py-3 text-center">
                                  {isExplicit ? (
                                    <span
                                      className="inline-flex items-center justify-center text-rose-400"
                                      title="Never granted by default to any role. Requires explicit, audited assignment."
                                    >
                                      <Lock className="h-4 w-4" />
                                    </span>
                                  ) : hasPerm ? (
                                    <span
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-forest"
                                      title={`Granted to ${ROLE_LABELS[r]}`}
                                    >
                                      <Check className="h-4 w-4 stroke-[2.5]" />
                                    </span>
                                  ) : (
                                    <span className="text-slate-300 font-mono text-sm select-none" aria-label="Not granted">
                                      —
                                    </span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-line bg-slate-50/50 px-5 py-3 text-xs text-ink-soft flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-forest text-[10px]">✓</span>
                    Granted automatically by role
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-slate-300 font-mono">—</span>
                    Not granted
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5 text-rose-600" />
                    Explicit-only (Confidential break-glass)
                  </span>
                </div>
                <div>
                  Showing {filteredPermissions.length} of {data.permissions.length} total permissions
                </div>
              </div>
            </Card>
          )}
        </TabsContent>

        {/* TAB 2: ROLE SPECIFICATIONS & DEEP DIVE */}
        <TabsContent value="details" className="space-y-6">
          {/* Role selector pill buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {MAIN_ROLES.map((roleKey) => {
              const def = MAIN_ROLE_DEFINITIONS[roleKey];
              const isSelected = selectedRoleDetail === roleKey;
              return (
                <button
                  key={roleKey}
                  type="button"
                  onClick={() => setSelectedRoleDetail(roleKey)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-all border ${
                    isSelected
                      ? 'bg-forest text-white border-forest shadow-sm'
                      : 'bg-white text-ink border-line hover:border-slate-300'
                  }`}
                >
                  <span>{ROLE_LABELS[roleKey]}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-ink-soft'
                    }`}
                  >
                    {data?.userCounts?.[roleKey] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detailed view of currently selected role */}
          {(() => {
            const def = MAIN_ROLE_DEFINITIONS[selectedRoleDetail];
            const cfg = ROLE_HERO_CONFIG[selectedRoleDetail];
            const Icon = cfg.icon;
            const granted = data?.roles[selectedRoleDetail] ?? [];

            return (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {/* Left Card: Summary & Scope */}
                <Card className="lg:col-span-1 space-y-5 p-6 border-slate-200">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-forest border border-brand-100">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-ink-strong">{def.title}</h3>
                      <p className="text-xs text-ink-soft">{cfg.tier}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Mission & Purpose</h4>
                    <p className="text-sm text-ink leading-relaxed">{def.description}</p>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Operational Scope</h4>
                    <p className="text-sm font-medium text-ink-strong bg-slate-50 p-2.5 rounded-xl border border-line">
                      {def.scope}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-soft">Security Constraint</h4>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 leading-relaxed">
                      {def.securityNote}
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      <Link href={`/super-admin/users?role=${selectedRoleDetail}`}>
                        <Users className="h-4 w-4" />
                        View All {ROLE_LABELS[selectedRoleDetail]} Users ({data?.userCounts?.[selectedRoleDetail] ?? 0})
                        <ExternalLink className="h-3 w-3 ml-auto" />
                      </Link>
                    </Button>
                  </div>
                </Card>

                {/* Right Area: Responsibilities & Granted Permissions */}
                <div className="space-y-6 lg:col-span-2">
                  <Card className="p-6">
                    <h4 className="text-sm font-bold text-ink-strong mb-3">Core Operational Responsibilities</h4>
                    <ul className="space-y-2.5">
                      {def.responsibilities.map((r, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-forest text-xs font-bold">
                            ✓
                          </span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>

                    <h4 className="text-sm font-bold text-ink-strong mt-6 mb-3">Key Technical Capabilities</h4>
                    <ul className="space-y-2.5">
                      {def.keyCapabilities.map((c, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-ink">
                          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 text-xs font-bold">
                            •
                          </span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>

                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-sm font-bold text-ink-strong">
                          Inherited Permissions ({granted.length})
                        </h4>
                        <p className="text-xs text-ink-soft">
                          Fine-grained access tokens automatically authorized when signed in as {def.title}.
                        </p>
                      </div>
                      <Badge tone="brand">{granted.length} Granted</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-64 overflow-y-auto pr-1">
                      {granted.map((p) => (
                        <code
                          key={p}
                          className="font-mono text-xs text-forest bg-mint/50 px-2.5 py-1 rounded-lg border border-brand-200/60"
                        >
                          {p}
                        </code>
                      ))}
                    </div>
                  </Card>
                </div>
              </div>
            );
          })()}
        </TabsContent>

        {/* TAB 3: EXPLICIT-ONLY SAFEGUARDS */}
        <TabsContent value="explicit" className="space-y-6">
          <Card className="p-6 border-rose-200 bg-gradient-to-b from-rose-50/20 to-white">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-100 text-rose-700 border border-rose-200">
                <Lock className="h-6 w-6" />
              </div>
              <div className="space-y-2">
                <h3 className="font-bold text-base text-ink-strong">
                  Explicit-Only Permission Safeguards (Zero-Trust Model)
                </h3>
                <p className="text-sm text-ink leading-relaxed">
                  In accordance with CampusCare's privacy architecture and statutory safeguarding principles, certain records
                  are classified as <strong>Air-Gapped & Sealed</strong>. Even members of the Super Admin role do not receive these permissions
                  by default. They must be explicitly granted to a named administrator account with a recorded lawful justification and duration.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <code className="font-mono text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                    counselling_notes:read_all
                  </code>
                  <Badge tone="rose">Sealed</Badge>
                </div>
                <h4 className="font-semibold text-sm text-ink-strong">Confidential Counselling Therapy Records</h4>
                <p className="text-xs text-ink-soft leading-relaxed">
                  Therapist consultation notes and sensitive psychological disclosures. Strictly accessible only by the assigned counsellor.
                  Cannot be browsed in general admin queues or included in analytical exports.
                </p>
              </div>

              <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <code className="font-mono text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                    incidents:read_sensitive
                  </code>
                  <Badge tone="rose">Restricted</Badge>
                </div>
                <h4 className="font-semibold text-sm text-ink-strong">Sensitive Incident Content & Evidence</h4>
                <p className="text-xs text-ink-soft leading-relaxed">
                  Full text, witness statements, and multimedia evidence for Sexual Harassment (ICC) and severe Ragging inquiries.
                  General triage admins can only route metadata unless explicitly authorized by the inquiry committee.
                </p>
              </div>

              <div className="rounded-2xl border border-rose-200 bg-white p-4 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <code className="font-mono text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                    chat:read_private
                  </code>
                  <Badge tone="rose">Audit-Logged</Badge>
                </div>
                <h4 className="font-semibold text-sm text-ink-strong">Private Support & Case Messages</h4>
                <p className="text-xs text-ink-soft leading-relaxed">
                  Exceptional, warrant- or consent-backed review of direct messaging threads between students and support responders.
                  Every message access creates an immutable, timestamped audit log entry.
                </p>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-rose-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-ink-soft">
              <span>
                To configure break-glass access or audit past requests, inspect the Chat Access and Audit Log consoles.
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/super-admin/chat-access">
                    Review Chat Access Consoles <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
                <Button variant="brand" size="sm" asChild>
                  <Link href="/super-admin/audit-logs">
                    View Immutable Audit Trail <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
