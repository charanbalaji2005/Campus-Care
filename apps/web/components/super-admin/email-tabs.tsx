'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/super-admin/email', label: 'Provider' },
  { href: '/super-admin/email/templates', label: 'Templates' },
  { href: '/super-admin/email/logs', label: 'Delivery log' },
  { href: '/super-admin/email/inbound', label: 'Inbound' },
];

export function EmailTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="Email sections">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={cn('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium', pathname === t.href ? 'bg-white text-forest shadow-sm' : 'text-ink-soft hover:text-ink-strong')}>{t.label}</Link>
      ))}
    </nav>
  );
}
