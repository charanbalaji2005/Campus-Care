'use client';

import * as React from 'react';
import { IamNav } from '@/components/admin/iam-nav';

export default function UsersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <IamNav />
      {children}
    </div>
  );
}
