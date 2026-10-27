'use client';

import * as React from 'react';
import { Radio, ShieldAlert, Siren } from 'lucide-react';
import { PageHeader, Alert } from '@/components/ui/primitives';
import { UserManager } from '@/components/admin/user-manager';

export default function OfficersPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Safety Officers & Duty Officers Management"
        description="Verify security staff credentials, assign campus duty zones, authorize emergency SOS response capabilities, and track responder certifications (First Aid, CPR, Fire Safety, Crowd Control)."
      />

      <div className="rounded-2xl border border-rose-200 bg-rose-50/30 p-4 text-xs text-rose-950 flex items-start gap-3">
        <Siren className="h-5 w-5 shrink-0 text-rose-600 mt-0.5" />
        <div>
          <p className="font-bold text-sm text-ink-strong">Emergency Ground Response Protocol</p>
          <p className="text-ink-soft mt-0.5 leading-relaxed">
            Officers on duty receive instant push notifications and GPS location breadcrumbs of students who trigger an active SOS or request a Safe Walk.
            Location tracking strictly terminates upon alert resolution. Officers can toggle duty status (On duty, Off duty, On break, Responding) directly
            from their dedicated mobile app console.
          </p>
        </div>
      </div>

      <UserManager
        superAdmin
        initialRole="security_officer"
        lockRole
        hideStats
        roleTitle="Active Safety Officers"
        roleSubtitle="Campus security personnel, patrol officers, and emergency dispatch responders"
      />
    </div>
  );
}
