'use client';

import { useParams } from 'next/navigation';
import { CaseWorkspace } from '@/components/case/case-workspace';

export default function AdminCasePage() {
  const { id } = useParams<{ id: string }>();
  return <CaseWorkspace caseId={id} backHref="/super-admin/incidents" />;
}
