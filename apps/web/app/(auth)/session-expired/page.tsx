'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Clock } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/primitives';

export default function SessionExpiredPage() {
  const next = useSearchParams().get('next') ?? '';
  return (
    <AuthShell title="Session expired" subtitle="For your security you were signed out after a period of inactivity.">
      <div className="card p-8 text-center">
        <Clock className="mx-auto h-12 w-12 text-brand-600" />
        <p className="mt-4 text-sm text-ink">Sign in again to continue where you left off.</p>
        <Button asChild className="mt-6 w-full"><Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in again</Link></Button>
      </div>
    </AuthShell>
  );
}
