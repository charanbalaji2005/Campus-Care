import { redirect } from 'next/navigation';

/** The reports inbox moved into Chats › Reports. Old links keep working. */
export default function AdminIncidentsPage() {
  redirect('/super-admin/chats?cat=reports');
}
