'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { BookOpenCheck, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, Skeleton, SwitchRow, Textarea } from '@/components/ui/primitives';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';

interface Question { question: string; options: string[]; correctIndex: number }
interface Module { id: string; title: string; category: string; summary: string; durationMinutes: number; sections: { heading: string; body: string }[]; quiz: Question[]; passPercent: number; published: boolean }
type Draft = Omit<Module, 'id'>;
const EMPTY: Draft = { title: '', category: 'Anti-ragging', summary: '', durationMinutes: 10, sections: [{ heading: '', body: '' }], quiz: [], passPercent: 70, published: false };

function ModuleEditor({ initial, onClose, onDone }: { initial: Module | 'new' | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = React.useState<Draft>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (initial === 'new') setV(EMPTY);
    else if (initial) { const { id: _id, ...rest } = initial; setV(rest); }
  }, [initial]);
  if (!initial) return null;

  const setSection = (i: number, patch: Partial<Draft['sections'][number]>) => setV({ ...v, sections: v.sections.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  const setQ = (i: number, patch: Partial<Question>) => setV({ ...v, quiz: v.quiz.map((q, n) => (n === i ? { ...q, ...patch } : q)) });

  async function save() {
    setBusy(true);
    try {
      const body = { ...v, sections: v.sections.filter((s) => s.heading.trim() || s.body.trim()) };
      if (initial === 'new') await api.post('/admin/training', body);
      else await api.patch(`/admin/training/${(initial as Module).id}`, body);
      toast.success('Module saved');
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
      <DialogContent title={initial === 'new' ? 'New training module' : 'Edit module'} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="t-title" label="Title" required className="sm:col-span-2"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field id="t-cat" label="Category"><Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} /></Field>
          </div>
          <Field id="t-sum" label="Summary"><Textarea value={v.summary} maxLength={500} onChange={(e) => setV({ ...v, summary: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="t-dur" label="Duration (minutes)"><Input type="number" min={1} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: Number(e.target.value) })} /></Field>
            <Field id="t-pass" label="Pass mark (%)"><Input type="number" min={0} max={100} value={v.passPercent} onChange={(e) => setV({ ...v, passPercent: Number(e.target.value) })} /></Field>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Sections</h3><Button size="sm" variant="outline" onClick={() => setV({ ...v, sections: [...v.sections, { heading: '', body: '' }] })}><Plus className="h-4 w-4" /> Section</Button></div>
            <div className="space-y-3">
              {v.sections.map((s, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex gap-2"><Input placeholder="Heading" value={s.heading} onChange={(e) => setSection(i, { heading: e.target.value })} aria-label={`Section ${i + 1} heading`} /><Button variant="ghost" size="icon" onClick={() => setV({ ...v, sections: v.sections.filter((_, n) => n !== i) })} aria-label="Remove section"><X className="h-4 w-4" /></Button></div>
                  <Textarea rows={4} placeholder="Content" value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} aria-label={`Section ${i + 1} content`} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Quiz</h3><Button size="sm" variant="outline" onClick={() => setV({ ...v, quiz: [...v.quiz, { question: '', options: ['', ''], correctIndex: 0 }] })}><Plus className="h-4 w-4" /> Question</Button></div>
            <div className="space-y-3">
              {v.quiz.map((q, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-200 p-3">
                  <div className="flex gap-2"><Input placeholder={`Question ${i + 1}`} value={q.question} onChange={(e) => setQ(i, { question: e.target.value })} aria-label={`Question ${i + 1}`} /><Button variant="ghost" size="icon" onClick={() => setV({ ...v, quiz: v.quiz.filter((_, n) => n !== i) })} aria-label="Remove question"><X className="h-4 w-4" /></Button></div>
                  {q.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input type="radio" className="accent-brand-600" name={`correct-${i}`} checked={q.correctIndex === oi} onChange={() => setQ(i, { correctIndex: oi })} aria-label={`Mark option ${oi + 1} correct`} />
                      <Input placeholder={`Option ${oi + 1}`} value={o} onChange={(e) => setQ(i, { options: q.options.map((x, n) => (n === oi ? e.target.value : x)) })} />
                      {q.options.length > 2 && <Button variant="ghost" size="icon" onClick={() => setQ(i, { options: q.options.filter((_, n) => n !== oi), correctIndex: Math.min(q.correctIndex, q.options.length - 2) })} aria-label="Remove option"><X className="h-4 w-4" /></Button>}
                    </div>
                  ))}
                  {q.options.length < 6 && <Button size="sm" variant="ghost" onClick={() => setQ(i, { options: [...q.options, ''] })}>Add option</Button>}
                </div>
              ))}
            </div>
          </div>
          <SwitchRow id="t-pub" label="Published" description="Students only see published modules." checked={v.published} onCheckedChange={(x) => setV({ ...v, published: x })} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save module</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminAwarenessPage() {
  const { data, error, mutate } = useApi<Module[]>('/admin/training');
  const [edit, setEdit] = React.useState<Module | 'new' | null>(null);
  const [del, setDel] = React.useState<Module | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.delete(`/admin/training/${del.id}`);
      setDel(null);
      void mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <PageHeader title="Awareness & training" description="Anti-ragging, gender sensitivity and wellbeing modules with optional quizzes." actions={<Button onClick={() => setEdit('new')}><Plus className="h-4 w-4" /> New module</Button>} />
      {error && <ErrorState message={error.message} onRetry={() => mutate()} />}
      {!data && !error && <Skeleton className="h-48" />}
      {data && !data.length && <Card><EmptyState icon={<BookOpenCheck className="h-6 w-6" />} title="No modules yet" /></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.map((m) => (
          <Card key={m.id} className="flex flex-col p-5">
            <div className="flex items-center gap-2"><Badge tone="brand">{m.category}</Badge>{m.published ? <Badge tone="brand">Published</Badge> : <Badge>Draft</Badge>}</div>
            <h2 className="mt-2 font-semibold">{m.title}</h2>
            <p className="mt-1 line-clamp-3 flex-1 text-sm text-ink-soft">{m.summary}</p>
            <p className="mt-3 text-xs text-ink-soft">{m.durationMinutes} min · {m.sections.length} sections · {m.quiz.length} questions</p>
            <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit(m)}><Pencil className="h-4 w-4" /> Edit</Button><Button size="sm" variant="ghost" onClick={() => setDel(m)}><Trash2 className="h-4 w-4" /> Delete</Button></div>
          </Card>
        ))}
      </div>
      <ModuleEditor initial={edit} onClose={() => setEdit(null)} onDone={() => mutate()} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title={`Delete ${del?.title}?`} description="Student progress records for this module will no longer be shown." destructive confirmLabel="Delete" loading={busy} onConfirm={remove} />
    </div>
  );
}
