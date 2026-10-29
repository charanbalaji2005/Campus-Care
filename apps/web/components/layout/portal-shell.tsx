'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  LogOut,
  Menu,
  ShieldAlert,
  Siren,
  Smartphone,
  UserRound,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { hasPermission, ROLE_LABELS, type Permission, type Role } from '@campuscare/shared';
import { toast } from 'sonner';
import { Logo } from '@/components/brand';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useApi, useMe, useOnline, useRealtime, useUserEvents, type Me } from '@/lib/hooks';
import { cn, timeAgo } from '@/lib/utils';
import { GlobalSearch } from './global-search';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  exact?: boolean;
  /** Sidebar section heading; consecutive items with the same group are listed together. */
  group?: string;
  badgeKey?: 'sos' | 'verifications' | 'incidents' | 'support' | 'activity' | 'chats';
}

interface ShellProps {
  portal: string;
  nav: NavItem[];
  roles?: Role[];
  permission?: Permission;
  children: React.ReactNode;
  variant?: 'staff' | 'student';
  mobileNav?: NavItem[];
}

const MeContext = React.createContext<Me | null>(null);
export function useCurrentUser() {
  const me = React.useContext(MeContext);
  if (!me) throw new Error('useCurrentUser must be used inside a portal shell');
  return me;
}

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');
}

