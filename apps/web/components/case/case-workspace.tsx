'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, EyeOff, Lock, ShieldAlert, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { PRIORITIES, STATUS_LABELS, STATUS_TRANSITIONS, type IncidentStatus } from '@campuscare/shared';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Input, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ActivityTimeline, EvidenceList, PriorityBadge, StatusBadge, categoryLabel, type IncidentView, type TimelineItem } from './case-ui';
import { CaseChat } from './case-chat';

interface Detail {
  incident: IncidentView;
  timeline: TimelineItem[];
  permissions: { canChat: boolean; canUpdateStatus: boolean; canAssign: boolean; canAddNotes: boolean };
}

function StatusDialog({ incident, open, onOpenChange, onDone, triageOnly }: { incident: IncidentView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void; triageOnly: boolean }) {
  const options = STATUS_TRANSITIONS[incident.status].filter((s) => !triageOnly || ['triage', 'assigned', 'rejected', 'escalated'].includes(s));
  const [to, setTo] = React.useState<IncidentStatus | ''>('');
  const [note, setNote] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    if (!to) return;
    setBusy(true);
    try {
      await api.patch(`/incidents/${incident.id}/status`, { status: to, studentVisibleNote: note || undefined, reason: reason || undefined });
      toast.success(`Status changed to ${STATUS_LABELS[to]}`);
      onOpenChange(false);
      setTo(''); setNote(''); setReason('');
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Update case status" description="Only valid workflow steps are offered. Every change is audited.">
        <div className="space-y-4">
          <Field id="to" label="New status"><Select value={to} onChange={(e) => setTo(e.target.value as IncidentStatus)}><option value="">Choose…</option>{options.map((o) => <option key={o} value={o}>{STATUS_LABELS[o]}</option>)}</Select></Field>
          <Field id="note" label="Update for the student" hint={to === 'resolved' ? 'Required: summarise the outcome for the student.' : 'Optional. The student sees this text.'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
          {(to === 'closed' || to === 'rejected' || to === 'escalated') && (
            <Field id="reason" label="Internal reason" hint="Recorded as an internal note; not shown to the student."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
          )}
          <Button className="w-full" loading={busy} disabled={!to} onClick={submit}>Save status</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ incident, open, onOpenChange, onDone, chairOnly }: { incident: IncidentView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void; chairOnly: boolean }) {
  const { data: committees } = useApi<{ id: string; name: string }[]>(open ? '/committees' : null);
  const [committeeId, setCommitteeId] = React.useState(incident.committee?.id ?? '');
  const { data: staff } = useApi<{ id: string; name: string; role: string }[]>(open && committeeId ? `/incidents/${incident.id}/assignable-staff?committeeId=${committeeId}` : null);
  const [assigneeId, setAssigneeId] = React.useState(incident.assignee?.id ?? '');
  const [priority, setPriority] = React.useState(incident.priority);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/incidents/${incident.id}/assign`, { committeeId, assigneeId: assigneeId || null, priority, reason: reason || undefined });
      toast.success('Assignment saved');
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not assign.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Assign case" description="Choose the authorised committee and, optionally, a case owner from its members.">
        <div className="space-y-4">
          <Field id="committee" label="Committee">
            <Select value={committeeId} onChange={(e) => { setCommitteeId(e.target.value); setAssigneeId(''); }} disabled={chairOnly}>
              <option value="">Choose…</option>{committees?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field id="assignee" label="Case owner (optional)">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Committee queue</option>{staff?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </Field>
          <Field id="priority" label="Priority"><Select value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}</Select></Field>
          <Field id="assign-reason" label="Reason (internal)"><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></Field>
          <Button className="w-full" loading={busy} disabled={!committeeId} onClick={submit}>Save assignment</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InternalNotes({ caseId }: { caseId: string }) {
  const { data, mutate } = useApi<{ id: string; body: string; author: string; createdAt: string }[]>(`/incidents/${caseId}/notes`);
  const [body, setBody] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api.post(`/incidents/${caseId}/notes`, { body });
      setBody('');
      void mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save note.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><EyeOff className="h-4 w-4" /> Internal notes</span>} description="Visible only to authorised case handlers — never to the student." />
      <div className="space-y-3 p-5">
        {data?.map((n) => (
          <div key={n.id} className="rounded-xl bg-amber-50 p-3 text-sm">
            <p className="whitespace-pre-wrap">{n.body}</p>
            <p className="mt-1 text-xs text-ink-soft">{n.author} · {formatDateTime(n.createdAt)}</p>
          </div>
        ))}
        {!data?.length && <p className="text-sm text-ink-soft">No internal notes.</p>}
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an internal note…" maxLength={4000} aria-label="Internal note" />
        <Button size="sm" onClick={add} loading={busy} disabled={!body.trim()}>Add note</Button>
      </div>
    </Card>
  );
}

/** Staff case workspace: shared by committee members, security officers and triage administrators. */
export function CaseWorkspace({ caseId, backHref }: { caseId: string; backHref: string }) {
  const { data, error, isLoading, mutate } = useApi<Detail>(`/incidents/${caseId}`);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-48" /><Skeleton className="h-96" /></div>;
  if (error) return <ErrorState message={error.status === 404 ? 'This case does not exist or you are not authorised to view it.' : error.message} />;
  if (!data) return null;
  const { incident: i, timeline, permissions } = data;
  const triage = i.accessLevel === 'triage';
  const closed = ['closed', 'rejected'].includes(i.status);
  const overdue = i.dueResolveAt && new Date(i.dueResolveAt) < new Date() && !['resolved', 'closed', 'rejected'].includes(i.status);

  return (
    <div className="space-y-6">
      <Link href={backHref} className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700"><ArrowLeft className="h-4 w-4" /> Back to cases</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="tabular text-sm font-semibold text-ink-soft">{i.caseNumber}</p>
          <h1 className="page-title">{i.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={i.status} /><PriorityBadge priority={i.priority} urgent={i.urgent} /><Badge>{categoryLabel(i.category)}</Badge>
            {i.anonymous && <Badge tone="dark">Anonymous reporter</Badge>}
            {overdue && <Badge tone="rose">Overdue</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.canAssign && <Button variant="outline" onClick={() => setAssignOpen(true)}><UserCheck className="h-4 w-4" /> Assign</Button>}
          {permissions.canUpdateStatus && !closed && <Button onClick={() => setStatusOpen(true)}>Update status</Button>}
        </div>
      </div>

      {triage && (
        <Alert tone="amber" icon={<Lock className="h-4 w-4" />} title="Routing view only">
          As an administrator you can route, assign or escalate this case, but its description, evidence and conversation are restricted to the authorised committee. Access to full content needs an explicit, audited grant.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {!triage && (
            <Card>
              <CardHeader title="Report" />
              <div className="space-y-4 p-5 text-sm">
                <p className="whitespace-pre-wrap leading-relaxed">{i.description}</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="muted">Incident date</dt><dd className="font-medium">{formatDate(i.incidentDate)}</dd></div>
                  <div><dt className="muted">Location</dt><dd className="font-medium">{i.location}</dd></div>
                  {i.involvedParties && <div className="sm:col-span-2"><dt className="muted">People involved</dt><dd className="whitespace-pre-wrap font-medium">{i.involvedParties}</dd></div>}
                  <div><dt className="muted">Preferred contact</dt><dd className="font-medium">{humanize(i.preferredContact ?? 'in_app')}</dd></div>
                </dl>
                <div><h3 className="mb-2 font-semibold">Evidence</h3><EvidenceList items={i.evidence ?? []} /></div>
              </div>
            </Card>
          )}
          {permissions.canChat && (
            <section id="chat" aria-label="Case conversation">
              <h2 className="mb-3 text-base font-semibold">Conversation with the reporter</h2>
              <CaseChat caseId={i.id} closed={closed} privacyNote="Only the reporter and authorised case handlers can see this conversation." />
            </section>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Case details" />
            <dl className="space-y-3 p-5 text-sm">
              <div className="flex justify-between gap-3"><dt className="muted">Committee</dt><dd className="text-right font-medium">{i.committee?.name ?? 'Unrouted'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="muted">Case owner</dt><dd className="text-right font-medium">{i.assignee?.name ?? 'Committee queue'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="muted">Submitted</dt><dd className="font-medium">{formatDateTime(i.createdAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="muted">Acknowledge by</dt><dd className="font-medium">{i.acknowledgedAt ? `Done ${formatDate(i.acknowledgedAt)}` : formatDateTime(i.dueAcknowledgeAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="muted">Resolve by</dt><dd className={overdue ? 'font-semibold text-rose-700' : 'font-medium'}>{formatDate(i.dueResolveAt)}</dd></div>
            </dl>
          </Card>
          {i.reporter && (
            <Card>
              <CardHeader title="Reporter" description="Shown to authorised handlers only." />
              <dl className="space-y-2 p-5 text-sm">
                <div><dt className="muted">Name</dt><dd className="font-medium">{i.reporter.name}</dd></div>
                <div><dt className="muted">Email</dt><dd className="font-medium">{i.reporter.email}</dd></div>
                {i.reporter.studentId && <div><dt className="muted">Student ID</dt><dd className="font-medium">{i.reporter.studentId}</dd></div>}
                {i.reporter.phone && <div><dt className="muted">Phone (preferred contact)</dt><dd className="font-medium">{i.reporter.phone}</dd></div>}
              </dl>
            </Card>
          )}
          {i.anonymous && !triage && <Alert tone="neutral" icon={<ShieldAlert className="h-4 w-4" />}>The reporter chose to stay anonymous. Use the conversation to ask follow-up questions; do not try to identify them.</Alert>}
          <Card><CardHeader title="Activity" /><div className="p-5"><ActivityTimeline items={timeline} /></div></Card>
          {permissions.canAddNotes && <InternalNotes caseId={i.id} />}
        </div>
      </div>

      <StatusDialog incident={i} open={statusOpen} onOpenChange={setStatusOpen} onDone={() => mutate()} triageOnly={triage} />
      <AssignDialog incident={i} open={assignOpen} onOpenChange={setAssignOpen} onDone={() => mutate()} chairOnly={!triage} />
    </div>
  );
}
