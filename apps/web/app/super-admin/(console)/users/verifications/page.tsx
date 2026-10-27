'use client';

import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Filter,
  GraduationCap,
  Info,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import {
  DEPARTMENTS,
  STUDENT_VERIFICATION_LABELS,
  STUDENT_VERIFICATION_STATUSES,
  type StudentVerificationStatus,
} from '@campuscare/shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@/components/ui/primitives';

interface QueueItem {
  id: string;
  fullName: string;
  email: string;
  studentId: string | null;
  department: string | null;
  academicYear: number | null;
  emailVerified: boolean;
  verificationStatus: StudentVerificationStatus;
  verificationReviewedAt: string | null;
  verificationReason: string | null;
  verificationNotes: string | null;
  isDuplicateStudentId?: boolean;
  createdAt: string;
}

export default function VerificationsPage() {
  const [q, setQ] = React.useState('');
  const [status, setStatus] = React.useState<string>('pending');
  const [page, setPage] = React.useState(1);

  // Modal state
  const [selectedStudent, setSelectedStudent] = React.useState<QueueItem | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [decision, setDecision] = React.useState<StudentVerificationStatus>('approved');
  const [reason, setReason] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const params = new URLSearchParams({
    page: String(page),
    limit: '25',
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  });

  const { data, isLoading, error, mutate } = useApi<{
    items: QueueItem[];
    total: number;
    page: number;
    pages: number;
  }>(`/super-admin/users/verifications/queue?${params}`);

  function openReview(student: QueueItem) {
    setSelectedStudent(student);
    setDecision(student.verificationStatus === 'pending' ? 'approved' : student.verificationStatus);
    setReason(student.verificationReason ?? '');
    setNotes(student.verificationNotes ?? '');
    setModalOpen(true);
  }

  async function submitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedStudent) return;
    if (decision === 'rejected' && (!reason || reason.trim().length < 5)) {
      toast.error('A mandatory justification reason (min 5 chars) is required when rejecting verification.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/super-admin/users/${selectedStudent.id}/verify-enrollment`, {
        status: decision,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`Verification ${STUDENT_VERIFICATION_LABELS[decision]} for ${selectedStudent.fullName}`);
      setModalOpen(false);
      void mutate();
    } catch (err) {
      toast.error((err as Error).message || 'Failed to record decision');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Manual Student Enrollment Verification Center"
        description="Verify institutional eligibility and registrar enrollment records. Separate institutional verification from email verification to protect campus security and prevent unauthorized access."
      />

      {/* Info Banner */}
      <Alert tone="brand" icon={<ShieldCheck className="h-5 w-5 text-forest" />}>
        <p className="text-xs text-forest leading-relaxed">
          Verifying a university email does not automatically grant student privileges. Each scholar must be vetted against institutional
          enrollment records and assigned a verified Student ID before gaining access to campus-wide community discussions.
        </p>
      </Alert>

      {/* Filter Tabs & Search */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Status Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: '', label: 'All Requests' },
            { id: 'pending', label: 'Pending Review' },
            { id: 'under_review', label: 'Under Review' },
            { id: 'needs_info', label: 'More Info Needed' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setStatus(tab.id);
                setPage(1);
              }}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                status === tab.id
                  ? 'bg-forest text-white shadow-xs'
                  : 'bg-slate-100 text-ink-soft hover:bg-slate-200 hover:text-ink-strong'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <Input
            className="pl-10 pr-9 text-xs"
            placeholder="Search queue by name, ID, email..."
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
      </div>

      {/* Queue Table */}
      {isLoading ? (
        <Skeleton className="h-96" />
      ) : error ? (
        <Alert tone="rose" title="Failed to load verification queue">
          {(error as Error).message || 'Server error loading verification records'}
        </Alert>
      ) : !data?.items?.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<CheckCheck className="h-10 w-10 text-emerald-500" />}
            title="Verification queue clear"
            description="There are no student accounts currently matching this verification status."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-soft border-b border-line">
                <tr>
                  <th className="px-5 py-3.5">Student / Contact</th>
                  <th className="px-4 py-3.5">Claimed Student ID</th>
                  <th className="px-4 py-3.5">Department & Year</th>
                  <th className="px-4 py-3.5">Email Status</th>
                  <th className="px-4 py-3.5">Verification Status</th>
                  <th className="px-4 py-3.5">Submission Date</th>
                  <th className="px-5 py-3.5 text-right">Review Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item) => (
                  <tr key={item.id} className="hover:bg-mint/20 transition-colors">
                    {/* Student Name & Email */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-bold text-ink-strong text-sm">{item.fullName}</span>
                        <span className="text-xs text-ink-soft font-mono">{item.email}</span>
                      </div>
                    </td>

                    {/* Student ID & Duplicate Warning */}
                    <td className="px-4 py-3.5 font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-ink-strong">
                          {item.studentId || <span className="text-slate-300 font-sans italic">Not provided</span>}
                        </span>
                        {item.isDuplicateStudentId && (
                          <Badge tone="rose" className="text-[10px]">
                            <AlertTriangle className="h-3 w-3 mr-0.5" />
                            Duplicate ID
                          </Badge>
                        )}
                      </div>
                    </td>

                    {/* Department & Year */}
                    <td className="px-4 py-3.5 text-xs text-ink">
                      <p className="font-medium text-ink-strong">{item.department || 'Undeclared'}</p>
                      <p className="text-[11px] text-ink-soft">
                        {item.academicYear ? `Year ${item.academicYear}` : 'Year unassigned'}
                      </p>
                    </td>

                    {/* Email Verification */}
                    <td className="px-4 py-3.5">
                      <Badge tone={item.emailVerified ? 'brand' : 'amber'}>
                        {item.emailVerified ? 'Verified' : 'Unverified'}
                      </Badge>
                    </td>

                    {/* Verification Status */}
                    <td className="px-4 py-3.5">
                      <Badge
                        tone={
                          item.verificationStatus === 'approved'
                            ? 'brand'
                            : item.verificationStatus === 'pending' || item.verificationStatus === 'under_review'
                            ? 'amber'
                            : 'rose'
                        }
                      >
                        {STUDENT_VERIFICATION_LABELS[item.verificationStatus]}
                      </Badge>
                    </td>

                    {/* Submission Date */}
                    <td className="px-4 py-3.5 text-xs text-ink-soft">
                      {timeAgo(item.createdAt)}
                    </td>

                    {/* Action */}
                    <td className="px-5 py-3.5 text-right">
                      <Button variant="brand" size="sm" className="h-8 text-xs" onClick={() => openReview(item)}>
                        <UserCheck className="h-3.5 w-3.5 mr-1" />
                        Review Decision
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-line bg-slate-50/50 px-5 py-3 text-xs text-ink-soft">
            <span>
              Showing page {data.page} of {data.pages} ({data.total} records in queue)
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

      {/* Review Dialog */}
      <Dialog.Root open={modalOpen} onOpenChange={setModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-white p-6 shadow-lift">
            <div className="flex items-start justify-between border-b border-line pb-4">
              <div>
                <Dialog.Title className="text-base font-bold text-ink-strong">
                  Review Institutional Enrollment
                </Dialog.Title>
                <Dialog.Description className="text-xs text-ink-soft mt-0.5">
                  Confirm enrollment status against university student registry.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="text-ink-soft hover:text-ink-strong">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {selectedStudent && (
              <form onSubmit={submitDecision} className="mt-4 space-y-4">
                {selectedStudent.isDuplicateStudentId && (
                  <Alert tone="rose" title="Duplicate Student ID Detected" icon={<AlertTriangle className="h-4 w-4" />}>
                    Another registered account shares the student ID &quot;{selectedStudent.studentId}&quot;. Please inspect carefully
                    to prevent account impersonation.
                  </Alert>
                )}

                <div className="rounded-xl border border-line bg-slate-50 p-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink-strong text-sm">{selectedStudent.fullName}</span>
                    <span className="font-mono text-ink-soft">{selectedStudent.email}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200/60 text-ink-soft">
                    <div>
                      <span className="font-semibold text-ink-strong">Student ID:</span> {selectedStudent.studentId ?? 'None'}
                    </div>
                    <div>
                      <span className="font-semibold text-ink-strong">Department:</span> {selectedStudent.department ?? 'None'}
                    </div>
                  </div>
                </div>

                <Field id="rev-decision" label="Verification Decision" required>
                  <Select value={decision} onChange={(e) => setDecision(e.target.value as StudentVerificationStatus)}>
                    <option value="approved">Approve & Verify (Confirm Enrollment)</option>
                    <option value="under_review">Mark Under Review (Investigation Active)</option>
                    <option value="needs_info">Request Corrections / Resubmission</option>
                    <option value="rejected">Reject (Invalid / Fraudulent ID)</option>
                    <option value="revoked">Revoke Previously Granted Verification</option>
                  </Select>
                </Field>

                <Field
                  id="rev-reason"
                  label="Decision Justification"
                  hint="Mandatory when rejecting or requesting additional information."
                  required={decision === 'rejected' || decision === 'needs_info'}
                >
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Provide justification reason..."
                  />
                </Field>

                <Field id="rev-notes" label="Internal Reviewer Notes" hint="Optional notes logged for compliance audits.">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add reviewer notes..."
                  />
                </Field>

                <div className="flex justify-end gap-2 pt-2 border-t border-line">
                  <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant={decision === 'rejected' ? 'danger' : 'default'}
                    size="sm"
                    loading={busy}
                  >
                    Confirm & Record Decision
                  </Button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
