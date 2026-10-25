'use client';

import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { AuthShell } from '@/components/layout/auth-shell';
import { Button } from '@/components/ui/primitives';
import { useMe } from '@/lib/hooks';

export default function UnauthorizedPage() {
  const { data: me } = useMe();
  return (
    <AuthShell title="Access denied" subtitle="Your account doesn’t have permission to open that page.">
      <div className="card p-8 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-amber-600" />
        <p className="mt-4 text-sm text-ink">If you believe you need access, ask your administrator. Access is granted by role and committee membership.</p>
        <Button asChild className="mt-6 w-full"><Link href={me?.homePath ?? '/login'}>{me ? 'Go to my portal' : 'Sign in'}</Link></Button>
      </div>
    </AuthShell>
  );
}
