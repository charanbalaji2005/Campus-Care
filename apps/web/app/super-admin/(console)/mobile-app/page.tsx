'use client';

import * as React from 'react';
import { AlertTriangle, CheckCircle2, Link2, Megaphone, Smartphone } from 'lucide-react';
import { Alert, Badge, Card, CardHeader, Field, Input, PageHeader, Select, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { SectionCard, useSectionDraft } from '@/components/super-admin/settings';

type AssetLinks = { target?: { package_name?: string; sha256_cert_fingerprints?: string[] } }[];

/** Checks the App Links file this website serves, so email links open the installed app. */
function AppLinksStatus() {
  const [links, setLinks] = React.useState<AssetLinks | null | 'error'>(null);
  React.useEffect(() => {
    fetch('/.well-known/assetlinks.json').then((r) => r.json()).then((j) => setLinks(j as AssetLinks)).catch(() => setLinks('error'));
  }, []);
  const entry = Array.isArray(links) ? links[0]?.target : undefined;
  return (
    <Card>
      <CardHeader title="Android App Links" description="Lets verification, password-reset, invitation and notification links open the app directly." />
      <div className="space-y-3 px-5 pb-5 text-sm">
        {links === null ? <Skeleton className="h-12" /> : entry?.package_name ? (
          <Alert tone="brand" icon={<CheckCircle2 className="h-4 w-4" />} title="Configured">
            Package <span className="font-mono">{entry.package_name}</span> · {entry.sha256_cert_fingerprints?.length ?? 0} signing certificate fingerprint(s).
          </Alert>
        ) : (
          <Alert tone="amber" icon={<AlertTriangle className="h-4 w-4" />} title="Not configured">
            Set <span className="font-mono">ANDROID_PACKAGE_NAME</span> and <span className="font-mono">ANDROID_CERT_SHA256</span> on the website server (and the API server), then redeploy. Until then, links open this website, which offers an &ldquo;Open the app&rdquo; button.
          </Alert>
        )}
        <p className="text-ink-soft"><Link2 className="mr-1 inline h-4 w-4" />Served at <span className="font-mono">/.well-known/assetlinks.json</span></p>
      </div>
    </Card>
  );
}

export default function MobileAppPage() {
  const m = useSectionDraft('mobile');
  const c = useSectionDraft('community');
  const d = m.draft;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title="Mobile app" description="Students and staff use the Android app. Everything on this page reaches installed apps the next time they open or resume — no new APK needed." />
      <Alert tone="neutral" icon={<Smartphone className="h-4 w-4" />}>
        Installed apps read this configuration from <span className="font-mono">/api/v1/mobile/config</span> and keep the last copy for offline use, so emergency numbers still show during an outage.
      </Alert>
      {!d ? <Skeleton className="h-72" /> : (
        <SectionCard title="Versions & updates" description="Version codes come from the APK build (the CI workflow uses the run number)." dirty={m.dirty} saving={m.saving} onSave={() => void m.save()} onDiscard={m.discard} onDefaults={m.resetToDefaults}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="m-min" label="Minimum supported version code" hint="Older apps must update before use."><Input type="number" min={1} value={d.minSupportedVersionCode} onChange={(e) => m.setDraft({ ...d, minSupportedVersionCode: Number(e.target.value) })} /></Field>
            <Field id="m-latest" label="Latest version code"><Input type="number" min={1} value={d.latestVersionCode} onChange={(e) => m.setDraft({ ...d, latestVersionCode: Number(e.target.value) })} /></Field>
            <Field id="m-name" label="Latest version name"><Input value={d.latestVersionName} placeholder="1.2.0" onChange={(e) => m.setDraft({ ...d, latestVersionName: e.target.value })} /></Field>
          </div>
          <Field id="m-url" label="Download link (https)" className="mt-4" hint="Play Store listing or the university's hosted APK. Also shown on this website's landing page.">
            <Input type="url" value={d.downloadUrl} placeholder="https://…" onChange={(e) => m.setDraft({ ...d, downloadUrl: e.target.value })} />
          </Field>
          <Field id="m-msg" label="Update message" className="mt-4"><Textarea rows={2} value={d.updateMessage} onChange={(e) => m.setDraft({ ...d, updateMessage: e.target.value })} /></Field>
          {d.minSupportedVersionCode > d.latestVersionCode && <Alert tone="rose" className="mt-3">The minimum version is higher than the latest version — every app would be locked out.</Alert>}
          {d.downloadUrl && !d.downloadUrl.startsWith('https://') && <Alert tone="amber" className="mt-3">Use an https:// link.</Alert>}
        </SectionCard>
      )}
      {d && (
        <SectionCard title="In-app banner" description="Shown at the top of every signed-in screen — for planned downtime or important notices. Use campus alerts for emergencies." dirty={m.dirty} saving={m.saving} onSave={() => void m.save()} onDiscard={m.discard}>
          <Field id="m-banner" label="Banner message" hint="Leave empty to hide the banner."><Textarea rows={2} value={d.bannerMessage} onChange={(e) => m.setDraft({ ...d, bannerMessage: e.target.value })} /></Field>
          <Field id="m-sev" label="Style" className="mt-4"><Select value={d.bannerSeverity} onChange={(e) => m.setDraft({ ...d, bannerSeverity: e.target.value as typeof d.bannerSeverity })}><option value="info">Information</option><option value="warning">Warning</option><option value="critical">Critical</option></Select></Field>
          {d.bannerMessage && <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-white p-3 text-sm"><Megaphone className="h-4 w-4 text-brand-700" /> Preview: {d.bannerMessage} <Badge tone={d.bannerSeverity === 'critical' ? 'rose' : d.bannerSeverity === 'warning' ? 'amber' : 'brand'}>{d.bannerSeverity}</Badge></div>}
        </SectionCard>
      )}
      {c.draft && (
        <SectionCard title="App features" description="Community tools in the app." dirty={c.dirty} saving={c.saving} onSave={() => void c.save()} onDiscard={c.discard} onDefaults={c.resetToDefaults}>
          <SwitchRow id="c-lf" label="Lost & found" checked={c.draft.lostFoundEnabled} onCheckedChange={(v) => c.setDraft({ ...c.draft!, lostFoundEnabled: v })} />
          <SwitchRow id="c-sg" label="Anonymous safety suggestions" checked={c.draft.suggestionsEnabled} onCheckedChange={(v) => c.setDraft({ ...c.draft!, suggestionsEnabled: v })} />
          <SwitchRow id="c-hz" label="Hazard reports" description="Students report poor lighting, broken infrastructure and unsafe spots; moderators verify before they appear on the map." checked={c.draft.hazardReportsEnabled} onCheckedChange={(v) => c.setDraft({ ...c.draft!, hazardReportsEnabled: v })} />
        </SectionCard>
      )}
      <AppLinksStatus />
    </div>
  );
}