export function NotificationBell() {
  const { data, mutate } = useApi<{
    items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
    unread: number;
  }>('/notifications?limit=12');
  const router = useRouter();

  useUserEvents({
    notification: (p) => {
      const n = p as { title: string; body: string; kind: string };
      void mutate();
      if (n.kind === 'sos') toast.error(n.title, { description: n.body, duration: 20000 });
      else toast(n.title, { description: n.body });
    },
  });

  async function open(id: string, link: string | null) {
    await api.post(`/notifications/${id}/read`).catch(() => undefined);
    void mutate();
    if (link) router.push(link);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="relative rounded-xl p-2 text-ink hover:bg-brand-50 transition"
        aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {Boolean(data?.unread) && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white shadow-2xs">
            {data!.unread > 9 ? '9+' : data!.unread}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-line bg-white p-2 shadow-lift"
        >
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-line mb-1">
            <p className="text-sm font-bold text-ink-strong">Notifications</p>
            {Boolean(data?.unread) && (
              <button
                className="text-xs font-semibold text-brand-700 hover:underline"
                onClick={async () => {
                  await api.post('/notifications/read-all');
                  void mutate();
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-2 py-6 text-center text-sm text-ink-soft">You’re all caught up.</p>}
            {data?.items.map((n) => (
              <DropdownMenu.Item
                key={n.id}
                onSelect={() => open(n.id, n.link)}
                className="flex cursor-pointer gap-3 rounded-xl px-2 py-2.5 outline-none transition data-[highlighted]:bg-brand-50"
              >
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-strong">{n.title}</span>
                  <span className="block text-xs text-ink-soft line-clamp-2">{n.body}</span>
                  <span className="block text-[11px] text-ink-soft mt-0.5">{timeAgo(n.createdAt)}</span>
                </span>
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu({ me }: { me: Me }) {
  const router = useRouter();
  async function signOut() {
    await api.post('/auth/logout').catch(() => undefined);
    router.replace('/super-admin/login');
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-brand-50 transition" aria-label="Account menu">
        <Avatar name={me.user.fullName} className="h-9 w-9 ring-2 ring-brand-600/20" />
        <span className="hidden text-left sm:block">
          <span className="block text-xs font-bold leading-tight text-ink-strong">{me.user.fullName}</span>
          <span className="block text-[11px] text-ink-soft">{ROLE_LABELS[me.user.role]}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-2xl border border-line bg-white p-1.5 shadow-lift">
          <div className="px-3 py-2 border-b border-line mb-1">
            <p className="text-xs font-bold text-ink-strong truncate">{me.user.fullName}</p>
            <p className="text-[11px] font-mono text-ink-soft truncate">{me.user.email}</p>
          </div>
          {me.user.role === 'super_admin' && (
            <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs outline-none data-[highlighted]:bg-brand-50">
              <Link href="/super-admin/profile"><UserRound className="h-4 w-4 text-ink-soft" /> My profile</Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs outline-none data-[highlighted]:bg-brand-50">
            <Link href="/account/security"><KeyRound className="h-4 w-4 text-ink-soft" /> Account security</Link>
          </DropdownMenu.Item>
          {me.user.role === 'super_admin' && (
            <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs outline-none data-[highlighted]:bg-brand-50">
              <Link href="/super-admin/authenticator"><Smartphone className="h-4 w-4 text-ink-soft" /> Authenticator app</Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-700 outline-none data-[highlighted]:bg-rose-50">
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Collapsible Navigation List with Group Accordions, Badges, and Active Highlights.
 */
function CollapsibleNavList({
  items,
  pathname,
  collapsed,
  onNavigate,
  badges,
}: {
  items: NavItem[];
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  badges?: Record<string, { count: number; tone: 'rose' | 'amber' | 'brand' | 'neutral' }>;
}) {
  // Group items by their defined group name
  const groups = React.useMemo(() => {
    const list: { name: string; items: NavItem[] }[] = [];
    items.forEach((item) => {
      const gName = item.group || 'General';
      let found = list.find((g) => g.name === gName);
      if (!found) {
        found = { name: gName, items: [] };
        list.push(found);
      }
      found.items.push(item);
    });
    return list;
  }, [items]);

  // Load and persist collapsed state per group
  const [collapsedGroups, setCollapsedGroups] = React.useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem('cc_collapsed_groups');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [groupName]: !prev[groupName] };
      try {
        localStorage.setItem('cc_collapsed_groups', JSON.stringify(next));
      } catch {
        /* storage restricted */
      }
      return next;
    });
  };

  return (
    <nav className="space-y-4" aria-label="Main Navigation">
      {groups.map((group) => {
        // If an item in this group is active, ensure the group is not collapsed
        const hasActiveItem = group.items.some((item) => isActive(pathname, item));
        const isGroupCollapsed = collapsed ? false : !hasActiveItem && Boolean(collapsedGroups[group.name]);

        return (
          <div key={group.name} className="space-y-1">
            {/* Group Header with Collapse Toggle */}
            {!collapsed && (
              <button
                type="button"
                onClick={() => toggleGroup(group.name)}
                className="flex w-full items-center justify-between px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-300/80 hover:text-white transition-colors"
                aria-expanded={!isGroupCollapsed}
              >
                <span>{group.name}</span>
                <span className="text-white/40">
                  {isGroupCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </span>
              </button>
            )}

            {collapsed && <div className="mx-3 my-2 h-px bg-white/10" aria-hidden />}

            {/* Group Nav Items */}
            {!isGroupCollapsed && (
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? `${item.group ? `${item.group}: ` : ''}${item.label}` : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all group relative',
                        active
                          ? 'bg-white/15 text-white font-semibold shadow-[inset_3px_0_0_0_theme(colors.emerald.400)]'
                          : 'text-white/70 hover:bg-white/10 hover:text-white',
                        collapsed && 'justify-center px-2'
                      )}
                    >
                      <item.icon
                        className={cn(
                          'h-[18px] w-[18px] shrink-0 transition-transform group-hover:scale-105',
                          active ? 'text-emerald-300' : 'text-white/70'
                        )}
                        aria-hidden
                      />
                      {!collapsed && <span className="truncate flex-1">{item.label}</span>}

                      {/* Live Badge if present */}
                      {!collapsed && badge && badge.count > 0 && (
                        <span
                          className={cn(
                            'ml-auto rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                            badge.tone === 'rose'
                              ? 'bg-rose-500 text-white animate-pulse'
                              : badge.tone === 'amber'
                              ? 'bg-amber-400 text-amber-950'
                              : badge.tone === 'brand'
                              ? 'bg-emerald-400 text-emerald-950'
                              : 'bg-white/20 text-white'
                          )}
                        >
                          {badge.count}
                        </span>
                      )}

                      {/* Dot for collapsed mode with badge */}
                      {collapsed && badge && badge.count > 0 && (
                        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 animate-ping" />
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** Role-checked layout for every portal. The server enforces permissions; this only routes the user to the right place. */
export function PortalShell({ portal, nav, roles, permission, children, mobileNav }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnline();
  const { data: me, error, isLoading } = useMe();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Live overview counters for dynamic badges
  const { data: opsOverview } = useApi<any>('/admin/ops-overview', { refreshInterval: 15000 });
  const { data: verifQueue } = useApi<any>('/super-admin/users/verifications/queue?limit=1', {
    refreshInterval: 20000,
  });
  const { data: supportStats } = useApi<any>('/support/admin/tickets?status=open&limit=1', { refreshInterval: 20000 });
  const { data: chatsOverview } = useApi<{ conversations: { unreadConversations: number }; reports: { new: number } | null; announcements: { unread: number } }>(
    nav.some((n) => n.badgeKey === 'chats') ? '/chats/overview' : null, { refreshInterval: 30000 },
  );

  // Map badge counts
  const badges = React.useMemo(() => {
    const sosCount = opsOverview?.sos?.active || 0;
    const verifCount = verifQueue?.total || 0;
    const incidentCount = opsOverview?.incidents?.open || 0;
    const supportCount = supportStats?.total || 0;
    const totalActivity = sosCount + verifCount + incidentCount + supportCount;

    return {
      sos: { count: sosCount, tone: 'rose' as const },
      verifications: { count: verifCount, tone: 'amber' as const },
      incidents: { count: incidentCount, tone: 'neutral' as const },
      support: { count: supportCount, tone: 'brand' as const },
      activity: { count: totalActivity, tone: 'rose' as const },
      chats: { count: (chatsOverview?.conversations.unreadConversations ?? 0) + (chatsOverview?.reports?.new ?? 0), tone: 'brand' as const },
    };
  }, [opsOverview, verifQueue, supportStats, chatsOverview]);

  React.useEffect(() => {
    if (error?.status === 401) router.replace(`/super-admin/login?reason=expired&next=${encodeURIComponent(pathname)}`);
  }, [error, pathname, router]);

  const allowed =
    me &&
    (!roles || roles.includes(me.user.role)) &&
    (!permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, permission));

  React.useEffect(() => {
    if (me && !allowed) router.replace('/unauthorized');
  }, [me, allowed, router]);

  if (isLoading || !me || !allowed) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 bg-forest lg:block" />
        <div className="flex-1 space-y-4 p-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const items = nav.filter(
    (n) => !n.permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, n.permission)
  );
  const bottom = (mobileNav ?? []).filter(
    (n) => !n.permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, n.permission)
  );

  const activeSosCount = opsOverview?.sos?.active || 0;

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col bg-forest p-4 text-white transition-all lg:flex shadow-lift z-20',
            collapsed ? 'w-20' : 'w-64'
          )}
        >
          {/* Logo & Collapse button */}
          <div className={cn('mb-4 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            {!collapsed && (
              <Link href={nav[0]?.href ?? '/'} className="transition-opacity hover:opacity-90">
                <Logo light />
              </Link>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </button>
          </div>

          {/* Portal badge */}
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-wider text-brand-300">
              {portal} Control Center
            </p>
          )}

          {/* Emergency SOS Pulse Banner in Sidebar if active */}
          {activeSosCount > 0 && !collapsed && (
            <Link
              href="/super-admin/emergency-alerts"
              className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-rose-400/40 bg-rose-950/70 p-2.5 text-xs font-bold text-rose-200 shadow-sm transition hover:bg-rose-900/80 animate-pulse"
            >
              <div className="flex items-center gap-2">
                <Siren className="h-4 w-4 text-rose-400" />
                <span>{activeSosCount} Active SOS Alert{activeSosCount > 1 ? 's' : ''}</span>
              </div>
              <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                URGENT
              </span>
            </Link>
          )}

          {/* Navigation Items */}
          <div className="flex-1 overflow-y-auto no-scrollbar pr-1">
            <CollapsibleNavList
              items={items}
              pathname={pathname}
              collapsed={collapsed}
              badges={badges}
            />
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-forest-900/60 backdrop-blur-xs lg:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto no-scrollbar bg-forest p-4 text-white lg:hidden shadow-lift">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{portal} navigation</DialogPrimitive.Description>
              <div className="mb-6 flex items-center justify-between">
                <Logo light />
                <DialogPrimitive.Close className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close menu">
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
              </div>

              {activeSosCount > 0 && (
                <Link
                  href="/super-admin/emergency-alerts"
                  onClick={() => setMobileOpen(false)}
                  className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-rose-400/40 bg-rose-950/70 p-2.5 text-xs font-bold text-rose-200 animate-pulse"
                >
                  <div className="flex items-center gap-2">
                    <Siren className="h-4 w-4 text-rose-400" />
                    <span>{activeSosCount} Active Emergency SOS</span>
                  </div>
                  <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                    URGENT
                  </span>
                </Link>
              )}

              <CollapsibleNavList
                items={items}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
                badges={badges}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        {/* Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Header */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 shadow-2xs">
            <button
              className="rounded-xl p-2 hover:bg-brand-50 lg:hidden transition"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-bold text-ink-strong lg:hidden">{portal}</span>

            {/* Global Search */}
            <div className="flex flex-1 justify-end md:justify-start">
              {hasPermission({ role: me.user.role, permissions: me.user.permissions }, 'admin:access') && (
                <GlobalSearch />
              )}
            </div>

            {/* Header SOS Alert Badge if active */}
            {activeSosCount > 0 && (
              <Link
                href="/super-admin/emergency-alerts"
                className="hidden sm:flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 transition animate-pulse"
              >
                <Siren className="h-3.5 w-3.5 text-rose-600" />
                <span>{activeSosCount} Active SOS</span>
              </Link>
            )}

            {/* Notification Bell & Profile Dropdown */}
            <NotificationBell />
            <UserMenu me={me} />
          </header>

          {/* Offline Warning */}
          {!online && (
            <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-800" role="status">
              <WifiOff className="h-4 w-4" /> You’re offline. In an emergency, contact campus security directly.
            </div>
          )}

          {/* Main Body */}
          <main id="main" className={cn('flex-1 px-4 py-6 sm:px-6 lg:px-8', bottom.length && 'pb-24 lg:pb-6')}>
            <div className="mx-auto w-full max-w-7xl">{children}</div>
          </main>

          {/* Bottom Bar for Mobile View */}
          {bottom.length > 0 && (
            <nav
              className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
              style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}
              aria-label="Bottom navigation"
            >
              {bottom.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition',
                      active ? 'text-forest font-semibold' : 'text-ink-soft'
                    )}
                  >
                    <item.icon className={cn('h-5 w-5', active && 'text-brand-600')} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </div>
    </MeContext.Provider>
  );
}
