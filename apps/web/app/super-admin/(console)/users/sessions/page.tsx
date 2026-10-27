'use client';

import * as React from 'react';
import {
  Globe,
  KeyRound,
  Laptop,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS, type Role } from '@campuscare/shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, timeAgo } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Skeleton,
} from '@/components/ui/primitives';

interface SessionItem {
  id: string;
  userId: string;
  user: {
    fullName: string;
    email: string;
    role: Role;
    accountStatus: string;
  } | null;
  client: 'web' | 'android';
  deviceName: string | null;
  userAgent: string | null;
  ipHash: string | null;
  mfaVerified: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export default function SessionsPage() {
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);

  const params = new URLSearchParams({
    page: String(page),
    limit: '25',
  });

  const { data, isLoading, error, mutate } = useApi<{
    items: SessionItem[];
    total: number;
    page: number;
    pages: number;
  }>(`/super-admin/users/sessions/active?${params}`);

  async function revokeSession(sessionId: string, userName: string) {
    if (!confirm(`Revoke active session for ${userName}? They will be immediately signed out.`)) return;
    try {
      await api.delete(`/super-admin/users/sessions/${sessionId}`);
      toast.success(`Session revoked for ${userName}`);
      void mutate();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to revoke session');
    }
  }

  // Filter items in client if search entered
  const filteredItems = React.useMemo(() => {
    if (!data?.items) return [];
    if (!q.trim()) return data.items;
    const query = q.toLowerCase().trim();
    return data.items.filter(
      (s) =>
        s.user?.fullName.toLowerCase().includes(query) ||
        s.user?.email.toLowerCase().includes(query) ||
        s.deviceName?.toLowerCase().includes(query) ||
        s.userAgent?.toLowerCase().includes(query)
    );
  }, [data?.items, q]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live Login Sessions & Token Security"
        description="Inspect cryptographically valid, active session tokens across web browsers and native Android applications. Revoke compromised or suspicious device credentials in real time."
      />

      {/* Info Warning */}
      <Alert tone="neutral" icon={<ShieldCheck className="h-5 w-5 text-forest" />}>
        <p className="text-xs text-ink leading-relaxed">
          Sessions are opaque and revocable. Revoking a session terminates the authentication token on the backend and forces the client
          to sign in again. All sensitive administrator actions enforce recent re-authentication and MFA validation.
        </p>
      </Alert>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input
            className="pl-10 pr-9 text-xs"
            placeholder="Search active sessions by user name, email, or device..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink-strong"
              onClick={() => setQ('')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh Sessions
          </Button>
        </div>
      </div>

      {/* Sessions Table */}
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : error ? (
        <Alert tone="rose" title="Failed to load active sessions">
          {(error as Error).message || 'Server error loading active sessions'}
        </Alert>
      ) : !filteredItems.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<KeyRound className="h-10 w-10 text-slate-400" />}
            title="No active sessions found"
            description="There are currently no active sessions matching your query."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <tr>
                  <th className="px-5 py-3.5">Account / User</th>
                  <th className="px-4 py-3.5">Platform & Client</th>
                  <th className="px-4 py-3.5">Device / User Agent</th>
                  <th className="px-4 py-3.5">MFA Status</th>
                  <th className="px-4 py-3.5">Last Activity</th>
                  <th className="px-4 py-3.5">Token Expiry</th>
                  <th className="px-5 py-3.5 text-right">Revocation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((s) => (
                  <tr key={s.id} className="hover:bg-mint/20 transition-colors">
                    {/* User info */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-ink-strong text-sm">
                          {s.user?.fullName ?? 'Unknown User'}
                        </span>
                        <span className="text-xs text-ink-soft font-mono">
                          {s.user?.email ?? 'orphaned session'}
                        </span>
                        {s.user && (
                          <div className="mt-1">
                            <Badge tone="dark" className="text-[10px]">
                              {ROLE_LABELS[s.user.role]}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Client Type */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        {s.client === 'android' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-800">
                            <Smartphone className="h-4 w-4 text-emerald-600" /> Native Android
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-blue-800">
                            <Laptop className="h-4 w-4 text-blue-600" /> Web Console
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Device & User Agent */}
                    <td className="px-4 py-3.5 text-xs text-ink-soft max-w-[260px]">
                      <p className="font-semibold text-ink-strong truncate">
                        {s.deviceName || (s.client === 'android' ? 'Android Device' : 'Desktop Browser')}
                      </p>
                      <p className="text-[11px] text-slate-400 font-mono truncate" title={s.userAgent ?? ''}>
                        {s.userAgent || 'Unknown User Agent'}
                      </p>
                    </td>

                    {/* MFA */}
                    <td className="px-4 py-3.5">
                      {s.mfaVerified ? (
                        <Badge tone="brand" className="text-[10px]">
                          MFA Verified
                        </Badge>
                      ) : (
                        <Badge tone="neutral" className="text-[10px]">
                          Password / OAuth
                        </Badge>
                      )}
                    </td>

                    {/* Last Seen */}
                    <td className="px-4 py-3.5 text-xs text-ink-soft">
                      <span title={formatDate(s.lastSeenAt)}>{timeAgo(s.lastSeenAt)}</span>
                    </td>

                    {/* Expiry */}
                    <td className="px-4 py-3.5 text-xs text-ink-soft">
                      <span title={formatDate(s.expiresAt)}>{timeAgo(s.expiresAt)}</span>
                    </td>

                    {/* Action */}
                    <td className="px-5 py-3.5 text-right">
                      <Button
                        variant="danger-outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => revokeSession(s.id, s.user?.fullName ?? 'this user')}
                      >
                        <LogOut className="h-3.5 w-3.5 mr-1" />
                        Revoke Session
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-slate-50/50 px-5 py-3 text-xs text-ink-soft">
            <span>
              Showing {filteredItems.length} active sessions ({data?.total ?? 0} total in database)
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
