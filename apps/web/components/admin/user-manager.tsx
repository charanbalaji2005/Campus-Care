'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { Download, KeyRound, LogOut, MailPlus, MoreHorizontal, Search, ShieldOff, UserCog, UserPlus } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { assignableRoles, DEPARTMENTS, PERMISSIONS, EXPLICIT_ONLY_PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Role } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, humanize, timeAgo } from '@/lib/utils';
import { useCurrentUser } from '@/components/layout/portal-shell';
import { useSensitiveAction } from '@/components/providers';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface UserRow {
  id: string; fullName: string; email: string; role: Role; permissions: string[]; accountStatus: string; studentId: string | null; department: string | null;
  mfaEnabled: boolean; emailVerified: boolean; createdAt: string; lastLoginAt: string | null; suspendedReason: string | null;
}

function statusTone(s: string) {
  return s === 'active' ? 'brand' : s === 'suspended' ? 'rose' : s === 'invited' || s === 'pending_verification' ? 'amber' : 'neutral';
}

function InviteDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const me = useCurrentUser();
  const roles = assignableRoles(me.user.role).filter((r) => r !== 'student');
  const { data: committees } = useApi<{ id: string; name: string }[]>(open ? '/admin/committees' : null);
  const [v, setV] = React.useState({ fullName: '', email: '', role: (roles[0] ?? 'counsellor') as Role, department: '', committeeIds: [] as string[] });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const run = useSensitiveAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await run(() => api.post('/admin/users/invite', { ...v, department: v.department || undefined }));
      toast.success(`Invitation sent to ${v.email}`);
      setV({ fullName: '', email: '', role: roles[0] ?? 'counsellor', department: '', committeeIds: [] });
      onOpenChange(false);
      onDone();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Invite a staff member" description="Staff accounts are created by invitation only. The invite link expires in 7 days and can be used once.">
        <form onSubmit={submit} className="space-y-4">
          <Field id="inv-name" label="Full name" required error={errors.fullName}><Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
          <Field id="inv-email" label="Official email" required error={errors.email} hint="Must be on an approved staff domain."><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="inv-role" label="Role" required error={errors.role}><Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
            <Field id="inv-dept" label="Department"><Select value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })}><option value="">—</option>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
          </div>
          {(v.role === 'committee_member' || v.role === 'security_officer') && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Committees</legend>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-3">
                {committees?.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={v.committeeIds.includes(c.id)} onChange={(e) => setV({ ...v, committeeIds: e.target.checked ? [...v.committeeIds, c.id] : v.committeeIds.filter((x) => x !== c.id) })} /> {c.name}</label>
                ))}
                {committees && !committees.length && <p className="text-sm text-ink-soft">No committees yet.</p>}
              </div>
            </fieldset>
          )}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" loading={busy}><MailPlus className="h-4 w-4" /> Send invitation</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const suspend = user?.accountStatus !== 'suspended';
  async function submit() {
    if (!user) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${user.id}/status`, { action: suspend ? 'suspend' : 'reactivate', reason });
      toast.success(suspend ? 'Account suspended and signed out everywhere' : 'Account reactivated');
      setReason('');
      onClose();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={suspend ? `Suspend ${user?.fullName}` : `Reactivate ${user?.fullName}`} description={suspend ? 'They will be signed out of every device immediately and cannot sign in until reactivated.' : 'They will be able to sign in again.'}>
        <Field id="status-reason" label="Reason (recorded in the audit log)" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={suspend ? 'danger' : 'default'} loading={busy} disabled={reason.trim().length < 3} onClick={submit}>{suspend ? 'Suspend account' : 'Reactivate'}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const run = useSensitiveAction();
  const [role, setRole] = React.useState<Role>('counsellor');
  const [perms, setPerms] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (user) { setRole(user.role); setPerms(user.permissions ?? []); setReason(''); } }, [user]);
  if (!user) return null;
  const isStudent = user.role === 'student';
  const roleOptions = isStudent ? (['student'] as Role[]) : ROLES.filter((r) => r !== 'student');
  const base = new Set<string>(ROLE_PERMISSIONS[role]);
  const extra = PERMISSIONS.filter((p) => !base.has(p));

  async function submit() {
    setBusy(true);
    try {
      const r = await run(() => api.patch(`/super-admin/users/${user!.id}/role`, { role, permissions: perms.filter((p) => !base.has(p)), reason }));
      if (r === undefined) return;
      toast.success('Role updated. The user was signed out so the change takes effect.');
      onClose();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Role & permissions — ${user.fullName}`} description="Changes are audited with before/after values and sign the user out of all devices." className="max-w-2xl">
        <div className="space-y-4">
          <Field id="role" label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isStudent}>{roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
          {isStudent && <p className="text-xs text-ink-soft">Student accounts cannot be promoted. Invite a separate staff account instead.</p>}
          <div>
            <p className="mb-1 text-sm font-medium">Additional permissions</p>
            <p className="mb-2 text-xs text-ink-soft">Granted on top of the role. Permissions marked “explicit” unlock access to confidential records — grant only with a documented reason.</p>
            <div className="grid max-h-60 gap-1 overflow-y-auto rounded-xl border border-slate-200 p-3 sm:grid-cols-2">
              {extra.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-brand-600" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />
                  <span className="font-mono text-xs">{p}</span>
                  {(EXPLICIT_ONLY_PERMISSIONS as readonly string[]).includes(p) && <Badge tone="rose">explicit</Badge>}
                </label>
              ))}
            </div>
          </div>
          <Field id="role-reason" label="Reason for change" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={reason.trim().length < 3} onClick={submit}>Save changes</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** User administration table. `superAdmin` adds role/permission editing, session revocation and MFA reset. */
