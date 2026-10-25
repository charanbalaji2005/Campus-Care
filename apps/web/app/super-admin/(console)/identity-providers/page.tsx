'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Copy, Info } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Skeleton, SwitchRow } from '@/components/ui/primitives';

interface Provider { provider: 'google'; enabled: boolean; clientId: string; clientSecret: string | null; allowedDomains: string[]; redirectUri: string; authorizedOrigin: string }

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-soft">{label}</p>
      <div className="mt-1 flex items-center gap-2"><code className="flex-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs ring-1 ring-slate-200">{value}</code><Button size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(value); toast.success('Copied'); }} aria-label={`Copy ${label}`}><Copy className="h-4 w-4" /></Button></div>
    </div>
  );
}

export default function IdentityProvidersPage() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<Provider[]>('/super-admin/identity-providers');
  const g = data?.[0];
  const [v, setV] = React.useState({ enabled: false, clientId: '', clientSecret: '', allowedDomains: '' });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (g) setV({ enabled: g.enabled, clientId: g.clientId, clientSecret: '', allowedDomains: g.allowedDomains.join(', ') }); }, [g]);
  if (!g) return <Skeleton className="h-96" />;

  async function save() {
    setBusy(true);
    try {
      const r = await run(() => api.patch('/super-admin/identity-providers/google', {
        enabled: v.enabled, clientId: v.clientId, clientSecret: v.clientSecret || undefined,
        allowedDomains: v.allowedDomains.split(',').map((d) => d.trim().replace(/^@/, '')).filter(Boolean),
      }));
      if (r !== undefined) { toast.success('Google sign-in settings saved'); setV({ ...v, clientSecret: '' }); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Sign-in providers" description="Email + password is always available. Add Google sign-in for university Google Workspace accounts." />
      <Card>
        <CardHeader title={<span className="flex items-center gap-2">Google OAuth 2.0 {g.enabled ? <Badge tone="brand">Enabled</Badge> : <Badge>Disabled</Badge>}</span>} description="Authorization Code flow with PKCE and state. Accounts are never linked automatically by email." />
        <div className="space-y-4 px-5 pb-5">
          <CopyRow label="Authorized redirect URI (add in Google Cloud Console)" value={g.redirectUri} />
          <CopyRow label="Authorized JavaScript origin" value={g.authorizedOrigin} />
          <Field id="g-id" label="Client ID"><Input value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} placeholder="xxxxxxxx.apps.googleusercontent.com" /></Field>
          <Field id="g-secret" label="Client secret" hint={g.clientSecret ? `Currently ${g.clientSecret}. Leave blank to keep it.` : 'Not set.'}><Input type="password" autoComplete="off" value={v.clientSecret} onChange={(e) => setV({ ...v, clientSecret: e.target.value })} /></Field>
          <Field id="g-domains" label="Allowed Google domains (hd)" hint="Comma-separated. Leave empty to rely on the approved email domains list."><Input value={v.allowedDomains} onChange={(e) => setV({ ...v, allowedDomains: e.target.value })} placeholder="university.edu.in" /></Field>
          <SwitchRow id="g-enabled" label="Show “Continue with Google”" checked={v.enabled} onCheckedChange={(x) => setV({ ...v, enabled: x })} />
          <Alert tone="neutral" icon={<Info className="h-4 w-4" />}>The secret is encrypted at rest and never sent back to the browser. Google users must still use an approved domain; privileged accounts must link Google from Account security after signing in with their password.</Alert>
          <div className="flex justify-end"><Button loading={busy} onClick={save}>Save</Button></div>
        </div>
      </Card>
    </div>
  );
}
