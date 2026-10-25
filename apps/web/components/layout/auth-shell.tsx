'use client';

import Link from 'next/link';
import { Phone, ShieldCheck, Users, Sparkles } from 'lucide-react';
import { Logo } from '@/components/brand';
import { usePublicSettings } from '@/lib/hooks';

/** Split layout for sign-in pages: brand panel on desktop, compact header on phones. Emergency calling is always one tap away. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { data: settings } = usePublicSettings();
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="hero-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Logo light name={settings?.platformName ?? 'CampusCare'} />
        <div className="max-w-md">
          <h2 className="text-4xl font-bold leading-tight text-white">A safer campus.<br />A brighter tomorrow.</h2>
          <p className="mt-4 text-white/80">Report concerns safely, reach the right committee, book counselling and get help fast — all in one private, secure place.</p>
          <ul className="mt-8 grid grid-cols-3 gap-3 text-sm">
            {[{ i: ShieldCheck, t: 'Safe' }, { i: Users, t: 'Supported' }, { i: Sparkles, t: 'Empowered' }].map(({ i: Icon, t }) => (
              <li key={t} className="glass flex flex-col items-center gap-2 rounded-2xl p-4"><Icon className="h-6 w-6 text-brand-300" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/70">{settings?.universityName ?? ''} · Student Safety &amp; Support Platform</p>
      </aside>

      <main id="main" className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:hidden">
          <Logo name={settings?.platformName ?? 'CampusCare'} />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          <h1 className="text-3xl font-bold tracking-tight text-ink-strong">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-ink-soft">{footer}</div>}
        </div>
        <a href="tel:112" className="mx-auto flex w-full max-w-md items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-100">
          <Phone className="h-4 w-4" /> In an emergency, call 112
        </a>
        <p className="mt-4 text-center text-xs text-ink-soft"><Link href="/privacy" className="underline">Privacy policy</Link></p>
      </main>
    </div>
  );
}
