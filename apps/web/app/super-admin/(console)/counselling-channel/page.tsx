'use client';

import * as React from 'react';
import { BadgeCheck, Lock, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Avatar, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton } from '@/components/ui/primitives';
import { ConfirmDialog } from '@/components/ui/dialog';

interface PublisherRow {
  userId: string;
  name: string;
  email: string;
  accountStatus: string;
  publisher: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  note: string | null;
}

/**
 * Verifies which counsellors may publish as "Official Counselling Support". The counsellor role
 * alone never grants publishing; every grant and revocation is audited.
 */
export default function CounsellingChannelPage() {
  const { data, error, mutate } = useApi<PublisherRow[]>('/community/channels/counselling/publishers');
  const [target, setTarget] = React.useState<{ row: PublisherRow; action: 'verify' | 'revoke' } | null>(null);
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      if (target.action === 'verify') {
        await api.post('/community/channels/counselling/publishers', { userId: target.row.userId, note: note.trim() || null });
        toast.success(`${target.row.name} can now publish official posts`);
      } else {
        await api.delete(`/community/channels/counselling/publishers/${target.row.userId}`);
        toast.success(`Publishing access removed for ${target.row.name}`);
      }
      setTarget(null);
      setNote('');
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error.message} onRetry={() => mutate()} />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Official Counselling Support"
        description="Choose which counsellors may publish in the official channel. Students see their posts with a verified badge."
      />
      <Alert tone="neutral" icon={<Lock className="h-4 w-4" />}>
        Verification only grants publishing in the channel. It gives no access to private counselling conversations, which stay between the student and their counsellor. Grants and revocations are recorded in the audit log.
      </Alert>
      <Card>
        <CardHeader title="Counsellors" description="Accounts with the counsellor role. Assign the role itself from Users." />
        {!data ? (
          <div className="space-y-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : data.length === 0 ? (
          <EmptyState title="No counsellor accounts yet" description="Invite counsellors from Users, then verify them here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((row) => (
              <li key={row.userId} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar name={row.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-strong">{row.name}</span>
                    {row.publisher ? <Badge tone="brand"><BadgeCheck className="h-3 w-3" /> Verified publisher</Badge> : <Badge>Not verified</Badge>}
                    {row.accountStatus !== 'active' && <Badge tone="amber">Account {row.accountStatus}</Badge>}
                  </div>
                  <p className="truncate text-sm text-ink-soft">{row.email}</p>
                  {row.publisher && row.verifiedAt && (
                    <p className="text-xs text-ink-soft">Verified {formatDateTime(row.verifiedAt)}{row.verifiedBy ? ` by ${row.verifiedBy}` : ''}{row.note ? ` · ${row.note}` : ''}</p>
                  )}
                  {!row.publisher && row.revokedAt && (
                    <p className="text-xs text-ink-soft">Revoked {formatDateTime(row.revokedAt)}{row.revokedBy ? ` by ${row.revokedBy}` : ''}</p>
                  )}
                </div>
                {row.publisher ? (
                  <Button variant="outline" onClick={() => setTarget({ row, action: 'revoke' })}><ShieldOff className="h-4 w-4" /> Revoke</Button>
                ) : (
                  <Button variant="brand" disabled={row.accountStatus !== 'active'} onClick={() => setTarget({ row, action: 'verify' })}><BadgeCheck className="h-4 w-4" /> Verify</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => { if (!o) { setTarget(null); setNote(''); } }}
        title={target?.action === 'verify' ? `Verify ${target?.row.name}?` : `Revoke publishing for ${target?.row.name}?`}
        description={target?.action === 'verify'
          ? 'They will be able to publish, edit and pin posts as Official Counselling Support. Confirm you have checked their credentials.'
          : 'They will no longer be able to publish. Their existing posts stay up unless they delete them.'}
        confirmLabel={target?.action === 'verify' ? 'Verify publisher' : 'Revoke'}
        destructive={target?.action === 'revoke'}
        loading={busy}
        onConfirm={confirm}
      >
        {target?.action === 'verify' && (
          <Field id="verify-note" label="Verification note (optional)" hint="For example, how their credentials were checked.">
            <Input id="verify-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}
