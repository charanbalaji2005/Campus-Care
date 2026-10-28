import { redirect } from 'next/navigation';

/** Deep links to a single report open it inside Chats › Reports. */
export default async function AdminCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/super-admin/chats?cat=reports&r=${encodeURIComponent(id)}`);
}
