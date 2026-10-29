'use client';

import * as React from 'react';
import { Check, FileText, Filter, HelpCircle, RefreshCw, Search, ShieldCheck, UserPlus, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import {
  STAFF_APPLICATION_STATUS_LABELS,
  STAFF_REGISTRATION_ROLE_INFO,
  STUDENT_VERIFICATION_LABELS,
  type StaffApplicationStatus,
  type StudentVerificationStatus,
} from '@campuscare/shared';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';

interface Statuses {
  registration: StaffApplicationStatus;
  registrationLabel: string;
  emailVerification: 'verified' | 'pending';
  identityVerification: StudentVerificationStatus;
  roleApproval: string;
  accountActivation: string;
}
interface Item {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  staffId: string;
  requestedRole: string;
  requestedRoleLabel: string;
  campus: string;
  department: string;
  designation: string;
  committeeName: string | null;
  registrationMethod: 'password' | 'google';
  statuses: Statuses;
  evidenceCount: number;
  submittedAt: string;
}
interface Detail extends Item {
  phone: string | null;
  counsellor: { specializations: string[]; languages: string[]; qualifications: string | null; bio: string | null; experienceYears: number | null; sessionModes: string[] } | null;
  admin: { authorizationReference: string | null } | null;
  committee: { committeeName: string | null; position: string; identifierType: string; reason: string | null; experience: string | null } | null;
  security: { serviceProvider: string | null; shiftPreference: string; qualifications: string | null; authorizationReference: string | null } | null;
  infoRequest: string | null;
  applicantNote: string | null;
  decisionReason: string | null;
  granted: Record<string, unknown> | null;
  evidence: { id: string; evidenceType: string; mime: string; size: number; status: string; createdAt: string; initialRecommendation: string | null; initialReviewNotes: string | null; fileUrl: string }[];
  history: { at: string; action: string; from: string | null; to: string | null; reason: string | null; actorRole: string | null; actorName: string | null }[];
  audit: { action: string; at: string; actorRole: string | null; actorName: string | null; outcome: string | null; reason: string | null }[];
}

const tone = (v: string): 'brand' | 'amber' | 'rose' | 'neutral' =>
  ['approved', 'verified', 'active'].includes(v) ? 'brand' : ['rejected', 'revoked', 'suspended'].includes(v) ? 'rose' : ['needs_info', 'pending_email_verification', 'pending'].includes(v) ? 'amber' : 'neutral';
const label = (v: string) =>
  (STAFF_APPLICATION_STATUS_LABELS as Record<string, string>)[v] ?? (STUDENT_VERIFICATION_LABELS as Record<string, string>)[v] ?? v.replace(/_/g, ' ');

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm">
      <dt className="text-ink-soft">{k}</dt>
      <dd className="col-span-2 break-words text-ink-strong">{v}</dd>
    </div>
  );
}

/**
 * Super Admin → Staff Registration Requests. Applications from CampusCare College for Counsellor, Campus
 * Admin, Committee Member and Security Officer. Email, identity, role approval and activation are separate:
 * identity is verified first, then the role is approved (the server grants exactly the stored request).
 */
