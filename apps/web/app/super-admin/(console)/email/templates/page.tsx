'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Eye, RotateCcw, Save } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { humanize } from '@/lib/utils';
import { useSensitiveAction } from '@/components/providers';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmailTabs } from '@/components/super-admin/email-tabs';
import { cn } from '@/lib/utils';

interface Template { key: string; customised: boolean; subject: string; html: string; text: string }

export default function EmailTemplatesPage() {
  const run = useSensitiveAction();
  const { data, mutate } = useApi<Template[]>('/super-admin/email/templates');
  const [key, setKey] = React.useState<string | null>(null);
  const [v, setV] = React.useState({ subject: '', html: '', text: '' });
  const [preview, setPreview] = React.useState<{ subject: string; html: string; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [reset, setReset] = React.useState(false);
  const current = data?.find((t) => t.key === key) ?? null;

  React.useEffect(() => { if (data && !key && data[0]) setKey(data[0].key); }, [data, key]);
  React.useEffect(() => { if (current) { setV({ subject: current.subject, html: current.html, text: current.text }); setPreview(null); } }, [current]);

  async function doPreview() {
    try {
      setPreview(await api.post(`/super-admin/email/templates/${key}/preview`, v));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await run(() => api.put(`/super-admin/email/templates/${key}`, v));
      if (r !== undefined) { toast.success('Template saved'); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function doReset() {
    setBusy(true);
    try {
      const r = await run(() => api.delete(`/super-admin/email/templates/${key}`));
      if (r !== undefined) { toast.success('Reset to default'); setReset(false); void mutate(); }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Email" />
      <EmailTabs />
      {!data ? <Skeleton className="h-96" /> : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit p-2">
            {data.map((t) => (
              <button key={t.key} onClick={() => setKey(t.key)} className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', key === t.key ? 'bg-mint font-medium text-forest' : 'hover:bg-slate-50')}>
                {humanize(t.key)}{t.customised && <Badge tone="amber">Edited</Badge>}
              </button>
            ))}
          </Card>
          {current && (
            <div className="space-y-4">
              <Alert tone="neutral">Placeholders such as <code>{'{{name}}'}</code>, <code>{'{{link}}'}</code>, <code>{'{{platformName}}'}</code> and <code>{'{{caseNumber}}'}</code> are filled in when sending and HTML-escaped. Never add case details or personal information to templates — emails should point people back to the secure portal.</Alert>
              <Card className="space-y-4 p-5">
                <Field id="t-subj" label="Subject"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
                <Field id="t-html" label="HTML body"><Textarea rows={12} className="font-mono text-xs" value={v.html} onChange={(e) => setV({ ...v, html: e.target.value })} /></Field>
                <Field id="t-text" label="Plain-text body"><Textarea rows={6} className="font-mono text-xs" value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
                <div className="flex flex-wrap justify-end gap-2">
                  {current.customised && <Button variant="ghost" onClick={() => setReset(true)}><RotateCcw className="h-4 w-4" /> Reset to default</Button>}
                  <Button variant="outline" onClick={doPreview}><Eye className="h-4 w-4" /> Preview</Button>
                  <Button loading={busy} onClick={save}><Save className="h-4 w-4" /> Save</Button>
                </div>
              </Card>
              {preview && (
                <Card className="overflow-hidden">
                  <div className="border-b border-slate-100 px-5 py-3 text-sm"><span className="text-ink-soft">Subject:</span> <strong>{preview.subject}</strong></div>
                  {/* Sandboxed with no permissions: template HTML can never run scripts in the console. */}
                  <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-96 w-full bg-white" />
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={reset} onOpenChange={setReset} title="Reset this template?" description="Your customised version will be deleted and the built-in default used." destructive confirmLabel="Reset" loading={busy} onConfirm={doReset} />
    </div>
  );
}
