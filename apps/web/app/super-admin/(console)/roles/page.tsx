'use client';

import { Check, Lock } from 'lucide-react';
import { ROLE_LABELS, ROLES, type Role } from '@campuscare/shared';
import { useApi } from '@/lib/hooks';
import { Alert, Badge, Card, PageHeader, Skeleton } from '@/components/ui/primitives';

interface RolesData { roles: Record<Role, string[]>; permissions: string[]; explicitOnly: string[] }

export default function RolesPage() {
  const { data } = useApi<RolesData>('/super-admin/roles');
  return (
    <div className="space-y-4">
      <PageHeader title="Roles & permissions" description="Built-in roles and what each one can do. Grant extra permissions to an individual from Users → Role & permissions." />
      <Alert tone="neutral" icon={<Lock className="h-4 w-4" />}>Permissions marked <Badge tone="rose">explicit</Badge> are never part of any role — not even Super Admin. They unlock confidential case content or counselling notes and must be granted to a named person with a recorded reason.</Alert>
      {!data ? <Skeleton className="h-96" /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr><th className="px-4 py-3">Permission</th>{ROLES.map((r) => <th key={r} className="px-3 py-3 text-center">{ROLE_LABELS[r]}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.permissions.map((p) => (
                <tr key={p} className="hover:bg-mint/30">
                  <td className="px-4 py-2 font-mono text-xs">{p} {data.explicitOnly.includes(p) && <Badge tone="rose">explicit</Badge>}</td>
                  {ROLES.map((r) => <td key={r} className="px-3 py-2 text-center">{data.roles[r]?.includes(p) ? <Check className="mx-auto h-4 w-4 text-brand-700" aria-label="Granted" /> : <span className="text-slate-300" aria-label="Not granted">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
