'use client';

import Link from 'next/link';
import { Download, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { usePublicSettings } from '@/lib/hooks';

const PACKAGE = process.env.NEXT_PUBLIC_ANDROID_PACKAGE_NAME || 'in.edu.srmap.campuscare';

/**
 * Students and staff use the Android app; the website is the Super Admin console. This card hands
 * a visitor over to the app: it opens the installed app at the same path (Android intent link) or
 * falls back to the download page the Super Admin configured.
 */
export function AppHandoff({ path, message, showAdminLink = true }: { path?: string; message?: string; showAdminLink?: boolean }) {
  const { data: settings } = usePublicSettings();
  const download = settings?.mobile?.downloadUrl || '';
  const target = (path ?? '/').replace(/^\/+/, '');
  const host = typeof window !== 'undefined' ? window.location.host : '';
  const fallback = download ? `;S.browser_fallback_url=${encodeURIComponent(download)}` : '';
  const intent = `intent://${host}/${target}#Intent;scheme=https;package=${PACKAGE}${fallback};end`;
  return (
    <div className="card space-y-4 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><Smartphone className="h-7 w-7" /></div>
      <div>
        <h2 className="text-lg font-semibold text-ink-strong">Continue in the CampusCare app</h2>
        <p className="mt-1 text-sm text-ink-soft">{message ?? 'Students and staff use the CampusCare Android app for reports, SOS, counselling, chat and case work.'}</p>
      </div>
      <Button asChild size="lg" className="w-full"><a href={intent}><Smartphone className="h-4 w-4" /> Open the app</a></Button>
      {download ? (
        <Button asChild size="lg" variant="outline" className="w-full"><a href={download} rel="noopener"><Download className="h-4 w-4" /> Download for Android{settings?.mobile?.latestVersionName ? ` (v${settings.mobile.latestVersionName})` : ''}</a></Button>
      ) : (
        <p className="text-xs text-ink-soft">Ask your university IT office for the app download link.</p>
      )}
      {showAdminLink && (
        <p className="pt-2 text-xs text-ink-soft"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Super Admin? <Link href="/super-admin/login" className="font-semibold text-brand-700 underline">Sign in to the console</Link></p>
      )}
    </div>
  );
}
