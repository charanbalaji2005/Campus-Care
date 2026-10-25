'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, AlertTriangle, ArrowUpDown, Calendar, Check, CheckCircle2, ChevronDown, ChevronRight,
  Clock, Download, Eye, FileText, Filter, History, KeyRound, Lock, LogOut, Mail, MailPlus,
  MessageSquare, MoreHorizontal, Radio, RefreshCw, RotateCcw, Search, Shield, ShieldAlert,
  ShieldCheck, ShieldOff, Sparkles, Stethoscope, Trash2, UserCheck, UserCog, UserMinus, UserPlus,
  Users, UserX, X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, DEPARTMENTS, EXPLICIT_ONLY_PERMISSIONS,
  PERMISSIONS, RESPONDER_RESPONSIBILITIES, RESPONDER_SKILLS, RESPONDER_SKILL_LABELS,
  ROLE_LABELS, ROLE_PERMISSIONS, ROLES, assignableRoles, type AccountStatus, type Role,
} from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, humanize, timeAgo } from '@/lib/utils';
import { useCurrentUser } from '@/components/layout/portal-shell';
import { useSensitiveAction } from '@/components/providers';
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Select,
  Skeleton, StatCard, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea,
} from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  permissions: string[];
  accountStatus: AccountStatus;
  suspendedReason: string | null;
  suspendedAt: string | null;
  suspendedUntil: string | null;
  deactivatedAt: string | null;
  archivedAt: string | null;
  studentId: string | null;
  department: string | null;
  academicYear: number | null;
  phone: string | null;
  hostel: string | null;
  campusZone: string | null;
  counsellorApproved: boolean;
  counsellorApprovedAt: string | null;
  counsellingPublishAllowed: boolean;
  communityMuted: boolean;
  communityMutedReason: string | null;
  communityMutedUntil: string | null;
  responderEligible: boolean;
  dutyZone: string | null;
  mfaEnabled: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserStats {
  total: number;
  active: number;
  suspended: number;
  deactivated: number;
  archived: number;
  invited: number;
  pendingVerification: number;
  recentlyRegistered: number;
  lockedAccounts: number;
  mfaCount: number;
  activeSessions: number;
  counsellorsPending: number;
  byRole: Record<string, number>;
  topDepartments: Record<string, number>;
}

function statusTone(s: string): 'brand' | 'rose' | 'amber' | 'neutral' | 'dark' {
  switch (s) {
    case 'active': return 'brand';
    case 'suspended': return 'rose';
    case 'deactivated':
    case 'archived': return 'dark';
    case 'invited':
    case 'pending_verification': return 'amber';
    default: return 'neutral';
  }
}

// ------------------------------------------------------------------ 1. Invite Staff Dialog
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
      <DialogContent title="Invite a staff member" description="Staff accounts are created by invitation only. The single-use link expires in 7 days." className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <Field id="inv-name" label="Full name" required error={errors.fullName}>
            <Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} placeholder="Dr. Jane Doe" />
          </Field>
          <Field id="inv-email" label="Official institutional email" required error={errors.email} hint="Must end with an approved university staff domain (e.g. @srmap.edu.in).">
            <Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="jane.doe@srmap.edu.in" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="inv-role" label="Assigned role" required error={errors.role}>
              <Select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as Role })}>
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </Select>
            </Field>
            <Field id="inv-dept" label="Department">
              <Select value={v.department} onChange={(e) => setV({ ...v, department: e.target.value })}>
                <option value="">— Select Department —</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
          </div>
          {(v.role === 'committee_member' || v.role === 'security_officer') && (
            <fieldset className="rounded-xl border border-line p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">Assign Committees</legend>
              <div className="mt-1 grid max-h-36 gap-1.5 overflow-y-auto">
                {committees?.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm text-ink-strong">
                    <input
                      type="checkbox"
                      className="accent-brand-600 rounded"
                      checked={v.committeeIds.includes(c.id)}
                      onChange={(e) => setV({ ...v, committeeIds: e.target.checked ? [...v.committeeIds, c.id] : v.committeeIds.filter((x) => x !== c.id) })}
                    />
                    {c.name}
                  </label>
                ))}
                {committees && !committees.length && <p className="text-xs text-ink-soft">No committees configured.</p>}
              </div>
            </fieldset>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}><MailPlus className="h-4 w-4" /> Send invitation</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 2. Account Status Dialog (Suspend, Reactivate, Deactivate, Archive)
function StatusDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = React.useState<'suspend' | 'reactivate' | 'deactivate' | 'archive' | 'verify_email'>('suspend');
  const [reason, setReason] = React.useState('');
  const [reviewDate, setReviewDate] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const run = useSensitiveAction();

  React.useEffect(() => {
    if (user) {
      if (user.accountStatus === 'suspended') setAction('reactivate');
      else if (user.accountStatus === 'deactivated' || user.accountStatus === 'archived') setAction('reactivate');
      else setAction('suspend');
      setReason('');
      setReviewDate('');
    }
  }, [user]);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      await run(() => api.post(`/super-admin/users/${user.id}/status`, {
        action,
        reason: reason.trim() || undefined,
        reviewDate: reviewDate ? new Date(reviewDate).toISOString() : undefined,
      }));
      toast.success(`Account status updated to ${humanize(action)}`);
      onClose();
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isDestructive = action === 'suspend' || action === 'deactivate' || action === 'archive';

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Account Status — ${user.fullName}`}
        description="Change user lifecycle state with full audit trail and immediate session enforcement."
        className="max-w-lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <Field id="status-action" label="Target Lifecycle Action" required>
            <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
              <option value="suspend">Suspend Account (Temporary restriction, immediately blocks access)</option>
              <option value="reactivate">Reactivate Account (Restores normal access)</option>
              <option value="deactivate">Deactivate Account (Long-term inactive status)</option>
              <option value="archive">Archive Account (Preserves records per retention policy)</option>
              {!user.emailVerified && <option value="verify_email">Manually Verify Email</option>}
            </Select>
          </Field>

          {isDestructive && (
            <Alert tone="rose" icon={<AlertTriangle className="h-4 w-4" />} title="Impact of this action">
              {action === 'suspend' && 'The user will be immediately signed out of all web sessions and mobile devices. Any active responder duties will be automatically handed over.'}
              {action === 'deactivate' && 'Deactivation blocks new logins and revokes all active sessions. Existing case histories remain intact.'}
              {action === 'archive' && 'Archiving retains audit logs and cases according to institutional policy while disabling active account operations.'}
            </Alert>
          )}

          {isDestructive && (
            <Field id="status-reason" label="Justification / Reason (Mandatory)" required hint="Recorded in immutable audit log.">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="State the institutional policy, ticket reference, or incident justification..."
                required
                minLength={3}
                maxLength={500}
              />
            </Field>
          )}

          {action === 'suspend' && (
            <Field id="status-review" label="Review / Expiry Date (Optional)" hint="Scheduled date for status review or expiry.">
              <Input
                type="date"
                value={reviewDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setReviewDate(e.target.value)}
              />
            </Field>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant={isDestructive ? 'danger' : 'default'}
              loading={busy}
              disabled={isDestructive && reason.trim().length < 3}
            >
              {humanize(action)} Account
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 3. Edit Profile Dialog
function EditProfileDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = React.useState({
    fullName: '',
    phone: '',
    department: '',
    academicYear: '',
    studentId: '',
    hostel: '',
    campusZone: '',
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setForm({
        fullName: user.fullName || '',
        phone: user.phone || '',
        department: user.department || '',
        academicYear: user.academicYear ? String(user.academicYear) : '',
        studentId: user.studentId || '',
        hostel: user.hostel || '',
        campusZone: user.campusZone || '',
      });
    }
  }, [user]);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      await api.patch(`/super-admin/users/${user.id}/profile`, {
        fullName: form.fullName.trim() || undefined,
        phone: form.phone.trim() || null,
        department: form.department || null,
        academicYear: form.academicYear ? Number(form.academicYear) : null,
        studentId: form.studentId.trim() || null,
        hostel: form.hostel.trim() || null,
        campusZone: form.campusZone.trim() || null,
      });
      toast.success('User profile updated successfully');
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
      <DialogContent title={`Edit Profile — ${user.fullName}`} description="Update permitted profile fields. Passwords and security credentials remain protected." className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-name" label="Full name" required>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required />
            </Field>
            <Field id="edit-phone" label="Contact phone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 90000 00000" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-dept" label="Department">
              <Select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">— Select Department —</option>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field id="edit-id" label="Student / Staff ID">
              <Input value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })} placeholder="AP21110010001" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="edit-year" label="Academic Year">
              <Select value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </Select>
            </Field>
            <Field id="edit-hostel" label="Hostel / Residence">
              <Input value={form.hostel} onChange={(e) => setForm({ ...form, hostel: e.target.value })} placeholder="Block C" />
            </Field>
            <Field id="edit-zone" label="Campus Zone">
              <Input value={form.campusZone} onChange={(e) => setForm({ ...form, campusZone: e.target.value })} placeholder="North Quad" />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save Changes</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 4. Role & Permissions Dialog
function RoleDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const run = useSensitiveAction();
  const [role, setRole] = React.useState<Role>('counsellor');
  const [perms, setPerms] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setRole(user.role);
      setPerms(user.permissions ?? []);
      setReason('');
    }
  }, [user]);

  if (!user) return null;

  const isStudent = user.role === 'student';
  const roleOptions = isStudent ? (['student'] as Role[]) : ROLES.filter((r) => r !== 'student');
  const base = new Set<string>(ROLE_PERMISSIONS[role]);
  const extra = PERMISSIONS.filter((p) => !base.has(p));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await run(() => api.patch(`/super-admin/users/${user!.id}/role`, {
        role,
        permissions: perms.filter((p) => !base.has(p)),
        reason: reason.trim(),
      }));
      toast.success('Role updated. The user was signed out of all devices immediately.');
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
      <DialogContent title={`Role & Permissions — ${user.fullName}`} description="Changes are audited with before/after snapshots and sign the user out everywhere." className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <Field id="role-select" label="Assigned Role" required>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isStudent}>
              {roleOptions.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          {isStudent && (
            <p className="text-xs text-ink-soft">
              Student accounts cannot be promoted directly. Send an invitation to their official staff email to provision a staff account.
            </p>
          )}

          <div>
            <p className="mb-1 text-sm font-semibold text-ink-strong">Additional Fine-Grained Permissions</p>
            <p className="mb-2 text-xs text-ink-soft">
              Permissions marked <Badge tone="rose">explicit</Badge> require documented statutory or safeguarding authorization.
            </p>
            <div className="grid max-h-52 gap-2 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-2">
              {extra.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    className="accent-brand-600 rounded"
                    checked={perms.includes(p)}
                    onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))}
                  />
                  <span className="font-mono">{p}</span>
                  {(EXPLICIT_ONLY_PERMISSIONS as readonly string[]).includes(p) && <Badge tone="rose">explicit</Badge>}
                </label>
              ))}
            </div>
          </div>

          <Field id="role-reason" label="Justification / Ticket Reference" required hint="Required for elevated privilege changes.">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State the institutional approval or authorization..."
              required
              minLength={3}
              maxLength={500}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>Save Role & Sign Out</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 5. Counsellor Controls Dialog
function CounsellorDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [approved, setApproved] = React.useState(false);
  const [publishAllowed, setPublishAllowed] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setApproved(Boolean(user.counsellorApproved));
      setPublishAllowed(Boolean(user.counsellingPublishAllowed));
      setNote('');
    }
  }, [user]);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/super-admin/users/${user!.id}/verify-counsellor`, {
        approved,
        publishAllowed,
        note: note.trim() || undefined,
      });
      toast.success('Counsellor approval and publishing settings saved');
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
      <DialogContent
        title={`Counsellor & Channel Controls — ${user.fullName}`}
        description="Verify professional credentials and configure publication privileges in the Official Counselling Support channel."
        className="max-w-md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-xl border border-line p-4 space-y-3">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-600 rounded"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              <div>
                <p className="text-sm font-semibold text-ink-strong">Approved Institutional Counsellor</p>
                <p className="text-xs text-ink-soft">Confirms verified qualification to offer student counselling appointments.</p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-3 pt-2 border-t border-line">
              <input
                type="checkbox"
                className="mt-0.5 accent-brand-600 rounded"
                checked={publishAllowed}
                onChange={(e) => setPublishAllowed(e.target.checked)}
              />
              <div>
                <p className="text-sm font-semibold text-ink-strong">Official Channel Publishing Rights</p>
                <p className="text-xs text-ink-soft">Allows posting official mental health guidance in the public community channel.</p>
              </div>
            </label>
          </div>

          <Field id="counsellor-note" label="Verification Notes / Credentials Reference">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Verified license #PSY-2024-88, SRM Mental Health Advisory Committee"
              maxLength={500}
            />
          </Field>

          <Alert tone="neutral" icon={<Shield className="h-4 w-4" />}>
            Private student counselling records and notes remain strictly confidential and are never revealed here.
          </Alert>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save Verification</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 6. Emergency & Duty Controls Dialog
