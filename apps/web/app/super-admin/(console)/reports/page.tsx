import { redirect } from 'next/navigation';

export default function ReportsRedirectPage() {
  redirect('/super-admin/chats?cat=reports');
}
