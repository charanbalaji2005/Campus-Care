'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { BookOpen, Footprints, HeartHandshake, MapPinned, MessageSquareLock, Phone, ShieldCheck, Siren } from 'lucide-react';
import { Logo } from '@/components/brand';
import { AppHandoff } from '@/components/app-handoff';
import { useMe, usePublicSettings } from '@/lib/hooks';

const features = [
  { icon: Siren, title: 'Emergency SOS', text: 'Press and hold to alert Campus Security with your location — with live status as help is on the way.' },
  { icon: MessageSquareLock, title: 'Confidential reporting', text: 'Report ragging, harassment or safety issues to the right committee, anonymously where policy allows.' },
  { icon: HeartHandshake, title: 'Counselling', text: 'Book confidential sessions and message your counsellor privately.' },
  { icon: Footprints, title: 'Safe Walk', text: 'Trusted contacts and security are alerted if you don’t arrive on time.' },
  { icon: MapPinned, title: 'Safety map', text: 'Help points, security posts and verified hazards around campus.' },
  { icon: BookOpen, title: 'Awareness', text: 'Short modules on consent, cyber safety and bystander action — with certificates.' },
];

/**
 * Public landing page. Students and staff use the Android app; the website is the Super Admin
 * console. A signed-in Super Admin goes straight to the console.
 */
export default function Landing() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();

  React.useEffect(() => {
    if (me?.user.role === 'super_admin') router.replace('/super-admin/dashboard');
  }, [me, router]);

  return (
    <main id="main" className="min-h-screen bg-cream">
      <section className="hero-gradient text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Logo light name={settings?.platformName ?? 'CampusCare'} />
          <Link href="/super-admin/login" className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20">
            <ShieldCheck className="h-4 w-4" /> Super Admin
          </Link>
        </header>
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-6 lg:grid-cols-[1.1fr_1fr]">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">{settings?.universityName ?? 'SRM University-AP'}</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">A safer campus, in your pocket.</h1>
            <p className="mt-4 max-w-xl text-lg text-white/80">
              CampusCare is the university’s safety and support app for students and staff. Sign up with your official
              <span className="font-semibold text-white"> @{settings?.accountEmailDomain ?? 'srmap.edu.in'} </span>
              email.
            </p>
            <a href="tel:112" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-lift hover:bg-rose-700">
              <Phone className="h-4 w-4" /> In danger now? Call 112
            </a>
          </motion.div>
          <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, delay: 0.1 }} className="text-ink">
            <AppHandoff showAdminLink={false} />
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-14">
        <h2 className="text-2xl font-bold text-ink-strong">What the app does</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <motion.li key={f.title} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }} className="card p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700"><f.icon className="h-5 w-5" /></div>
              <p className="mt-3 font-semibold text-ink-strong">{f.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{f.text}</p>
            </motion.li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-line py-8 text-center text-xs text-ink-soft">
        <Link href="/privacy" className="underline">Privacy policy</Link> · {settings?.universityName ?? ''} · Student Safety &amp; Support Platform
      </footer>
    </main>
  );
}
