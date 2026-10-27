'use client';

import * as React from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'sonner';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  DEPARTMENTS,
  STUDENT_VERIFICATION_LABELS,
  STUDENT_VERIFICATION_STATUSES,
  type AccountStatus,
  type StudentVerificationStatus,
} from '@campuscare/shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, timeAgo } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';

interface StudentItem {
  id: string;
  fullName: string;
  email: string;
  studentId: string | null;
  department: string | null;
  academicYear: number | null;
  phone: string | null;
  hostel: string | null;
  campusZone: string | null;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  verificationStatus: StudentVerificationStatus;
  verificationReviewedAt: string | null;
  verificationReason: string | null;
  verificationNotes: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface VerificationModalProps {
  student: StudentItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

function VerificationModal({ student, open, onOpenChange, onSuccess }: VerificationModalProps) {
  const [decision, setDecision] = React.useState<StudentVerificationStatus>('approved');
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (student) {
      setDecision(student.verificationStatus === 'pending' ? 'approved' : student.verificationStatus);
      setReason(student.verificationReason ?? '');
      setNotes(student.verificationNotes ?? '');
    }
  }, [student]);

  if (!student) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (decision === 'rejected' && (!reason || reason.trim().length < 5)) {
      toast.error('A mandatory justification reason (min 5 chars) is required when rejecting verification.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/super-admin/users/${student?.id}/verify-enrollment`, {
        status: decision,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`Verification status updated to "${STUDENT_VERIFICATION_LABELS[decision]}" for ${student?.fullName}`);
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to update verification status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 shadow-lift">
          <div className="flex items-start justify-between border-b border-line pb-4">
            <div>
              <Dialog.Title className="text-base font-bold text-ink-strong">
                Review Student Enrollment Verification
              </Dialog.Title>
              <Dialog.Description className="text-xs text-ink-soft mt-0.5">
                Verify that this scholar is an actively enrolled member of SRM University-AP.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button className="text-ink-soft hover:text-ink-strong">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="mt-4 space-y-4">
            {/* Student identity card */}
            <div className="rounded-xl border border-line bg-slate-50 p-3.5 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink-strong text-sm">{student.fullName}</span>
                <Badge tone={student.emailVerified ? 'brand' : 'amber'}>
                  {student.emailVerified ? 'Email Verified' : 'Email Unverified'}
                </Badge>
              </div>
              <p className="text-ink-soft font-mono">{student.email}</p>
              <div className="grid grid-cols-2 gap-2 pt-1.5 text-ink-soft border-t border-slate-200/60">
                <div>
                  <span className="font-semibold text-ink-strong">Student ID:</span> {student.studentId ?? 'Not submitted'}
                </div>
                <div>
                  <span className="font-semibold text-ink-strong">Department:</span> {student.department ?? 'Undeclared'}
                </div>
                <div>
                  <span className="font-semibold text-ink-strong">Academic Year:</span> Year {student.academicYear ?? '1'}
                </div>
                <div>
                  <span className="font-semibold text-ink-strong">Current Status:</span>{' '}
                  <span className="font-medium text-ink-strong">
                    {STUDENT_VERIFICATION_LABELS[student.verificationStatus]}
                  </span>
                </div>
              </div>
            </div>

            {/* Decision selector */}
            <Field id="verification-decision" label="Verification Decision" required>
              <Select value={decision} onChange={(e) => setDecision(e.target.value as StudentVerificationStatus)}>
                <option value="approved">Approve & Verify (Active Enrollment Confirmed)</option>
                <option value="under_review">Mark Under Review (Cross-checking Registry)</option>
                <option value="needs_info">Request Additional Documents / Correction</option>
                <option value="rejected">Reject Verification (Non-enrolled / Invalid ID)</option>
                <option value="revoked">Revoke Verification (Disenrolled / Graduated)</option>
              </Select>
            </Field>

            {/* Mandatory Reason (especially for rejection or correction) */}
            <Field
              id="verification-reason"
              label="Decision Justification"
              hint="Recorded in audit logs and sent to the student if corrections are requested."
              required={decision === 'rejected' || decision === 'needs_info'}
            >
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  decision === 'rejected'
                    ? 'State reason for rejection (e.g., student ID mismatch with university registrar)'
                    : decision === 'needs_info'
                    ? 'Specify missing documents (e.g., please upload valid semester fee receipt or student ID card)'
                    : 'Optional note explaining decision approval'
                }
              />
            </Field>

