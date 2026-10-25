'use client';

import { PageHeader } from '@/components/ui/primitives';
import { UserManager } from '@/components/admin/user-manager';

export default function SuperAdminUsersPage() {
  return (
    <div>
      <PageHeader title="Users" description="All accounts, including administrators. Role changes, session revocation and two-step resets require you to confirm your password." />
      <UserManager superAdmin />
    </div>
  );
}
