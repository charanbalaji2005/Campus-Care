'use client';

import { usePathname } from 'next/navigation';
import { AuthShell } from '@/components/layout/auth-shell';
import { AppHandoff } from '@/components/app-handoff';

/**
 * Former student/staff web pages. Links to them still appear in older emails and notifications;
 * with Android App Links verified they open the app directly, otherwise this page hands over.
 */
export function AppOnlyPage() {
  const path = usePathname();
  return (
    <AuthShell title="This opens in the app" subtitle="CampusCare for students and staff is now an Android app. The website is used only by the Super Admin.">
      <AppHandoff path={path} />
    </AuthShell>
  );
}
