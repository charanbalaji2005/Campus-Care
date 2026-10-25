'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Building2, FileClock, FolderKanban, Loader2, Search, Siren, UserRound, UsersRound, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Hit { id: string; title: string; subtitle: string; href: string }
type Results = Partial<Record<'users' | 'incidents' | 'alerts' | 'committees' | 'responders' | 'audit', Hit[]>>;

const SECTIONS: { key: keyof Results; label: string; icon: LucideIcon }[] = [
  { key: 'alerts', label: 'Emergency alerts', icon: Siren },
  { key: 'incidents', label: 'Case references', icon: FolderKanban },
  { key: 'responders', label: 'Responders', icon: UserRound },
  { key: 'users', label: 'Users', icon: UsersRound },
  { key: 'committees', label: 'Committees', icon: Building2 },
  { key: 'audit', label: 'Audit records', icon: FileClock },
];

/**
 * Console-wide search. The server decides which sections the administrator may search; complaint
 * text, counselling notes, messages and locations are never searchable.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Results | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (q.trim().length < 2) { setResults(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<Results>(`/admin/search?q=${encodeURIComponent(q.trim())}`);
        if (!cancelled) { setResults(r); setError(null); setActive(0); }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Search failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const flat = SECTIONS.flatMap((s) => (results?.[s.key] ?? []).map((h) => ({ ...h, section: s })));
  function go(h: Hit) {
    setOpen(false);
    setQ('');
    router.push(h.href);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-xl border border-line bg-stone-50 px-3 text-sm text-ink-soft transition hover:border-brand-300 hover:bg-white md:flex" aria-label="Search the console">
        <Search className="h-4 w-4" aria-hidden />
        <span className="flex-1 text-left">Search people, cases, alerts…</span>
        <kbd className="rounded border border-line bg-white px-1.5 font-mono text-[10px] text-ink-soft">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl p-2 text-ink hover:bg-brand-50 md:hidden" aria-label="Search"><Search className="h-5 w-5" /></button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-forest-900/40 backdrop-blur-sm" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-white shadow-lift focus:outline-none">
            <DialogPrimitive.Title className="sr-only">Search the console</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Results only include records you are permitted to see.</DialogPrimitive.Description>
            <div className="flex items-center gap-3 border-b border-line px-4">
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-ink-soft" /> : <Search className="h-4 w-4 text-ink-soft" />}
              <input
                autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, CC-2026-…, SOS-2026-…, audit action"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-soft" aria-label="Search"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  if (e.key === 'Enter' && flat[active]) go(flat[active]!);
                }}
              />
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2" role="listbox" aria-label="Search results">
              {q.trim().length < 2 && <p className="px-3 py-6 text-center text-sm text-ink-soft">Complaints are found by case number only. Message content, counselling notes and locations are never searchable.</p>}
              {error && <p className="px-3 py-6 text-center text-sm text-rose-700">{error}</p>}
              {results && !flat.length && !loading && <p className="px-3 py-6 text-center text-sm text-ink-soft">No results you have access to.</p>}
              {SECTIONS.filter((s) => results?.[s.key]?.length).map((s) => (
                <div key={s.key} className="mb-1">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{s.label}</p>
                  {results![s.key]!.map((h) => {
                    const idx = flat.findIndex((f) => f.id === h.id && f.section.key === s.key);
                    return (
                      <button key={h.id} type="button" role="option" aria-selected={idx === active} onMouseEnter={() => setActive(idx)} onClick={() => go(h)}
                        className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left', idx === active ? 'bg-brand-50' : 'hover:bg-stone-50')}>
                        <s.icon className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink-strong">{h.title}</span><span className="block truncate text-xs text-ink-soft">{h.subtitle}</span></span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
