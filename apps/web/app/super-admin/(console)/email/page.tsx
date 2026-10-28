'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { ExternalLink, Info, KeyRound, Mail, Pencil, Plus, Send } from 'lucide-react';
import { MAIL_SERVICES, MAIL_SERVICE_LABELS, type MailService } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, Skeleton, SwitchRow } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { EmailTabs } from '@/components/super-admin/email-tabs';
import { EmailDiagnostics } from '@/components/super-admin/email-diagnostics';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

interface Provider { id: string; type: 'console' | 'nodemailer'; service: MailService; fromName: string; fromEmail: string; user: string | null; appPassword: string | null; active: boolean; updatedAt: string }
type Draft = { type: 'console' | 'nodemailer'; service: MailService; fromName: string; fromEmail: string; user: string; appPassword: string; active: boolean };
const EMPTY: Draft = { type: 'nodemailer', service: 'gmail', fromName: 'CampusCare', fromEmail: '', user: '', appPassword: '', active: true };

/** Where each service lets you create an app password (requires 2-step verification on the mailbox). */
const APP_PASSWORD_HELP: Record<MailService, { text: string; url?: string }> = {
  gmail: { text: 'Turn on 2-Step Verification for the Google account, then create an app password (16 characters). For Google Workspace, your admin must allow app passwords.', url: 'https://myaccount.google.com/apppasswords' },
  outlook365: { text: 'Your Microsoft 365 admin must allow SMTP AUTH for this mailbox; then create an app password under Security info.', url: 'https://mysignins.microsoft.com/security-info' },
  hotmail: { text: 'Turn on two-step verification, then create an app password under Advanced security options.', url: 'https://account.live.com/proofs/manage/additional' },
  yahoo: { text: 'Account security → Generate app password.', url: 'https://login.yahoo.com/account/security' },
  zoho: { text: 'My Account → Security → App passwords.', url: 'https://accounts.zoho.com/home#security/app_password' },
};

function NotificationSettings() {
  const s = useSectionDraft('notifications');
  if (!s.draft) return null;
  const d = s.draft;
  return (
    <SectionCard title="Email notifications" description="Which events send email in addition to in-app notifications. Security emails (verification, reset, sign-in alerts) are always sent." dirty={s.dirty} saving={s.saving} onSave={() => void s.save()} onDiscard={s.discard} onDefaults={s.resetToDefaults}>
      <SwitchRow id="n-case" label="Case status updates" description="Emails never include case details — only a link to sign in." checked={d.emailOnCaseUpdate} onCheckedChange={(v) => s.setDraft({ ...d, emailOnCaseUpdate: v })} />
      <SwitchRow id="n-msg" label="New case messages" checked={d.emailOnNewCaseMessage} onCheckedChange={(v) => s.setDraft({ ...d, emailOnNewCaseMessage: v })} />
      <SwitchRow id="n-rem" label="Appointment reminders" checked={d.emailAppointmentReminders} onCheckedChange={(v) => s.setDraft({ ...d, emailAppointmentReminders: v })} />
      <Field id="n-hours" label="Reminder lead time (hours)" className="mt-3 max-w-xs"><Input type="number" min={1} max={168} value={d.reminderHoursBefore} onChange={(e) => s.setDraft({ ...d, reminderHoursBefore: Number(e.target.value) })} /></Field>
    </SectionCard>
  );
}

