'use client';

import * as React from 'react';
import { Building2, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader, Card } from '@/components/ui/primitives';
import { UserManager } from '@/components/admin/user-manager';

export default function CampusAdminsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Campus Administrators Management"
        description="Oversee administrative officers responsible for day-to-day campus operations, student conduct inquiries, incident triage routing, and safety duty coordination within their authorized campus scope."
      />

      <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 text-xs text-forest flex items-start gap-3">
        <Building2 className="h-5 w-5 shrink-0 text-brand-700 mt-0.5" />
        <div>
          <p className="font-bold text-sm text-ink-strong">Campus Admin Scope & Boundaries</p>
          <p className="text-ink-soft mt-0.5 leading-relaxed">
            Campus Admins manage local campus operations, students, and safety officers. They are strictly restricted from global platform
            configuration, database administration, and system-wide security settings. They cannot inspect confidential counselling notes
            or private chat records without explicit break-glass warrants.
          </p>
        </div>
      </div>

      <UserManager
        superAdmin
        initialRole="admin"
        lockRole
        hideStats
        roleTitle="Campus Administrators"
        roleSubtitle="Authorized operational managers across SRM University-AP campuses"
      />
    </div>
  );
}
