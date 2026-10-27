'use client';

import * as React from 'react';
import { HeartHandshake, Lock, Sparkles, Stethoscope } from 'lucide-react';
import { PageHeader, Alert } from '@/components/ui/primitives';
import { UserManager } from '@/components/admin/user-manager';

export default function CounsellorsPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Counsellors & Wellbeing Staff Management"
        description="Verify institutional credentials, manage counselling availability, approve official mental health channel publishing rights, and oversee psychological support services."
      />

      <Alert
        tone="neutral"
        icon={<Lock className="h-5 w-5 text-purple-600" />}
        title="Zero-Trust Clinical Confidentiality Sealed Boundary"
        className="border-purple-200 bg-purple-50/40"
      >
        <p className="text-xs text-purple-900 leading-relaxed">
          Super Admin oversight of counsellors is strictly operational (slot management, verified status, and official channel authorization).
          <strong>Private counselling conversation transcripts and clinical therapy session notes are sealed by default</strong> and cannot be
          inspected through general administrative queues.
        </p>
      </Alert>

      <UserManager
        superAdmin
        initialRole="counsellor"
        lockRole
        hideStats
        roleTitle="Verified Counsellors"
        roleSubtitle="Licensed psychological support staff & student wellbeing mentors"
      />
    </div>
  );
}