export function UserManager({ superAdmin = false }: { superAdmin?: boolean }) {
  const me = useCurrentUser();
  const run = useSensitiveAction();
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [invite, setInvite] = React.useState(false);
  const [statusUser, setStatusUser] = React.useState<UserRow | null>(null);
  const [roleUser, setRoleUser] = React.useState<UserRow | null>(null);
  const params = new URLSearchParams({ page: String(page), limit: '25', ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) });
  const { data, error, isLoading, mutate } = useApi<{ items: UserRow[]; total: number; page: number; limit: number }>(`/admin/users?${params}`);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const visibleRoles = superAdmin ? ROLES : ROLES.filter((r) => r !== 'super_admin');

  async function action(label: string, fn: () => Promise<unknown>) {
    try {
      const r = await run(fn);
      if (r === undefined) return;
      toast.success(label);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" /><Input className="pl-9" placeholder="Search name, email or student ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search users" /></div>
        <Select className="lg:w-48" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role"><option value="">All roles</option>{visibleRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
        <Select className="lg:w-48" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status"><option value="">All statuses</option>{['active', 'invited', 'pending_verification', 'suspended'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Button variant="outline" asChild><a href="/api/v1/admin/users/export"><Download className="h-4 w-4" /> Export CSV</a></Button>
        <Button onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" /> Invite staff</Button>
      </div>
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      <Card className="overflow-hidden">
        {isLoading && <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {data && !data.items.length && <EmptyState title="No users found" description="Try different filters." />}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr><th className="px-4 py-3">User</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Security</th><th className="px-4 py-3">Last sign-in</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-mint/40">
                    <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar name={u.fullName} /><div><p className="font-medium text-ink-strong">{u.fullName}</p><p className="text-xs text-ink-soft">{u.email}{u.studentId ? ` · ${u.studentId}` : ''}</p></div></div></td>
                    <td className="px-4 py-3">{ROLE_LABELS[u.role]}{u.permissions?.length ? <Badge tone="amber" className="ml-2">+{u.permissions.length}</Badge> : null}{u.department && <p className="text-xs text-ink-soft">{u.department}</p>}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone(u.accountStatus)}>{humanize(u.accountStatus)}</Badge></td>
                    <td className="px-4 py-3 text-xs">{u.mfaEnabled ? <Badge tone="brand">2-step on</Badge> : <span className="text-ink-soft">2-step off</span>}</td>
                    <td className="px-4 py-3 text-ink-soft">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : `Joined ${formatDate(u.createdAt)}`}</td>
                    <td className="px-4 py-3 text-right">
                      {u.id !== me.user.id && (
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${u.fullName}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content align="end" className="z-50 min-w-[220px] rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-lift">
                              {u.accountStatus === 'invited' && <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-mint" onSelect={() => action('Invitation re-sent', () => api.post(`/admin/users/${u.id}/resend-invite`))}><MailPlus className="h-4 w-4" /> Resend invitation</DropdownMenu.Item>}
                              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-mint" onSelect={() => action('Password reset link sent and sessions signed out', () => api.post(`/admin/users/${u.id}/recovery`))}><KeyRound className="h-4 w-4" /> Send account recovery</DropdownMenu.Item>
                              {superAdmin && (
                                <>
                                  <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-mint" onSelect={() => setRoleUser(u)}><UserCog className="h-4 w-4" /> Role & permissions</DropdownMenu.Item>
                                  <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-mint" onSelect={() => action('All sessions revoked', () => api.post(`/super-admin/users/${u.id}/revoke-sessions`))}><LogOut className="h-4 w-4" /> Sign out everywhere</DropdownMenu.Item>
                                  {u.mfaEnabled && <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-mint" onSelect={() => action('Two-step verification reset', () => api.post(`/super-admin/users/${u.id}/reset-mfa`))}><ShieldOff className="h-4 w-4" /> Reset two-step verification</DropdownMenu.Item>}
                                </>
                              )}
                              <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />
                              <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-rose-700 outline-none data-[highlighted]:bg-rose-50" onSelect={() => setStatusUser(u)}>{u.accountStatus === 'suspended' ? 'Reactivate account' : 'Suspend account'}</DropdownMenu.Item>
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && pages > 1 && (
        <div className="flex items-center justify-between text-sm"><span className="text-ink-soft">{data.total} users · page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      )}
      <InviteDialog open={invite} onOpenChange={setInvite} onDone={() => mutate()} />
      <StatusDialog user={statusUser} onClose={() => setStatusUser(null)} onDone={() => mutate()} />
      {superAdmin && <RoleDialog user={roleUser} onClose={() => setRoleUser(null)} onDone={() => mutate()} />}
    </div>
  );
}
