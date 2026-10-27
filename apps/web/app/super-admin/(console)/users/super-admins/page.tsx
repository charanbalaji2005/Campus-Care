'use client';

import * as React from 'react';
import { Crown, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader, Alert } from '@/components/ui/primitives';
import { UserManager } from '@/components/admin/user-manager';

export default function SuperAdminsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Super Admin Privileged Account Inventory"
        description="Oversee accounts with root-level ecosystem control. Enforce mandatory multi-factor authentication (MFA), audit privileged operations, and inspect cryptographic session validity."
      />

      <Alert
        tone="amber"
        icon={<Crown className="h-5 w-5 text-amber-700" />}
        title="Privileged Account Governance & Last Admin Safeguard"
        className="border-amber-200 bg-amber-50/50"
      >
        <p className="text-xs text-amber-900 leading-relaxed">
          Super Admins possess highest-tier platform privileges. In adherence to fail-safe security standards,
          <strong> the last active Super Admin account is cryptographically and logically protected</strong> — it cannot be self-demoted,
          suspended, or deleted without designating and verifying another active Super Admin account first.
        </p>
      </Alert>

      <UserManager
        superAdmin
        initialRole="super_admin"
        lockRole
        hideStats
        roleTitle="Active Super Administrators"
        roleSubtitle="Root governance custodians with ecosystem-wide administrative privileges"
      />
    </div>
  );
}
