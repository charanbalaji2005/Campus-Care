'use client';

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/primitives';
import { ChatsCenter } from '@/components/chats/chats-center';

export default function SuperAdminChatsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[70vh]" />}>
      <ChatsCenter />
    </Suspense>
  );
}