            {/* Internal Reviewer Notes */}
            <Field id="verification-notes" label="Internal Administrator Notes" hint="Private notes visible only to Super Admins and Campus Admins.">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any internal verification remarks or confirmation ticket numbers..."
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" variant={decision === 'rejected' ? 'danger' : 'default'} size="sm" loading={busy}>
                Record Decision
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function StudentsManagementPage() {
  const [q, setQ] = React.useState('');
  const [verificationStatus, setVerificationStatus] = React.useState<string>('');
  const [department, setDepartment] = React.useState('');
  const [accountStatus, setAccountStatus] = React.useState('');
  const [page, setPage] = React.useState(1);

  // Selected student for verification modal
  const [selectedStudent, setSelectedStudent] = React.useState<StudentItem | null>(null);
  const [verificationModalOpen, setVerificationModalOpen] = React.useState(false);

  const params = new URLSearchParams({
    role: 'student',
    page: String(page),
    limit: '25',
    ...(q ? { q } : {}),
    ...(verificationStatus ? { verificationStatus } : {}),
    ...(department ? { department } : {}),
    ...(accountStatus ? { status: accountStatus } : {}),
  });

  const { data, isLoading, error, mutate } = useApi<{
    items: StudentItem[];
    total: number;
    page: number;
    pages: number;
  }>(`/super-admin/users?${params}`);

  async function executeAction(actionLabel: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      toast.success(actionLabel);
      void mutate();
    } catch (err) {
      toast.error((err as Error).message || 'Action failed');
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title="Students Directory & Enrollment Management"
        description="Comprehensive management of campus residents and scholars. Verify institutional enrollment status, manage credentials, resolve account lockouts, and inspect security health."
      />

      {/* Verification Modal */}
      <VerificationModal
        student={selectedStudent}
        open={verificationModalOpen}
        onOpenChange={setVerificationModalOpen}
        onSuccess={() => void mutate()}
      />

      {/* Toolbar & Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input
            className="pl-10 pr-9 text-xs"
            placeholder="Search students by name, email, student ID, department..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          {q && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-soft hover:text-ink-strong"
              onClick={() => {
                setQ('');
                setPage(1);
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Enrollment Verification Filter */}
          <Select
            className="w-44 text-xs"
            value={verificationStatus}
            onChange={(e) => {
              setVerificationStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Verification States</option>
            {STUDENT_VERIFICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STUDENT_VERIFICATION_LABELS[s]}
              </option>
            ))}
          </Select>

          {/* Department Filter */}
          <Select
            className="w-40 text-xs"
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>

          {/* Account Status Filter */}
          <Select
            className="w-36 text-xs"
            value={accountStatus}
            onChange={(e) => {
              setAccountStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Statuses</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ACCOUNT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>

          {(q || verificationStatus || department || accountStatus) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ('');
                setVerificationStatus('');
                setDepartment('');
                setAccountStatus('');
                setPage(1);
              }}
            >
              Reset
            </Button>
          )}