export default function EmailProviderPage() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<{ providers: Provider[]; environmentFallback: { type: string; service: string | null; from: string | null } }>('/super-admin/email/providers');
  const [edit, setEdit] = React.useState<Provider | 'new' | null>(null);
  const [v, setV] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  function open(p: Provider | 'new') {
    setEdit(p);
    setV(p === 'new' ? EMPTY : { type: p.type, service: p.service ?? 'gmail', fromName: p.fromName, fromEmail: p.fromEmail === p.user ? '' : p.fromEmail, user: p.user ?? '', appPassword: '', active: p.active });
  }
  async function save() {
    setBusy(true);
    try {
      const body = { ...v, appPassword: v.appPassword || undefined, fromEmail: v.fromEmail || undefined, user: v.type === 'nodemailer' ? v.user : undefined };
      const r = await run(() => (edit === 'new' ? api.post('/super-admin/email/providers', body) : api.patch(`/super-admin/email/providers/${(edit as Provider).id}`, body)));
      if (r !== undefined) { toast.success('Email settings saved. Use “Test sign-in & send” to check them.'); setEdit(null); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    try {
      const r = await api.post<{ message: string }>('/super-admin/email/test');
      toast.success(r.message, { duration: 12000 });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  const active = data?.providers.find((p) => p.active);
  const sendingReal = active ? active.type === 'nodemailer' : data?.environmentFallback.type === 'nodemailer';
  const help = APP_PASSWORD_HELP[v.service];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Email" description="Verification, password reset, invitations, case updates and SOS emails are sent with Nodemailer through your university mailbox." actions={<Button variant="outline" loading={testing} onClick={test}><Send className="h-4 w-4" /> Test sign-in & send</Button>} />
      <EmailTabs />
      <div className="space-y-6">
        <EmailDiagnostics />
        <Card>
          <CardHeader title="Sending mailbox" description="Nodemailer signs in to this mailbox with an app password. Only one mailbox is active at a time." action={<Button size="sm" onClick={() => open('new')}><Plus className="h-4 w-4" /> Add mailbox</Button>} />
          {!data ? <div className="p-5"><Skeleton className="h-24" /></div> : (
            <div className="px-5 pb-5">
              {!data.providers.length && (
                <EmptyState
                  icon={<Mail className="h-6 w-6" />}
                  title="Using server environment settings"
                  description={data.environmentFallback.type === 'nodemailer' ? `Nodemailer · ${data.environmentFallback.service} · from ${data.environmentFallback.from ?? '—'}` : 'Development mode — emails are saved to the server’s dev mail folder, nothing is sent.'}
                />
              )}
              <ul className="divide-y divide-slate-100">
                {data.providers.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">{p.fromName} &lt;{p.fromEmail}&gt; {p.active && <Badge tone="brand">Active</Badge>}</p>
                      <p className="text-xs text-ink-soft">{p.type === 'nodemailer' ? `Nodemailer · ${MAIL_SERVICE_LABELS[p.service] ?? p.service} · signs in as ${p.user ?? '—'} · app password ${p.appPassword ?? 'not set'}` : 'Development only — not sent'} · updated {formatDateTime(p.updatedAt)}</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => open(p)} aria-label="Edit mailbox"><Pencil className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
              {!sendingReal && <Alert tone="amber" icon={<Info className="h-4 w-4" />} className="mt-3">No mailbox is connected, so emails are not delivered. Students will not receive verification links until you add one.</Alert>}
              {active?.service === 'gmail' && <Alert tone="neutral" icon={<Info className="h-4 w-4" />} className="mt-3">Gmail limits how much one account can send per day (about 500 for personal Gmail, about 2,000 for Google Workspace). Use a dedicated no-reply Workspace mailbox for a whole campus.</Alert>}
            </div>
          )}
        </Card>
        <NotificationSettings />
      </div>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent title={edit === 'new' ? 'Add sending mailbox' : 'Edit sending mailbox'} className="max-w-xl">
          <div className="space-y-4">
            <Field id="e-type" label="Mode"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as Draft['type'] })}><option value="nodemailer">Send with Nodemailer</option><option value="console">Development only (don’t send)</option></Select></Field>
            {v.type === 'nodemailer' && (
              <>
                <Field id="e-service" label="Mail service"><Select value={v.service} onChange={(e) => setV({ ...v, service: e.target.value as MailService })}>{MAIL_SERVICES.map((m) => <option key={m} value={m}>{MAIL_SERVICE_LABELS[m]}</option>)}</Select></Field>
                <Field id="e-user" label="Mailbox address" required hint="The account Nodemailer signs in to, e.g. campuscare-noreply@your-university.edu"><Input type="email" autoComplete="off" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} /></Field>
                <Field id="e-pass" label="App password" required={edit === 'new'} hint={edit !== 'new' ? 'Leave blank to keep the stored app password.' : 'Not your normal password. Spaces are ignored.'}><Input type="password" autoComplete="new-password" value={v.appPassword} onChange={(e) => setV({ ...v, appPassword: e.target.value })} /></Field>
                <Alert tone="neutral" icon={<KeyRound className="h-4 w-4" />}>
                  {help.text}{' '}
                  {help.url && <a href={help.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 underline">Open <ExternalLink className="h-3 w-3" /></a>}
                </Alert>
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="e-fname" label="From name" required><Input value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} /></Field>
              <Field id="e-femail" label="From address" hint={v.type === 'nodemailer' ? 'Optional — defaults to the mailbox. Gmail only allows a verified “Send mail as” alias.' : undefined} required={v.type === 'console'}><Input type="email" value={v.fromEmail} placeholder={v.user || undefined} onChange={(e) => setV({ ...v, fromEmail: e.target.value })} /></Field>
            </div>
            <SwitchRow id="e-active" label="Make this the active mailbox" checked={v.active} onCheckedChange={(x) => setV({ ...v, active: x })} />
            <p className="text-xs text-ink-soft">The app password is encrypted on the server and never shown again.</p>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
