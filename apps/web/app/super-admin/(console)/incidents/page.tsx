'use client';

import { ShieldCheck } from 'lucide-react';
import { Alert, PageHeader } from '@/components/ui/primitives';
import { CaseQueue } from '@/components/shared/case-queue';

export default function AdminIncidentsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Incident triage" description="Route new reports to the right committee and keep deadlines on track." />
      <Alert tone="neutral" icon={<ShieldCheck className="h-4 w-4" />}>
        Triage access shows case number, category, status and deadlines only. Descriptions, evidence, reporter identity and the case conversation are visible to the assigned committee, unless the Super Admin has granted you sensitive-case access.
      </Alert>
      <CaseQueue scope="triage" basePath="/super-admin/incidents" />
    </div>
  );
}