function ResponderDialog({ user, onClose, onDone }: { user: UserRow | null; onClose: () => void; onDone: () => void }) {
  const [eligible, setEligible] = React.useState(false);
  const [skills, setSkills] = React.useState<string[]>([]);
  const [responsibilities, setResponsibilities] = React.useState<string[]>(['sos_response']);
  const [busy, setBusy] = React.useState(false);
  const { data: zones } = useApi<{ id: string; name: string; code: string }[]>('/super-admin/live-map/zones');
  const [zoneId, setZoneId] = React.useState('');

  React.useEffect(() => {
    if (user) {
      setEligible(Boolean(user.responderEligible));
      setZoneId(user.dutyZone || '');
      setSkills(['first_aid', 'cpr']);
    }
  }, [user]);

  if (!user) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/super-admin/users/${user!.id}/duty-assignment`, {
        eligible,
        skills,
        responsibilities,
        zoneId: zoneId || null,
        campus: 'main',
      });
      toast.success('Emergency responder assignment updated');
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
      <DialogContent
        title={`Responder & Duty Roster — ${user.fullName}`}
        description="Configure emergency response qualifications, coverage zone, and operational dispatch responsibilities."
        className="max-w-lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
            <input
              type="checkbox"
              className="mt-0.5 accent-brand-600 rounded"
              checked={eligible}
              onChange={(e) => setEligible(e.target.checked)}
            />
            <div>
              <p className="text-sm font-semibold text-ink-strong">Eligible Emergency Responder</p>
              <p className="text-xs text-ink-soft">Allows the responder to be dispatched for 10-second SOS and Safe Walk escalations.</p>
            </div>
          </label>

          <Field id="duty-zone" label="Assigned Coverage Zone">
            <Select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              <option value="">— Campus Wide (Default) —</option>
              {zones?.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.code})</option>)}
            </Select>
          </Field>

          <div>
            <p className="mb-1 text-sm font-semibold text-ink-strong">Emergency Qualifications & Skills</p>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3">
              {RESPONDER_SKILLS.map((s) => (
                <label key={s} className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    className="accent-brand-600 rounded"
                    checked={skills.includes(s)}
                    onChange={(e) => setSkills(e.target.checked ? [...skills, s] : skills.filter((x) => x !== s))}
                  />
                  {RESPONDER_SKILL_LABELS[s]}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={busy}>Save Assignment</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 7. User Details / Inspector Drawer
function UserInspectorDialog({ userId, onClose, onRefresh }: { userId: string | null; onClose: () => void; onRefresh: () => void }) {
  const { data, isLoading, mutate } = useApi<{
    user: UserRow;
    security: {
      mfa: { enabled: boolean; lastUsedAt: string | null };
      failedLoginCount: number;
      lockedUntil: string | null;
      passwordChangedAt: string | null;
      lastLoginAt: string | null;
      activeSessionsCount: number;
      sessions: { id: string; client: string; deviceName: string | null; userAgent: string | null; ipHash: string | null; createdAt: string; lastSeenAt: string }[];
    };
    counsellor: { approved: boolean; publishAllowed: boolean; isChannelPublisher: boolean };
    responder: { status: string; campus: string; skills: string[]; responsibilities: string[]; activeAssignmentCount: number; isStale: boolean } | null;
    committees: { committeeId: string; name: string; position: string }[];
    activity: { reportedIncidentsCount: number; dataRequests: { id: string; type: string; status: string; createdAt: string }[] };
  }>(userId ? `/super-admin/users/${userId}` : null);

  const [tab, setTab] = React.useState('overview');
  const [busySession, setBusySession] = React.useState(false);
  const run = useSensitiveAction();

  if (!userId) return null;

  async function revokeSessions() {
    if (!userId) return;
    setBusySession(true);
    try {
      await run(() => api.post(`/super-admin/users/${userId}/revoke-sessions`));
      toast.success('All active sessions revoked immediately');
      void mutate();
      onRefresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusySession(false);
    }
  }

  async function resetMfa() {
    if (!userId) return;
    try {
      await run(() => api.post(`/super-admin/users/${userId}/reset-mfa`));
      toast.success('Two-factor authentication reset. User must re-enroll on next login.');
      void mutate();
      onRefresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={!!userId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={data ? data.user.fullName : 'User Profile Details'} description="Comprehensive profile, active sessions, and security telemetry." className="max-w-3xl">
        {isLoading && <div className="space-y-4 py-8"><Skeleton className="h-10" /><Skeleton className="h-40" /></div>}
        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-2xl bg-brand-50/50 p-4 border border-line">
              <Avatar name={data.user.fullName} className="h-14 w-14 text-lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-ink-strong truncate">{data.user.fullName}</h3>
                  <Badge tone={statusTone(data.user.accountStatus)}>{humanize(data.user.accountStatus)}</Badge>
                  <Badge tone="dark">{ROLE_LABELS[data.user.role]}</Badge>
                </div>
                <p className="text-xs text-ink-soft">{data.user.email} {data.user.studentId ? `· ID: ${data.user.studentId}` : ''}</p>
                {data.user.department && <p className="text-xs text-brand-700 font-medium">{data.user.department}</p>}
              </div>
            </div>

            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="w-full justify-start overflow-x-auto">
                <TabsTrigger value="overview"><FileText className="h-3.5 w-3.5" /> Overview</TabsTrigger>
                <TabsTrigger value="security"><Lock className="h-3.5 w-3.5" /> Security & Sessions ({data.security.activeSessionsCount})</TabsTrigger>
                {data.user.role === 'counsellor' && <TabsTrigger value="counsellor"><Stethoscope className="h-3.5 w-3.5" /> Counsellor</TabsTrigger>}
                {(data.user.role === 'security_officer' || data.responder) && <TabsTrigger value="duty"><Radio className="h-3.5 w-3.5" /> Responder Duty</TabsTrigger>}
              </TabsList>

              <TabsContent value="overview" className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Registered On</p>
                    <p className="font-semibold">{formatDate(data.user.createdAt)}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Last Sign In</p>
                    <p className="font-semibold">{data.user.lastLoginAt ? timeAgo(data.user.lastLoginAt) : 'Never'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Email Verified</p>
                    <p className="font-semibold">{data.user.emailVerified ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Phone</p>
                    <p className="font-semibold">{data.user.phone || '—'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Campus Zone</p>
                    <p className="font-semibold">{data.user.campusZone || '—'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Hostel / Residence</p>
                    <p className="font-semibold">{data.user.hostel || '—'}</p>
                  </div>
                </div>

                {data.committees.length > 0 && (
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs font-semibold uppercase text-ink-soft mb-2">Committee Memberships</p>
                    <div className="flex flex-wrap gap-2">
                      {data.committees.map((c) => (
                        <Badge key={c.committeeId} tone="brand">{c.name} ({humanize(c.position)})</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="security" className="mt-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Two-Step MFA</p>
                    <p className="font-semibold">{data.security.mfa.enabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Failed Logins</p>
                    <p className="font-semibold">{data.security.failedLoginCount}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Lockout Status</p>
                    <p className="font-semibold">{data.security.lockedUntil ? 'Temporarily Locked' : 'Normal'}</p>
                  </div>
                  <div className="rounded-xl border border-line p-3">
                    <p className="text-xs text-ink-soft">Active Sessions</p>
                    <p className="font-semibold">{data.security.activeSessionsCount}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                  <h4 className="text-sm font-semibold text-ink-strong">Active Device Sessions</h4>
                  <div className="flex gap-2">
                    {data.security.mfa.enabled && (
                      <Button size="sm" variant="outline" onClick={resetMfa}><ShieldOff className="h-3.5 w-3.5" /> Reset MFA</Button>
                    )}
                    {data.security.activeSessionsCount > 0 && (
                      <Button size="sm" variant="danger-outline" loading={busySession} onClick={revokeSessions}><LogOut className="h-3.5 w-3.5" /> Sign Out Everywhere</Button>
                    )}
                  </div>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-2">
                  {data.security.sessions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between rounded-xl border border-line p-2.5 text-xs">
                      <div>
                        <p className="font-semibold text-ink-strong">{s.client === 'android' ? '📱 Android Device' : '💻 Web Browser'} {s.deviceName ? `· ${s.deviceName}` : ''}</p>
                        <p className="text-ink-soft truncate max-w-sm">{s.userAgent || 'App client'}</p>
                      </div>
                      <div className="text-right text-ink-soft">
                        <p>Last seen {timeAgo(s.lastSeenAt)}</p>
                        <p>Logged in {formatDate(s.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                  {!data.security.sessions.length && <p className="text-xs text-ink-soft py-4 text-center">No active sessions.</p>}
                </div>
              </TabsContent>

              {data.user.role === 'counsellor' && (
                <TabsContent value="counsellor" className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs text-ink-soft">Counsellor Approval</p>
                      <p className="font-semibold">{data.counsellor.approved ? 'Verified by Administration' : 'Pending Verification'}</p>
                    </div>
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs text-ink-soft">Official Channel Publishing</p>
                      <p className="font-semibold">{data.counsellor.publishAllowed ? 'Allowed' : 'Not Permitted'}</p>
                    </div>
                  </div>
                </TabsContent>
              )}

              {data.responder && (
                <TabsContent value="duty" className="mt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs text-ink-soft">Current Duty Status</p>
                      <Badge tone={data.responder.status === 'on_duty' ? 'brand' : 'neutral'}>{humanize(data.responder.status)}</Badge>
                    </div>
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs text-ink-soft">Heartbeat Signal</p>
                      <p className="font-semibold">{data.responder.isStale ? '⚠️ Stale' : '🟢 Fresh'}</p>
                    </div>
                    <div className="rounded-xl border border-line p-3">
                      <p className="text-xs text-ink-soft">Active Alerts Handled</p>
                      <p className="font-semibold">{data.responder.activeAssignmentCount}</p>
                    </div>
                  </div>
                </TabsContent>
              )}
            </Tabs>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 8. Bulk Actions Dialog
function BulkActionsDialog({
  selectedIds,
  users,
  onClose,
  onDone,
}: {
  selectedIds: string[];
  users: UserRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = React.useState<'suspend' | 'reactivate' | 'deactivate' | 'archive' | 'verify_email' | 'revoke_sessions' | 'assign_role' | 'assign_department'>('suspend');
  const [reason, setReason] = React.useState('');
  const [role, setRole] = React.useState<Role>('student');
  const [department, setDepartment] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ successCount: number; failureCount: number; results: { userId: string; success: boolean; message: string }[] } | null>(null);
  const run = useSensitiveAction();

  const selectedUsers = users.filter((u) => selectedIds.includes(u.id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await run(() => api.post<{ successCount: number; failureCount: number; results: { userId: string; success: boolean; message: string }[] }>('/super-admin/users/bulk', {
        userIds: selectedIds,
        action,
        reason: reason.trim() || undefined,
        role: action === 'assign_role' ? role : undefined,
        department: action === 'assign_department' ? department || undefined : undefined,
      }));
      if (res) {
        setResult(res);
        toast.success(`Bulk operation finished: ${res.successCount} succeeded, ${res.failureCount} failed`);
        onDone();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={selectedIds.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Bulk Action on ${selectedIds.length} Selected Users`} description="Review targets and confirm administrative operation with audit logging." className="max-w-xl">
        {!result ? (
          <form onSubmit={submit} className="space-y-4">
            <Field id="bulk-action" label="Select Bulk Operation" required>
              <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
                <option value="suspend">Suspend Accounts</option>
                <option value="reactivate">Reactivate Accounts</option>
                <option value="revoke_sessions">Revoke All Active Sessions</option>
                <option value="verify_email">Verify Email Addresses</option>
                <option value="assign_department">Assign Department</option>
                <option value="assign_role">Assign Role</option>
                <option value="deactivate">Deactivate Accounts</option>
                <option value="archive">Archive Accounts</option>
              </Select>
            </Field>

            {action === 'assign_role' && (
              <Field id="bulk-role" label="Role to Assign" required>
                <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </Select>
              </Field>
            )}

            {action === 'assign_department' && (
              <Field id="bulk-dept" label="Department to Assign" required>
                <Select value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">— Select Department —</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              </Field>
            )}

            <Field id="bulk-reason" label="Justification / Reason (Audited)" required={['suspend', 'deactivate', 'archive'].includes(action)}>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="State the institutional reason for applying this bulk change..."
                maxLength={500}
                required={['suspend', 'deactivate', 'archive'].includes(action)}
              />
            </Field>

            <div className="rounded-xl border border-line p-3 max-h-36 overflow-y-auto">
              <p className="text-xs font-semibold text-ink-soft mb-2">Affected Users Preview ({selectedUsers.length}):</p>
              <div className="space-y-1">
                {selectedUsers.map((u) => (
                  <div key={u.id} className="text-xs flex items-center justify-between text-ink">
                    <span>{u.fullName} ({u.email})</span>
                    <Badge tone="neutral">{u.role}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant={['suspend', 'deactivate', 'archive'].includes(action) ? 'danger' : 'default'} loading={busy}>
                Execute on {selectedIds.length} Users
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert tone={result.failureCount === 0 ? 'brand' : 'amber'} title="Bulk Execution Complete">
              {result.successCount} users processed successfully. {result.failureCount > 0 && `${result.failureCount} operations could not be applied.`}
            </Alert>
            <div className="max-h-48 overflow-y-auto space-y-1.5 border border-line rounded-xl p-3">
              {result.results.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{r.userId}</span>
                  <Badge tone={r.success ? 'brand' : 'rose'}>{r.message}</Badge>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => { setResult(null); onClose(); }}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ 9. Main User Management Component
export function UserManager({ superAdmin = true }: { superAdmin?: boolean }) {
  const me = useCurrentUser();
  const run = useSensitiveAction();

  // Filter and pagination state
  const [q, setQ] = React.useState('');
  const [role, setRole] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [verification, setVerification] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [sortField, setSortField] = React.useState('createdAt');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('desc');

  // Selected row IDs for bulk actions
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);

  // Dialog triggers
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inspectorId, setInspectorId] = React.useState<string | null>(null);
  const [editProfileUser, setEditProfileUser] = React.useState<UserRow | null>(null);
  const [statusUser, setStatusUser] = React.useState<UserRow | null>(null);
  const [roleUser, setRoleUser] = React.useState<UserRow | null>(null);
  const [counsellorUser, setCounsellorUser] = React.useState<UserRow | null>(null);
  const [responderUser, setResponderUser] = React.useState<UserRow | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = React.useState(false);

  // Fetch metrics
  const { data: stats, mutate: mutateStats } = useApi<UserStats>(superAdmin ? '/super-admin/users/stats' : null);

  // Fetch paginated users
  const params = new URLSearchParams({
    page: String(page),
    limit: '25',
    ...(q ? { q } : {}),
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(verification ? { verification } : {}),
    ...(department ? { department } : {}),
    sort: sortField,
    order: sortOrder,
  });

  const { data, error, isLoading, mutate: mutateUsers } = useApi<{
    items: UserRow[];
    total: number;
    page: number;
    limit: number;
    pages: number;
  }>(superAdmin ? `/super-admin/users?${params}` : `/admin/users?${params}`);

  function refreshAll() {
    void mutateUsers();
    void mutateStats();
  }

  // Toggle selection
  function toggleSelectAll() {
    if (!data?.items) return;
    if (selectedIds.length === data.items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(data.items.map((u) => u.id));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Quick individual action runner
  async function runUserAction(label: string, fn: () => Promise<unknown>) {
    try {
      const res = await run(fn);
      if (res === undefined) return;
      toast.success(label);
      refreshAll();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      {/* 1. Metric Cards Row */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            className="text-left transition-transform hover:scale-[1.02] focus:outline-none"
            onClick={() => { setRole(''); setStatus(''); setVerification(''); setPage(1); }}
          >
            <StatCard label="Total Accounts" value={stats.total} icon={<Users className="h-5 w-5" />} tone="dark" hint="All institutional users" />
          </button>
          <button
            type="button"
            className="text-left transition-transform hover:scale-[1.02] focus:outline-none"
            onClick={() => { setStatus('active'); setPage(1); }}
          >
            <StatCard label="Active Users" value={stats.active} icon={<UserCheck className="h-5 w-5" />} tone="brand" hint={`${Math.round((stats.active / (stats.total || 1)) * 100)}% of directory`} />
          </button>
          <button
            type="button"
            className="text-left transition-transform hover:scale-[1.02] focus:outline-none"
            onClick={() => { setStatus('suspended'); setPage(1); }}
          >
            <StatCard label="Restricted / Suspended" value={stats.suspended + stats.deactivated} icon={<UserX className="h-5 w-5" />} tone="rose" hint={`${stats.suspended} suspended, ${stats.deactivated} deactivated`} />
          </button>
          <button
            type="button"
            className="text-left transition-transform hover:scale-[1.02] focus:outline-none"
            onClick={() => { setStatus('pending_verification'); setPage(1); }}
          >
            <StatCard label="Pending Verifications" value={stats.pendingVerification + stats.counsellorsPending} icon={<Clock className="h-5 w-5" />} tone="amber" hint="Unverified email or staff credentials" />
          </button>
          <button
            type="button"
            className="text-left transition-transform hover:scale-[1.02] focus:outline-none"
            onClick={() => { setPage(1); }}
          >
            <StatCard label="New This Week" value={stats.recentlyRegistered} icon={<Sparkles className="h-5 w-5" />} tone="brand" hint="Registered in past 7 days" />
          </button>
        </div>
      )}

      {/* 2. Search, Filter & Actions Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input
              className="pl-10 pr-9"
              placeholder="Search by name, institutional email, student/staff ID..."
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              aria-label="Search users"
            />
            {q && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink-strong"
                onClick={() => { setQ(''); setPage(1); }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-36 text-xs" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} aria-label="Role Filter">
              <option value="">All Roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>

            <Select className="w-36 text-xs" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status Filter">
              <option value="">All Statuses</option>
              {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABELS[s] || humanize(s)}</option>)}
            </Select>

            <Select className="w-36 text-xs" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} aria-label="Department Filter">
              <option value="">All Depts</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>

            {(q || role || status || department || verification) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => { setQ(''); setRole(''); setStatus(''); setDepartment(''); setVerification(''); setPage(1); }}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </Button>
            )}

            <Button variant="outline" asChild>
              <a href="/api/v1/super-admin/users/export" title="Export sanitized user list">
                <Download className="h-4 w-4" /> Export CSV
              </a>
            </Button>

            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" /> Invite Staff
            </Button>
          </div>
        </div>

        {/* 3. Sticky Floating Bulk Action Bar */}
        {selectedIds.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-forest p-3 text-white shadow-lift animate-in fade-in duration-200">
            <div className="flex items-center gap-3">
              <Badge tone="brand">{selectedIds.length} Selected</Badge>
              <span className="text-xs text-white/80">Choose an operation to apply across all selected users:</span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="brand" onClick={() => setBulkDialogOpen(true)}>
                Execute Bulk Action
              </Button>
              <Button size="sm" variant="ghost" className="text-white hover:bg-forest-700" onClick={() => setSelectedIds([])}>
                Deselect All
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && <ErrorState message={error.message} onRetry={refreshAll} />}

      {/* 4. Paginated User Table */}
      <Card className="overflow-hidden">
        {isLoading && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        )}

        {data && !data.items.length && (
          <EmptyState
            icon={<Users className="h-10 w-10 text-brand-600" />}
            title="No accounts match criteria"
            description="Try modifying search keywords, role selection, or status filters."
          />
        )}

        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      className="accent-brand-600 rounded"
                      checked={selectedIds.length === data.items.length && data.items.length > 0}
                      onChange={toggleSelectAll}
                      aria-label="Select all visible users"
                    />
                  </th>
                  <th className="px-4 py-3">User & Contact</th>
                  <th className="px-4 py-3">Role & Permissions</th>
                  <th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3">Security & 2FA</th>
                  <th className="px-4 py-3">Last Sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-brand-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="accent-brand-600 rounded"
                        checked={selectedIds.includes(u.id)}
                        onChange={() => toggleSelectOne(u.id)}
                        aria-label={`Select ${u.fullName}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={u.fullName} />
                        <div>
                          <button
                            type="button"
                            className="font-semibold text-ink-strong hover:text-brand-700 text-left block"
                            onClick={() => setInspectorId(u.id)}
                          >
                            {u.fullName}
                          </button>
                          <p className="text-xs text-ink-soft">
                            {u.email} {u.studentId ? `· ${u.studentId}` : ''}
                          </p>
                          {u.department && <p className="text-[11px] text-slate-500">{u.department}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge tone="dark">{ROLE_LABELS[u.role]}</Badge>
                        {u.permissions?.length > 0 && (
                          <Badge tone="amber">+{u.permissions.length} perms</Badge>
                        )}
                        {u.counsellorApproved && <Badge tone="brand">Verified Counsellor</Badge>}
                        {u.responderEligible && <Badge tone="amber">Responder</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(u.accountStatus)}>
                        {ACCOUNT_STATUS_LABELS[u.accountStatus] || humanize(u.accountStatus)}
                      </Badge>
                      {u.suspendedReason && (
                        <p className="mt-0.5 text-[11px] text-rose-700 truncate max-w-[160px]" title={u.suspendedReason}>
                          {u.suspendedReason}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.mfaEnabled ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <ShieldCheck className="h-3.5 w-3.5" /> 2-Step On
                        </span>
                      ) : (
                        <span className="text-slate-400">2-Step Off</span>
                      )}
                      {!u.emailVerified && (
                        <p className="text-[11px] text-amber-700 font-medium">Email Unverified</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      {u.lastLoginAt ? (
                        <span title={formatDate(u.lastLoginAt)}>{timeAgo(u.lastLoginAt)}</span>
                      ) : (
                        <span>Joined {formatDate(u.createdAt)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${u.fullName}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content align="end" className="z-50 min-w-[230px] rounded-xl border border-line bg-white p-1 text-xs shadow-lift">
                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                              onSelect={() => setInspectorId(u.id)}
                            >
                              <Eye className="h-4 w-4 text-brand-700" /> View Details & Security
                            </DropdownMenu.Item>

                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                              onSelect={() => setEditProfileUser(u)}
                            >
                              <UserCog className="h-4 w-4 text-ink" /> Edit Profile Fields
                            </DropdownMenu.Item>

                            {superAdmin && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                onSelect={() => setRoleUser(u)}
                              >
                                <Shield className="h-4 w-4 text-brand-700" /> Change Role & Permissions
                              </DropdownMenu.Item>
                            )}

                            {u.role === 'counsellor' && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                onSelect={() => setCounsellorUser(u)}
                              >
                                <Stethoscope className="h-4 w-4 text-emerald-700" /> Counsellor & Channel Controls
                              </DropdownMenu.Item>
                            )}

                            {(u.role === 'security_officer' || u.responderEligible) && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                onSelect={() => setResponderUser(u)}
                              >
                                <Radio className="h-4 w-4 text-amber-700" /> Responder & Duty Roster
                              </DropdownMenu.Item>
                            )}

                            <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />

                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                              onSelect={() => runUserAction('Password reset link sent to user', () => api.post(`/super-admin/users/${u.id}/force-password-reset`))}
                            >
                              <KeyRound className="h-4 w-4 text-ink-soft" /> Force Password Reset
                            </DropdownMenu.Item>

                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                              onSelect={() => runUserAction('All sessions revoked', () => api.post(`/super-admin/users/${u.id}/revoke-sessions`))}
                            >
                              <LogOut className="h-4 w-4 text-ink-soft" /> Sign Out Everywhere
                            </DropdownMenu.Item>

                            {u.mfaEnabled && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                onSelect={() => runUserAction('MFA reset; user must re-enroll', () => api.post(`/super-admin/users/${u.id}/reset-mfa`))}
                              >
                                <ShieldOff className="h-4 w-4 text-amber-700" /> Reset Two-Factor Auth
                              </DropdownMenu.Item>
                            )}

                            {(!u.emailVerified || u.accountStatus === 'invited') && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                onSelect={() => runUserAction('Verification / invite link resent', () => api.post(`/super-admin/users/${u.id}/resend-verification`))}
                              >
                                <Mail className="h-4 w-4 text-ink-soft" /> Resend Verification / Invite
                              </DropdownMenu.Item>
                            )}

                            <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />

                            {u.id !== me.user.id && (
                              <DropdownMenu.Item
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-rose-700 outline-none hover:bg-rose-50"
                                onSelect={() => setStatusUser(u)}
                              >
                                <UserX className="h-4 w-4" /> Lifecycle: Suspend / Deactivate
                              </DropdownMenu.Item>
                            )}
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Root>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 5. Pagination Bar */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-ink-soft">
          <span>{data.total} total accounts · Page {page} of {data.pages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* 6. Dialog Modals */}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} onDone={refreshAll} />
      <UserInspectorDialog userId={inspectorId} onClose={() => setInspectorId(null)} onRefresh={refreshAll} />
      <EditProfileDialog user={editProfileUser} onClose={() => setEditProfileUser(null)} onDone={refreshAll} />
      <RoleDialog user={roleUser} onClose={() => setRoleUser(null)} onDone={refreshAll} />
      <StatusDialog user={statusUser} onClose={() => setStatusUser(null)} onDone={refreshAll} />
      <CounsellorDialog user={counsellorUser} onClose={() => setCounsellorUser(null)} onDone={refreshAll} />
      <ResponderDialog user={responderUser} onClose={() => setResponderUser(null)} onDone={refreshAll} />
      <BulkActionsDialog
        selectedIds={selectedIds}
        users={data?.items ?? []}
        onClose={() => setBulkDialogOpen(false)}
        onDone={() => { setSelectedIds([]); refreshAll(); }}
      />
    </div>
  );
}
