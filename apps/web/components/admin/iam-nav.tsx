'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  CheckCheck,
  GraduationCap,
  HeartHandshake,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Users,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';

interface UserStats {
  total: number;
  active: number;
  suspended: number;
  pendingVerification: number;
  pendingStudentVerifications?: number;
  verifiedStudents?: number;
  activeSessions: number;
  lockedAccounts: number;
  counsellorsPending: number;
  byRole: Record<string, number>;
}

const NAV_TABS = [
  { href: '/super-admin/users', label: 'All Accounts', icon: Users, key: 'all' },
  { href: '/super-admin/users/students', label: 'Students', icon: GraduationCap, key: 'student' },
  { href: '/super-admin/users/campus-admins', label: 'Campus Admins', icon: Building2, key: 'admin' },
  { href: '/super-admin/users/counsellors', label: 'Counsellors', icon: HeartHandshake, key: 'counsellor' },
  { href: '/super-admin/users/officers', label: 'Safety Officers', icon: Siren, key: 'security_officer' },
  { href: '/super-admin/users/super-admins', label: 'Super Admins', icon: ShieldAlert, key: 'super_admin' },
  { href: '/super-admin/users/verifications', label: 'Verification Queue', icon: CheckCheck, key: 'verifications' },
  { href: '/super-admin/users/sessions', label: 'Login Sessions', icon: KeyRound, key: 'sessions' },
];

export function IamNav() {
  const pathname = usePathname();
  const { data: stats } = useApi<UserStats>('/super-admin/users/stats');

  return (
    <div className="space-y-4 mb-6">
      {/* Quick KPI stats banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">Total Directory</p>
          <p className="text-xl font-bold text-ink-strong tabular mt-0.5">{stats?.total ?? '—'}</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">Students Enrolled</p>
          <p className="text-xl font-bold text-forest tabular mt-0.5">{stats?.byRole?.student ?? '—'}</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">Campus Staff</p>
          <p className="text-xl font-bold text-ink-strong tabular mt-0.5">
            {stats ? (stats.total - (stats.byRole?.student ?? 0)) : '—'}
          </p>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Pending Review</p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-xl font-bold text-amber-700 tabular">
              {(stats?.pendingStudentVerifications ?? stats?.pendingVerification) ?? 0}
            </p>
            {((stats?.pendingStudentVerifications ?? 0) > 0) && (
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">Active Sessions</p>
          <p className="text-xl font-bold text-brand-700 tabular mt-0.5">{stats?.activeSessions ?? '—'}</p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-3.5 shadow-xs">
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wider">Locked / Suspended</p>
          <p className="text-xl font-bold text-rose-600 tabular mt-0.5">
            {stats ? (stats.suspended + stats.lockedAccounts) : '—'}
          </p>
        </div>
      </div>

      {/* Segmented Navigation Tab Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-line bg-slate-50/80 p-1.5 backdrop-blur-xs">
        {NAV_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = pathname === tab.href;

          // Badges for specific tabs
          let countBadge: number | null = null;
          if (tab.key === 'student') countBadge = stats?.byRole?.student ?? null;
          else if (tab.key === 'admin') countBadge = stats?.byRole?.admin ?? null;
          else if (tab.key === 'counsellor') countBadge = stats?.byRole?.counsellor ?? null;
          else if (tab.key === 'security_officer') countBadge = stats?.byRole?.security_officer ?? null;
          else if (tab.key === 'super_admin') countBadge = stats?.byRole?.super_admin ?? null;
          else if (tab.key === 'verifications') countBadge = stats?.pendingStudentVerifications ?? stats?.pendingVerification ?? null;
          else if (tab.key === 'sessions') countBadge = stats?.activeSessions ?? null;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
                isActive
                  ? 'bg-white text-forest shadow-xs ring-1 ring-slate-200/80'
                  : 'text-ink-soft hover:bg-white/60 hover:text-ink-strong'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-forest' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
              {countBadge !== null && countBadge !== undefined && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    isActive
                      ? tab.key === 'verifications' && countBadge > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-brand-50 text-forest'
                      : 'bg-slate-200/70 text-slate-600'
                  }`}
                >
                  {countBadge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
