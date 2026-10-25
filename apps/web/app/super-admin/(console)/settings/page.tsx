'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Card, Field, Input, PageHeader, Skeleton, SwitchRow } from '@/components/ui/primitives';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

function PlatformSection() {
  const s = useSectionDraft('platform');
  if (!s.draft) return <Skeleton className="h-64" />;
  const d = s.draft;
  return (
    <SectionCard title="Platform" description="Names shown across the app and in emails." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="p-name" label="Platform name"><Input value={d.name} maxLength={60} onChange={(e) => s.setDraft({ ...d, name: e.target.value })} /></Field>
        <Field id="p-uni" label="University name"><Input value={d.universityName} maxLength={120} onChange={(e) => s.setDraft({ ...d, universityName: e.target.value })} /></Field>
        <Field id="p-sup" label="Support email"><Input type="email" value={d.supportEmail} onChange={(e) => s.setDraft({ ...d, supportEmail: e.target.value })} /></Field>
      </div>
      <SwitchRow id="p-maint" label="Maintenance mode" description="Students can sign in and read, but cannot submit reports, send chat messages or book appointments. SOS, Safe Walk, location sharing and all staff actions keep working." checked={d.maintenanceMode} onCheckedChange={(v) => s.setDraft({ ...d, maintenanceMode: v })} />
    </SectionCard>
  );
}

const MORE = [
  { href: '/super-admin/chat', title: 'Support & chat', desc: 'Image and video sending (off by default), community chat, support services' },
  { href: '/super-admin/sos', title: 'SOS & safety', desc: 'SOS countdown, emergency recipients, Safe Walk, location sharing' },
  { href: '/super-admin/security', title: 'Security', desc: 'Turnstile, sessions, password policy, two-step verification' },
  { href: '/super-admin/domains', title: 'Approved domains', desc: 'Domain verification and registration policy' },
  { href: '/super-admin/case-routing', title: 'Case routing', desc: 'Committees per category, deadlines, anonymous reporting' },
  { href: '/super-admin/email', title: 'Email', desc: 'Provider, templates, notifications, inbound email' },
  { href: '/super-admin/retention', title: 'Data retention', desc: 'Retention periods and clean-up' },
];

export default function PlatformSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Platform settings" description="Every change requires password confirmation and is audited." />
      <PlatformSection />
      <Card className="divide-y divide-slate-100">
        {MORE.map((m) => (
          <Link key={m.href} href={m.href} className="flex items-center justify-between gap-3 p-4 hover:bg-mint/40">
            <div><p className="font-medium">{m.title}</p><p className="text-sm text-ink-soft">{m.desc}</p></div>
            <ChevronRight className="h-4 w-4 text-ink-soft" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
