'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Bell, Camera, FileClock, History, KeyRound, Lock, LogOut, Monitor, ShieldAlert, ShieldCheck, Smartphone, Trash2, UserCog,
} from 'lucide-react';
import { PROFILE_LANGUAGES, ROLE_LABELS, profileUpdateSchema } from '@campuscare/shared';
import { api, ApiError } from '@/lib/api';
import { useApi, useMe } from '@/lib/hooks';
import { useForm } from '@/lib/form';
import { formatDateTime, humanize, timeAgo } from '@/lib/utils';
import { Alert, Avatar, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';

interface Activity { action: string; at: string; outcome?: string | null; targetType?: string | null }
interface ProfileOverview {
  account: { emailVerified: boolean; mfaEnabled: boolean; mfaRequired: boolean; activeSessions: number; googleLinked: boolean; lastLoginAt: string | null; passwordChangedAt: string | null; memberSince: string | null };
  admin?: { scope: 'system' | 'campus'; managedCampuses: string[]; permissions: string[]; extraPermissions: string[]; recentActivity: Activity[]; securityActivity: Activity[] };
}
interface SessionRow { id: string; current: boolean; createdAt: string; lastSeenAt: string; userAgent: string | null; method: string; client?: string; deviceName?: string | null }
type Prefs = Record<string, { inApp: boolean; email: boolean; push: boolean }>;
interface ProfileUser {
  id: string; fullName: string; email: string; emailVerified: boolean; role: keyof typeof ROLE_LABELS; accountStatus: string; phone: string | null;
  staffId?: string | null; designation?: string | null; preferredLanguage?: string | null; avatarUpdatedAt?: string | null; mfaEnabled: boolean;
}

const PREF_LABELS: Record<string, string> = {
  case_updates: 'Report & case updates', chat_messages: 'Messages', appointments: 'Counselling sessions',
  announcements: 'Announcements', training: 'Awareness training', community: 'Community',
};

/** Groups "area:action" permissions by area for a compact read-only summary. */
function groupPermissions(perms: string[]) {
  const groups = new Map<string, string[]>();
  for (const p of perms) {
    const [area, action = ''] = p.split(':');
    groups.set(area!, [...(groups.get(area!) ?? []), action]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** Resizes a picked image to at most 512 px and re-encodes it as JPEG before upload. */
async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', 0.85));
}

export default function SuperAdminProfilePage() {
  const router = useRouter();
  const { data: me, mutate: mutateMe } = useMe();
  const { data: overview, mutate: mutateOverview } = useApi<ProfileOverview>('/me/profile');
  const { data: sessions, mutate: mutateSessions } = useApi<SessionRow[]>('/auth/sessions');
  const { data: prefs, mutate: mutatePrefs } = useApi<Prefs>('/me/notification-prefs');
  const user = me?.user as ProfileUser | undefined;

  if (!user) return <Skeleton className="h-[32rem]" />;
  const admin = overview?.admin;

  async function signOut(everywhere: boolean) {
    if (everywhere && !window.confirm('Sign out of every device, including this one?')) return;
    await api.post(everywhere ? '/auth/logout-all' : '/auth/logout').catch(() => undefined);
    router.replace('/super-admin/login');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="My profile" description="Your personal details, account security and preferences. Platform-wide settings live in their own sections." />

      <ProfileHeader user={user} account={overview?.account} onChanged={() => { void mutateMe(); }} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PersonalInfo user={user} onSaved={() => { void mutateMe(); void mutateOverview(); }} />

        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><UserCog className="h-4 w-4" /> Role & permissions</span>} description="Read-only summary of what this account can do." />
          <div className="space-y-4 p-5 pt-0">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Detail label="Role" value={ROLE_LABELS[user.role]} />
              <Detail label="Authorised scope" value={admin ? (admin.scope === 'system' ? 'Whole system — every campus' : admin.managedCampuses.join(', ') || 'Main campus') : '—'} />
            </div>
            {admin ? (
              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line p-3">
                {groupPermissions(admin.permissions).map(([area, actions]) => (
                  <div key={area} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="w-36 shrink-0 font-semibold text-ink-strong">{humanize(area)}</span>
                    {actions.map((a) => <Badge key={a} tone={admin.extraPermissions.includes(`${area}:${a}`) ? 'amber' : 'neutral'}>{humanize(a)}</Badge>)}
                  </div>
                ))}
              </div>
            ) : <Skeleton className="h-40" />}
            <Alert tone="neutral" icon={<ShieldAlert className="h-4 w-4" />}>
              High-risk permissions are changed only in <Link href="/super-admin/roles" className="font-semibold text-brand-700 underline">Roles & Permissions</Link> and <Link href="/super-admin/users/super-admins" className="font-semibold text-brand-700 underline">Super Admins</Link>, where every change is audited.
            </Alert>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Password & two-step verification</span>} />
          <div className="divide-y divide-line px-5 pb-3">
            <SettingRow
              icon={<Smartphone className="h-4 w-4" />} title="Authenticator app (MFA)"
              detail={user.mfaEnabled ? 'On — codes are required at sign-in.' : overview?.account.mfaRequired ? 'Required for Super Admins — set it up now.' : 'Off'}
              badge={<Badge tone={user.mfaEnabled ? 'brand' : 'rose'}>{user.mfaEnabled ? 'On' : 'Off'}</Badge>}
              action={<Button asChild size="sm" variant="outline"><Link href="/super-admin/authenticator">Manage</Link></Button>}
            />
            <SettingRow
              icon={<KeyRound className="h-4 w-4" />} title="Password"
              detail={overview?.account.passwordChangedAt ? `Last changed ${timeAgo(overview.account.passwordChangedAt)}` : 'Change your password'}
              action={<Button asChild size="sm" variant="outline"><Link href="/account/security">Change</Link></Button>}
            />
            <SettingRow
              icon={<Lock className="h-4 w-4" />} title="Email verification"
              detail={user.email}
              badge={<Badge tone={user.emailVerified ? 'brand' : 'amber'}>{user.emailVerified ? 'Verified' : 'Not verified'}</Badge>}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Monitor className="h-4 w-4" /> Active sessions</span>}
            description={overview ? `${overview.account.activeSessions} signed in · last sign-in ${formatDateTime(overview.account.lastLoginAt)}` : undefined}
          />
          <div className="divide-y divide-line px-5 pb-3">
            {!sessions && <Skeleton className="my-3 h-24" />}
            {sessions?.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-strong">{s.deviceName ?? (s.client === 'android' ? 'Android phone' : s.userAgent?.slice(0, 60) ?? 'Web browser')}</p>
                  <p className="text-xs text-ink-soft">{s.current ? 'This device · ' : ''}Active {timeAgo(s.lastSeenAt)} · {humanize(s.method)}</p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="danger-outline" onClick={async () => {
                    try { await api.delete(`/auth/sessions/${s.id}`); toast.success('Session signed out.'); void mutateSessions(); void mutateOverview(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not sign out that session.'); }
                  }}>Revoke</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityCard
          title="Login & security activity" icon={<History className="h-4 w-4" />} items={admin?.securityActivity}
          empty="No sign-in or security events recorded yet."
        />
        <ActivityCard
          title="Recent administrative activity" icon={<FileClock className="h-4 w-4" />} items={admin?.recentActivity}
          empty="No administrative actions yet."
          action={<Button asChild size="sm" variant="outline"><Link href="/super-admin/audit-logs">Open audit logs</Link></Button>}
        />
      </div>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Bell className="h-4 w-4" /> Notification preferences</span>} description="Critical safety and security alerts are always delivered." />
        <div className="overflow-x-auto px-5 pb-5">
          {!prefs ? <Skeleton className="h-40" /> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-ink-soft"><th className="py-2 font-medium">Category</th><th className="font-medium">In app</th><th className="font-medium">Email</th><th className="font-medium">Push</th></tr></thead>
              <tbody className="divide-y divide-line">
                {Object.keys(PREF_LABELS).map((k) => (
                  <tr key={k}>
                    <td className="py-2.5 font-medium text-ink-strong">{PREF_LABELS[k]}</td>
                    {(['inApp', 'email', 'push'] as const).map((ch) => (
                      <td key={ch}>
                        <input
                          type="checkbox" aria-label={`${PREF_LABELS[k]} — ${ch}`} className="h-4 w-4 accent-[var(--color-brand-600,#16a34a)]"
                          checked={prefs[k]?.[ch] ?? true}
                          onChange={async (e) => {
                            const next = { ...prefs, [k]: { ...(prefs[k] ?? { inApp: true, email: true, push: true }), [ch]: e.target.checked } };
                            void mutatePrefs(next, false);
                            try { await api.put('/me/notification-prefs', next); toast.success('Preference saved.'); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not save.'); void mutatePrefs(); }
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold text-ink-strong">Sign out</p>
          <p className="text-sm text-ink-soft">Signing out everywhere ends every session on every device, including this one.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void signOut(false)}><LogOut className="h-4 w-4" /> Sign out</Button>
          <Button variant="danger-outline" onClick={() => void signOut(true)}>Sign out everywhere</Button>
        </div>
      </Card>
    </div>
  );
}

function Detail({ label, value, locked }: { label: string; value: React.ReactNode; locked?: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-xs font-medium text-ink-soft">{label}{locked && <Lock className="h-3 w-3" aria-label="Verified — not editable here" />}</p>
      <p className="mt-0.5 break-words text-sm font-semibold text-ink-strong">{value || '—'}</p>
    </div>
  );
}

function SettingRow({ icon, title, detail, badge, action }: { icon: React.ReactNode; title: string; detail: string; badge?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-forest">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink-strong">{title} {badge}</p>
        <p className="truncate text-xs text-ink-soft">{detail}</p>
      </div>
      {action}
    </div>
  );
}

function ActivityCard({ title, icon, items, empty, action }: { title: string; icon: React.ReactNode; items?: Activity[]; empty: string; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{icon} {title}</span>} action={action} />
      <ul className="divide-y divide-line px-5 pb-3">
        {!items && <Skeleton className="my-3 h-24" />}
        {items?.length === 0 && <li className="py-3 text-sm text-ink-soft">{empty}</li>}
        {items?.map((e, i) => (
          <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="text-ink-strong">{humanize(e.action.replace(/[.:]/g, ' '))}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-ink-soft">
              {e.outcome && e.outcome !== 'success' && <Badge tone="rose">{humanize(e.outcome)}</Badge>}
              {formatDateTime(e.at)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProfileHeader({ user, account, onChanged }: { user: ProfileUser; account?: ProfileOverview['account']; onChanged: () => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', await preparePhoto(file), 'avatar.jpg');
      await api.put('/me/avatar', form);
      toast.success('Profile photo updated.');
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That image could not be used. Try a JPG or PNG.');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try { await api.delete('/me/avatar'); toast.success('Profile photo removed.'); onChanged(); } catch (err) { toast.error(err instanceof ApiError ? err.message : 'Could not remove the photo.'); }
  }

  return (
    <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
      <div className="relative h-20 w-20 shrink-0">
        {user.avatarUpdatedAt
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/api/v1/me/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`} alt="Profile photo" className="h-20 w-20 rounded-full object-cover ring-2 ring-brand-600/20" />
          : <Avatar name={user.fullName} className="h-20 w-20 text-xl ring-2 ring-brand-600/20" />}
        <button
          type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Change profile photo"
          className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-forest text-white shadow hover:bg-forest-700 disabled:opacity-60"
        ><Camera className="h-4 w-4" /></button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold text-ink-strong">{user.fullName}</h2>
        <p className="text-sm text-ink-soft">{user.designation || ROLE_LABELS[user.role]} · All campuses</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={user.emailVerified ? 'brand' : 'amber'}>{user.emailVerified ? 'Email verified' : 'Email not verified'}</Badge>
          <Badge tone={user.mfaEnabled ? 'brand' : 'rose'}>{user.mfaEnabled ? 'MFA on' : 'MFA off'}</Badge>
          <Badge tone={user.accountStatus === 'active' ? 'neutral' : 'amber'}>{humanize(user.accountStatus)}</Badge>
          {account?.memberSince && <Badge>Member since {new Date(account.memberSince).getFullYear()}</Badge>}
        </div>
      </div>
      {user.avatarUpdatedAt && <Button variant="ghost" size="sm" onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Remove photo</Button>}
    </Card>
  );
}

function PersonalInfo({ user, onSaved }: { user: ProfileUser; onSaved: () => void }) {
  const initial = { fullName: user.fullName, phone: user.phone ?? '', designation: user.designation ?? '', preferredLanguage: (user.preferredLanguage ?? 'English') as (typeof PROFILE_LANGUAGES)[number] };
  const form = useForm(profileUpdateSchema, initial);
  const [editing, setEditing] = React.useState(false);

  function cancel() {
    form.setValues(initial);
    form.setErrors({});
    setEditing(false);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    await form.submit(async (d) => {
      await api.patch('/auth/me', d);
      toast.success('Profile updated.');
      setEditing(false);
      onSaved();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Personal information"
        description="Verified items (padlock) change only through Super Admin user management."
        action={!editing && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}
      />
      <div className="space-y-4 p-5 pt-0">
        <div className="grid grid-cols-2 gap-3">
          <Detail label="Official email" value={user.email} locked />
          <Detail label="Administrator ID" value={user.staffId || user.id.slice(-8).toUpperCase()} locked />
        </div>
        {editing ? (
          <form onSubmit={save} className="space-y-3" noValidate>
            <Field id="fullName" label="Full name" error={form.errors.fullName} required><Input {...form.bind('fullName')} id="fullName" autoComplete="name" /></Field>
            <Field id="phone" label="Phone" error={form.errors.phone} hint="Optional. Used by the control room to reach you."><Input {...form.bind('phone')} id="phone" type="tel" autoComplete="tel" /></Field>
            <Field id="designation" label="Designation" error={form.errors.designation}><Input {...form.bind('designation')} id="designation" placeholder="e.g. Director, Student Welfare" /></Field>
            <Field id="preferredLanguage" label="Preferred language" error={form.errors.preferredLanguage}>
              <Select {...form.bind('preferredLanguage')} id="preferredLanguage">{PROFILE_LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}</Select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>
              <Button type="submit" loading={form.submitting}>Save changes</Button>
            </div>
          </form>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Detail label="Full name" value={user.fullName} />
            <Detail label="Phone" value={user.phone} />
            <Detail label="Designation" value={user.designation} />
            <Detail label="Preferred language" value={user.preferredLanguage ?? 'English'} />
          </div>
        )}
      </div>
    </Card>
  );
}