export default function StaffRequestsPage() {
  const [filters, setFilters] = React.useState({ status: 'open', role: '', campus: '', department: '', from: '', to: '', emailVerified: '', identity: '', q: '' });
  const [page, setPage] = React.useState(1);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  for (const [k, v] of Object.entries(filters)) if (v && !(k === 'status' && v === 'open')) params.set(k, v);
  const { data, isLoading, error, mutate } = useApi<{ items: Item[]; total: number; pages: number; counts: Record<string, number>; campuses: { id: string; name: string }[] }>(`/super-admin/staff-applications?${params}`);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Staff Registration Requests"
        description="Applications from CampusCare College. Verify the applicant's identity, then approve, reject or ask for more information. Nothing is granted until you approve."
        actions={<Button variant="outline" size="sm" onClick={() => void mutate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />
      <Alert tone="brand" icon={<ShieldCheck className="h-5 w-5" />}>
        Email verification, identity verification and role approval are separate. Approval needs a verified email and a verified identity, assigns only the requested role, and scopes it to the requested campus (and committee).
      </Alert>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Approval status">
        {[['open', 'Open'], ['pending_review', 'Pending review'], ['pending_email_verification', 'Awaiting email'], ['needs_info', 'Needs info'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filters.status === id}
            onClick={() => { setFilters((f) => ({ ...f, status: id! })); setPage(1); }}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${filters.status === id ? 'bg-forest text-white shadow-xs' : 'bg-slate-100 text-ink-soft hover:bg-slate-200 hover:text-ink-strong'}`}
          >
            {text}{data?.counts?.[id!] ? ` · ${data.counts[id!]}` : ''}
          </button>
        ))}
      </div>

      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-soft"><Filter className="h-4 w-4" /> Filters</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="f-role" label="Requested role">
            <Select value={filters.role} onChange={set('role')}>
              <option value="">All roles</option>
              {Object.entries(STAFF_REGISTRATION_ROLE_INFO).map(([id, r]) => <option key={id} value={id}>{r.title}</option>)}
            </Select>
          </Field>
          <Field id="f-campus" label="Campus">
            <Select value={filters.campus} onChange={set('campus')}>
              <option value="">All campuses</option>
              {data?.campuses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field id="f-dept" label="Department"><Input value={filters.department} onChange={set('department')} placeholder="e.g. Student Welfare" /></Field>
          <Field id="f-q" label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input className="pl-9" value={filters.q} onChange={set('q')} placeholder="Name, email or staff ID" />
            </div>
          </Field>
          <Field id="f-from" label="Registered from"><Input type="date" value={filters.from} onChange={set('from')} /></Field>
          <Field id="f-to" label="Registered to"><Input type="date" value={filters.to} onChange={set('to')} /></Field>
          <Field id="f-email" label="Email verification">
            <Select value={filters.emailVerified} onChange={set('emailVerified')}>
              <option value="">Any</option><option value="true">Verified</option><option value="false">Not verified</option>
            </Select>
          </Field>
          <Field id="f-identity" label="Identity verification">
            <Select value={filters.identity} onChange={set('identity')}>
              <option value="">Any</option>
              {['pending', 'submitted', 'under_review', 'needs_info', 'approved', 'rejected'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      {isLoading ? (
        <Skeleton className="h-72" />
      ) : error ? (
        <Alert tone="rose" title="Couldn't load staff requests">{(error as Error).message}</Alert>
      ) : !data?.items.length ? (
        <Card><EmptyState icon={<UserPlus className="h-6 w-6" />} title="No staff requests" description="Nothing matches these filters." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs uppercase tracking-wider text-ink-soft">
              <tr><th className="px-4 py-3">Applicant</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Campus · Department</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Identity</th><th className="px-4 py-3">Approval</th><th className="px-4 py-3">Registered</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0 hover:bg-brand-50/40">
                  <td className="px-4 py-3"><p className="font-semibold text-ink-strong">{i.fullName}</p><p className="text-xs text-ink-soft">{i.email} · {i.staffId}</p></td>
                  <td className="px-4 py-3">{i.requestedRoleLabel}{i.committeeName && <p className="text-xs text-ink-soft">{i.committeeName}</p>}</td>
                  <td className="px-4 py-3">{i.campus}<p className="text-xs text-ink-soft">{i.department}</p></td>
                  <td className="px-4 py-3"><Badge tone={tone(i.statuses.emailVerification)}>{i.statuses.emailVerification === 'verified' ? 'Verified' : 'Pending'}</Badge></td>
                  <td className="px-4 py-3"><Badge tone={tone(i.statuses.identityVerification)}>{label(i.statuses.identityVerification)}</Badge>{i.evidenceCount > 0 && <p className="mt-1 text-xs text-ink-soft">{i.evidenceCount} document(s)</p>}</td>
                  <td className="px-4 py-3"><Badge tone={tone(i.statuses.registration)}>{label(i.statuses.registration)}</Badge></td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{timeAgo(i.submittedAt)}</td>
                  <td className="px-4 py-3 text-right"><Button size="sm" variant="soft" onClick={() => setOpenId(i.id)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-ink-soft">
              <span>Page {page} of {data.pages} · {data.total} requests</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}
      {openId && <ReviewDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => void mutate()} />}
    </div>
  );
}

function ReviewDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data: d, isLoading, error, mutate } = useApi<Detail>(`/super-admin/staff-applications/${id}`);
  const [reason, setReason] = React.useState('');
  const [identityNote, setIdentityNote] = React.useState('');
  const [position, setPosition] = React.useState<'member' | 'chair'>('member');
  const [listCounsellor, setListCounsellor] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(kind: string, path: string, body: Record<string, unknown>, done: string) {
    setBusy(kind);
    try {
      await api.post(`/super-admin/staff-applications/${id}/${path}`, body);
      toast.success(done);
      setReason('');
      setIdentityNote('');
      await mutate();
      onChanged();
    } catch (err) {
      toast.error((err as Error).message || 'The decision was not recorded.');
    } finally {
      setBusy(null);
    }
  }

  const s = d?.statuses;
  const open = s && ['pending_review', 'needs_info', 'pending_email_verification'].includes(s.registration);
  const canApprove = s?.registration === 'pending_review' && s.emailVerification === 'verified' && s.identityVerification === 'approved';
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl focus:outline-none" aria-describedby={undefined}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <Dialog.Title className="text-lg font-bold text-ink-strong">{d ? `${d.fullName} · ${d.requestedRoleLabel}` : 'Staff request'}</Dialog.Title>
            <Dialog.Close asChild><button type="button" aria-label="Close" className="rounded-lg p-1 text-ink-soft hover:bg-slate-100"><X className="h-5 w-5" /></button></Dialog.Close>
          </div>
          {isLoading || !d ? (error ? <Alert tone="rose">{(error as Error).message}</Alert> : <Skeleton className="h-96" />) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge tone={tone(d.statuses.registration)}>Approval: {label(d.statuses.registration)}</Badge>
                <Badge tone={tone(d.statuses.emailVerification)}>Email: {d.statuses.emailVerification}</Badge>
                <Badge tone={tone(d.statuses.identityVerification)}>Identity: {label(d.statuses.identityVerification)}</Badge>
                <Badge tone={tone(d.statuses.accountActivation)}>Account: {label(d.statuses.accountActivation)}</Badge>
              </div>

              <section>
                <h3 className="mb-1 text-sm font-semibold text-forest">Submitted details</h3>
                <dl className="divide-y divide-line">
                  <Row k="Email" v={d.email} />
                  <Row k={d.committee?.identifierType === 'student' ? 'Student ID' : 'Staff ID'} v={d.staffId} />
                  <Row k="Department" v={d.department} />
                  <Row k="Designation" v={d.designation} />
                  <Row k="Campus" v={d.campus} />
                  <Row k="Phone" v={d.phone} />
                  <Row k="Registered with" v={d.registrationMethod === 'google' ? 'Google (email confirmed by Google)' : 'Password'} />
                  {d.counsellor && <>
                    <Row k="Specializations" v={d.counsellor.specializations.join(', ')} />
                    <Row k="Languages" v={d.counsellor.languages.join(', ')} />
                    <Row k="Qualifications" v={d.counsellor.qualifications} />
                    <Row k="Experience" v={d.counsellor.experienceYears !== null ? `${d.counsellor.experienceYears} years` : null} />
                    <Row k="Session modes" v={d.counsellor.sessionModes.join(', ')} />
                    <Row k="Biography" v={d.counsellor.bio} />
                  </>}
                  {d.admin && <Row k="Authorization reference" v={d.admin.authorizationReference ?? 'Not provided'} />}
                  {d.committee && <>
                    <Row k="Committee" v={d.committee.committeeName} />
                    <Row k="Requested position" v={d.committee.position} />
                    <Row k="Reason for joining" v={d.committee.reason} />
                    <Row k="Experience" v={d.committee.experience} />
                  </>}
                  {d.security && <>
                    <Row k="Service provider" v={d.security.serviceProvider} />
                    <Row k="Shift preference" v={d.security.shiftPreference.replace(/_/g, ' ')} />
                    <Row k="Qualifications" v={d.security.qualifications} />
                    <Row k="Authorization reference" v={d.security.authorizationReference} />
                  </>}
                  <Row k="Information requested" v={d.infoRequest} />
                  <Row k="Applicant's reply" v={d.applicantNote} />
                  <Row k="Decision reason" v={d.decisionReason} />
                </dl>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-forest">Identity evidence</h3>
                {d.evidence.length === 0 ? <p className="text-sm text-ink-soft">No documents uploaded yet. You can still verify the identity against staff records and record how.</p> : (
                  <ul className="space-y-2">
                    {d.evidence.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3 text-sm">
                        <div>
                          <p className="font-medium text-ink-strong">{e.evidenceType.replace('_', ' ')} · {Math.round(e.size / 1024)} KB · {timeAgo(e.createdAt)}</p>
                          {e.initialRecommendation && <p className="text-xs text-ink-soft">Campus Admin: {e.initialRecommendation.replace(/_/g, ' ')}{e.initialReviewNotes ? ` — ${e.initialReviewNotes}` : ''}</p>}
                        </div>
                        <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={e.fileUrl} target="_blank" rel="noreferrer noopener"><FileText className="h-4 w-4" /> View</a>
                      </li>
                    ))}
                  </ul>
                )}
                {open && d.statuses.identityVerification !== 'approved' && (
                  <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
                    <Field id="identity-note" label="How was the identity checked?" required>
                      <Textarea rows={2} value={identityNote} onChange={(e) => setIdentityNote(e.target.value)} placeholder="e.g. ID card matches HR record EMP-1024" />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" loading={busy === 'id-ok'} disabled={identityNote.trim().length < 3 || !!busy} onClick={() => act('id-ok', 'identity', { status: 'approved', reason: identityNote }, 'Identity verified')}><Check className="h-4 w-4" /> Identity verified</Button>
                      <Button size="sm" variant="outline" loading={busy === 'id-info'} disabled={identityNote.trim().length < 3 || !!busy} onClick={() => act('id-info', 'identity', { status: 'needs_info', reason: identityNote }, 'Asked for better documents')}><HelpCircle className="h-4 w-4" /> Need better documents</Button>
                      <Button size="sm" variant="danger-outline" loading={busy === 'id-no'} disabled={identityNote.trim().length < 3 || !!busy} onClick={() => act('id-no', 'identity', { status: 'rejected', reason: identityNote }, 'Identity not verified')}>Identity not verified</Button>
                    </div>
                  </div>
                )}
              </section>

              {open && (
                <section className="space-y-3 rounded-2xl border border-line p-4">
                  <h3 className="text-sm font-semibold text-forest">Role decision</h3>
                  {!canApprove && s?.registration !== 'needs_info' && (
                    <Alert tone="amber">{s?.emailVerification !== 'verified' ? 'The applicant has not verified their email yet.' : s?.identityVerification !== 'approved' ? 'Verify the applicant’s identity before approving the role.' : 'Waiting for the applicant.'}</Alert>
                  )}
                  {d.committee && (
                    <Field id="position" label="Grant committee position">
                      <Select value={position} onChange={(e) => setPosition(e.target.value as 'member' | 'chair')}><option value="member">Member</option><option value="chair">Chair</option></Select>
                    </Field>
                  )}
                  {d.counsellor && (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={listCounsellor} onChange={(e) => setListCounsellor(e.target.checked)} /> List in the student directory (bookable) on approval</label>
                  )}
                  <Field id="reason" label="Reason or note" hint="Required to reject or to ask for more information. The applicant sees it.">
                    <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button loading={busy === 'approve'} disabled={!canApprove || !!busy} onClick={() => act('approve', 'decision', { decision: 'approve', reason: reason || undefined, ...(d.committee ? { committeePosition: position } : {}), ...(d.counsellor ? { listCounsellor } : {}) }, 'Application approved')}>
                      <Check className="h-4 w-4" /> Approve {d.requestedRoleLabel}
                    </Button>
                    <Button variant="outline" loading={busy === 'info'} disabled={s?.registration !== 'pending_review' || reason.trim().length < 3 || !!busy} onClick={() => act('info', 'decision', { decision: 'needs_info', reason }, 'Asked for more information')}>
                      <HelpCircle className="h-4 w-4" /> Request information
                    </Button>
                    <Button variant="danger-outline" loading={busy === 'reject'} disabled={reason.trim().length < 3 || !!busy} onClick={() => act('reject', 'decision', { decision: 'reject', reason }, 'Application rejected')}>
                      Reject
                    </Button>
                  </div>
                </section>
              )}
              {d.granted && <Alert tone="brand" title="Granted on approval">{Object.entries(d.granted).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</Alert>}

              <section>
                <h3 className="mb-2 text-sm font-semibold text-forest">History</h3>
                <ol className="space-y-1.5 text-sm">
                  {d.history.map((h, n) => (
                    <li key={n} className="flex gap-3"><span className="w-28 shrink-0 text-xs text-ink-soft">{timeAgo(h.at)}</span><span><b>{h.action.replace(/_/g, ' ')}</b>{h.to ? ` → ${label(h.to)}` : ''}{h.actorName ? ` by ${h.actorName}` : ''}{h.reason ? ` — ${h.reason}` : ''}</span></li>
                  ))}
                </ol>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-ink-soft">Audit log ({d.audit.length})</summary>
                  <ol className="mt-2 space-y-1">
                    {d.audit.map((a, n) => <li key={n} className="text-xs text-ink-soft">{timeAgo(a.at)} · {a.action}{a.actorName ? ` · ${a.actorName}` : ''}{a.outcome && a.outcome !== 'success' ? ` · ${a.outcome}` : ''}</li>)}
                  </ol>
                </details>
              </section>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
