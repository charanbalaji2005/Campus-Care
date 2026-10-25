'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Bell, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu, WifiOff, X, type LucideIcon } from 'lucide-react';
import { hasPermission, ROLE_LABELS, type Permission, type Role } from '@campuscare/shared';
import { toast } from 'sonner';
import { Logo } from '@/components/brand';
import { Avatar, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useApi, useMe, useOnline, useUserEvents, type Me } from '@/lib/hooks';
import { cn, timeAgo } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  exact?: boolean;
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
  const { data, mutate } = useApi<{ items: { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[]; unread: number }>('/notifications?limit=12');
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
      <DropdownMenu.Trigger className="relative rounded-xl p-2 text-ink hover:bg-brand-50" aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
        <Bell className="h-5 w-5" />
        {Boolean(data?.unread) && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">{data!.unread > 9 ? '9+' : data!.unread}</span>}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-[22rem] max-w-[calc(100vw-1rem)] rounded-2xl border border-line bg-white p-2 shadow-lift">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">Notifications</p>
            {Boolean(data?.unread) && <button className="text-xs font-semibold text-brand-700" onClick={async () => { await api.post('/notifications/read-all'); void mutate(); }}>Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!data?.items.length && <p className="px-2 py-6 text-center text-sm text-ink-soft">You’re all caught up.</p>}
            {data?.items.map((n) => (
              <DropdownMenu.Item key={n.id} onSelect={() => open(n.id, n.link)} className="flex cursor-pointer gap-3 rounded-xl px-2 py-2.5 outline-none data-[highlighted]:bg-brand-50">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-strong">{n.title}</span>
                  <span className="block text-xs text-ink-soft">{n.body}</span>
                  <span className="block text-[11px] text-ink-soft">{timeAgo(n.createdAt)}</span>
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
      <DropdownMenu.Trigger className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-brand-50" aria-label="Account menu">
        <Avatar name={me.user.fullName} className="h-9 w-9" />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight text-ink-strong">{me.user.fullName}</span>
          <span className="block text-xs text-ink-soft">{ROLE_LABELS[me.user.role]}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-56 rounded-2xl border border-line bg-white p-1.5 shadow-lift">
          <DropdownMenu.Item asChild className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-50">
            <Link href="/account/security"><KeyRound className="h-4 w-4" /> Account security</Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item onSelect={signOut} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-700 outline-none data-[highlighted]:bg-rose-50">
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NavList({ items, pathname, collapsed, onNavigate }: { items: NavItem[]; pathname: string; collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1" aria-label="Main">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} title={collapsed ? item.label : undefined}
            className={cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors', active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white', collapsed && 'justify-center px-2')}>
            <item.icon className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
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

  React.useEffect(() => {
    if (error?.status === 401) router.replace(`/super-admin/login?next=${encodeURIComponent(pathname)}`);
  }, [error, pathname, router]);

  const allowed = me && (!roles || roles.includes(me.user.role)) && (!permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, permission));
  React.useEffect(() => {
    if (me && !allowed) router.replace('/unauthorized');
  }, [me, allowed, router]);

  if (isLoading || !me || !allowed) {
    return (
      <div className="flex min-h-screen">
        <div className="hidden w-64 bg-forest lg:block" />
        <div className="flex-1 space-y-4 p-6"><Skeleton className="h-10 w-64" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>
      </div>
    );
  }

  const items = nav.filter((n) => !n.permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, n.permission));
  const bottom = (mobileNav ?? []).filter((n) => !n.permission || hasPermission({ role: me.user.role, permissions: me.user.permissions }, n.permission));

  return (
    <MeContext.Provider value={me}>
      <div className="flex min-h-screen">
        <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col bg-forest p-4 text-white transition-all lg:flex', collapsed ? 'w-20' : 'w-64')}>
          <div className={cn('mb-6 flex items-center', collapsed ? 'justify-center' : 'justify-between')}>
            {!collapsed && <Link href={nav[0]?.href ?? '/'}><Logo light /></Link>}
            <button onClick={() => setCollapsed(!collapsed)} className="rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </button>
          </div>
          {!collapsed && <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{portal}</p>}
          <div className="flex-1 overflow-y-auto"><NavList items={items} pathname={pathname} collapsed={collapsed} /></div>
        </aside>

        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-forest-900/50 lg:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-forest p-4 text-white lg:hidden">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">{portal} navigation</DialogPrimitive.Description>
              <div className="mb-6 flex items-center justify-between"><Logo light /><DialogPrimitive.Close className="rounded-lg p-1.5 hover:bg-white/10" aria-label="Close menu"><X className="h-5 w-5" /></DialogPrimitive.Close></div>
              <NavList items={items} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
            <button className="rounded-xl p-2 hover:bg-brand-50 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
            <span className="text-sm font-semibold text-ink-strong lg:hidden">{portal}</span>
            <div className="flex-1" />
            <NotificationBell />
            <UserMenu me={me} />
          </header>
          {!online && (
            <div className="flex items-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-700" role="status">
              <WifiOff className="h-4 w-4" /> You’re offline. Messages and alerts can’t be sent. In an emergency, call <a href="tel:112" className="font-bold underline">112</a>.
            </div>
          )}
          <main id="main" className={cn('flex-1 px-4 py-6 sm:px-6 lg:px-8', bottom.length && 'pb-24 lg:pb-6')}>
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
          {bottom.length > 0 && (
            <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }} aria-label="Bottom navigation">
              {bottom.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={cn('flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium', active ? 'text-forest' : 'text-ink-soft')}>
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