          <Button variant="outline" size="sm" onClick={() => void mutate()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Student Records Table */}
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : error ? (
        <Alert tone="rose" title="Failed to load students directory">
          {(error as Error).message || 'Server error loading student accounts'}
        </Alert>
      ) : !data?.items?.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<GraduationCap className="h-10 w-10 text-slate-400" />}
            title="No students found"
            description="No student records matched your search query or filter criteria."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <tr>
                  <th className="px-5 py-3.5">Student / Identity</th>
                  <th className="px-4 py-3.5">Student ID</th>
                  <th className="px-4 py-3.5">Department & Year</th>
                  <th className="px-4 py-3.5">Institutional Enrollment</th>
                  <th className="px-4 py-3.5">Account Status</th>
                  <th className="px-4 py-3.5">Last Active</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((student) => {
                  const isVerified = student.verificationStatus === 'approved';
                  const isPending = student.verificationStatus === 'pending' || student.verificationStatus === 'under_review';

                  return (
                    <tr key={student.id} className="hover:bg-mint/20 transition-colors">
                      {/* Name & Email */}
                      <td className="px-5 py-3.5">
                        <div className="flex flex-col">
                          <span className="font-bold text-ink-strong text-sm">{student.fullName}</span>
                          <span className="text-xs text-ink-soft font-mono">{student.email}</span>
                          <div className="flex items-center gap-2 mt-1">
                            {student.emailVerified ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-forest">
                                <Check className="h-3 w-3" /> Email verified
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                <Clock className="h-3 w-3" /> Email unverified
                              </span>
                            )}
                            {student.mustChangePassword && (
                              <Badge tone="amber" className="text-[10px]">
                                Password Change Required
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Student ID */}
                      <td className="px-4 py-3.5 font-mono text-xs font-semibold text-ink-strong">
                        {student.studentId || <span className="text-slate-300 font-sans italic">Not entered</span>}
                      </td>

                      {/* Department & Year */}
                      <td className="px-4 py-3.5 text-xs text-ink">
                        <p className="font-medium text-ink-strong">{student.department || 'Undeclared'}</p>
                        <p className="text-[11px] text-ink-soft">
                          {student.academicYear ? `Academic Year ${student.academicYear}` : 'Year unassigned'}
                        </p>
                      </td>

                      {/* Enrollment Verification */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={isVerified ? 'brand' : isPending ? 'amber' : 'rose'} className="text-[11px]">
                            {STUDENT_VERIFICATION_LABELS[student.verificationStatus]}
                          </Badge>
                          {student.verificationReviewedAt && (
                            <span className="text-[10px] text-ink-soft">
                              Reviewed {timeAgo(student.verificationReviewedAt)}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Account Status */}
                      <td className="px-4 py-3.5">
                        <Badge
                          tone={
                            student.accountStatus === 'active'
                              ? 'brand'
                              : student.accountStatus === 'suspended'
                              ? 'rose'
                              : 'neutral'
                          }
                        >
                          {ACCOUNT_STATUS_LABELS[student.accountStatus]}
                        </Badge>
                      </td>

                      {/* Last Active */}
                      <td className="px-4 py-3.5 text-xs text-ink-soft">
                        {student.lastLoginAt ? timeAgo(student.lastLoginAt) : 'Never signed in'}
                      </td>

                      {/* Action Menu */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="soft"
                            size="sm"
                            className="text-xs h-8 px-2.5"
                            onClick={() => {
                              setSelectedStudent(student);
                              setVerificationModalOpen(true);
                            }}
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            Verify
                          </Button>

                          <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                              <DropdownMenu.Content
                                align="end"
                                className="z-50 min-w-[210px] rounded-xl border border-line bg-white p-1 text-xs shadow-lift"
                              >
                                <DropdownMenu.Item
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                  onSelect={() => {
                                    setSelectedStudent(student);
                                    setVerificationModalOpen(true);
                                  }}
                                >
                                  <UserCheck className="h-4 w-4 text-brand-700" />
                                  Enrollment Decision
                                </DropdownMenu.Item>

                                <DropdownMenu.Item
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                  onSelect={() =>
                                    executeAction('Password reset link sent to student', () =>
                                      api.post(`/super-admin/users/${student.id}/force-password-reset`)
                                    )
                                  }
                                >
                                  <KeyRound className="h-4 w-4 text-ink-soft" />
                                  Send Password Reset Link
                                </DropdownMenu.Item>

                                <DropdownMenu.Item
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                  onSelect={() =>
                                    executeAction('Password change forced on next login', () =>
                                      api.post(`/super-admin/users/${student.id}/force-password-change`)
                                    )
                                  }
                                >
                                  <Lock className="h-4 w-4 text-amber-700" />
                                  Force Password Change
                                </DropdownMenu.Item>

                                <DropdownMenu.Item
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                  onSelect={() =>
                                    executeAction('Unlocked student account', () =>
                                      api.post(`/super-admin/users/${student.id}/unlock`)
                                    )
                                  }
                                >
                                  <ShieldCheck className="h-4 w-4 text-forest" />
                                  Unlock Account Lockout
                                </DropdownMenu.Item>

                                {!student.emailVerified && (
                                  <DropdownMenu.Item
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                    onSelect={() =>
                                      executeAction('Verification email resent', () =>
                                        api.post(`/super-admin/users/${student.id}/resend-verification`)
                                      )
                                    }
                                  >
                                    <Mail className="h-4 w-4 text-brand-700" />
                                    Resend Verification Email
                                  </DropdownMenu.Item>
                                )}

                                <DropdownMenu.Separator className="my-1 h-px bg-slate-100" />

                                <DropdownMenu.Item
                                  className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 outline-none hover:bg-brand-50"
                                  onSelect={() =>
                                    executeAction('All active sessions revoked', () =>
                                      api.post(`/super-admin/users/${student.id}/revoke-sessions`)
                                    )
                                  }
                                >
                                  <LogOut className="h-4 w-4 text-ink-soft" />
                                  Revoke All Active Sessions
                                </DropdownMenu.Item>

                                {student.accountStatus === 'active' ? (
                                  <DropdownMenu.Item
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-rose-700 outline-none hover:bg-rose-50"
                                    onSelect={() =>
                                      executeAction('Student account suspended', () =>
                                        api.post(`/super-admin/users/${student.id}/status`, {
                                          action: 'suspend',
                                          reason: 'Administrative restriction by Super Admin',
                                        })
                                      )
                                    }
                                  >
                                    <UserX className="h-4 w-4" />
                                    Suspend Student Account
                                  </DropdownMenu.Item>
                                ) : (
                                  <DropdownMenu.Item
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-emerald-700 outline-none hover:bg-emerald-50"
                                    onSelect={() =>
                                      executeAction('Student account reactivated', () =>
                                        api.post(`/super-admin/users/${student.id}/status`, { action: 'reactivate' })
                                      )
                                    }
                                  >
                                    <UserCheck className="h-4 w-4" />
                                    Reactivate Account
                                  </DropdownMenu.Item>
                                )}
                              </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                          </DropdownMenu.Root>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-line bg-slate-50/50 px-5 py-3 text-xs text-ink-soft">
            <span>
              Showing page {data.page} of {data.pages} ({data.total} total students)
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
