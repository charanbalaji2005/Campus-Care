'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { Badge, Button, Card, PageHeader, Skeleton } from '@/components/ui/primitives';

interface Integration { key: string; name: string; status: string; needsCredentials?: boolean; enabled?: boolean }

const LINKS: Record<string, string> = { email: '/super-admin/email', google: '/super-admin/identity-providers', inbound: '/super-admin/email/inbound', turnstile: '/super-admin/security' };
const HELP: Record<string, string> = {
  mongodb: 'Set MONGODB_URI on the API service (MongoDB Atlas recommended).',
  email: 'Nodemailer with a Gmail (or Microsoft 365, Zoho…) mailbox and app password. Configure it under Email, or with MAIL_SERVICE / MAIL_USER / MAIL_APP_PASSWORD.',
  turnstile: 'Create a widget in the Cloudflare dashboard and set TURNSTILE_SITE_KEY and TURNSTILE_SECRET on the API.',
  google: 'Create an OAuth client in Google Cloud Console.',
  inbound: 'Set INBOUND_EMAIL_WEBHOOK_SECRET and point your mail provider at the webhook.',
  storage: 'Evidence and chat files are stored on the API server disk. Use a persistent disk on Render, or replace the storage driver with private object storage.',
  sms: 'Not built in. A provider can be added to the notification service.',
};

export default function IntegrationsPage() {
  const { data } = useApi<Integration[]>('/super-admin/integrations');
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Integrations" description="External services CampusCare depends on. Secrets are configured on the server and never shown here." />
      {!data ? <Skeleton className="h-96" /> : data.map((i) => (
        <Card key={i.key} className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">{i.needsCredentials ? <AlertTriangle className="h-4 w-4 text-amber-600" /> : <CheckCircle2 className="h-4 w-4 text-brand-700" />}{i.name}</p>
            <p className="mt-0.5 text-sm text-ink-soft">{i.status}</p>
            {HELP[i.key] && <p className="mt-1 text-xs text-ink-soft">{HELP[i.key]}</p>}
          </div>
          <div className="flex items-center gap-2">
            {i.needsCredentials ? <Badge tone="amber">Needs setup</Badge> : <Badge tone="brand">Ready</Badge>}
            {LINKS[i.key] && <Button size="sm" variant="outline" asChild><Link href={LINKS[i.key]}>Configure</Link></Button>}
          </div>
        </Card>
      ))}
    </div>
  );
}
