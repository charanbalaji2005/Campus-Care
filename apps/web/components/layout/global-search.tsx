'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  ArrowRight,
  Bell,
  Building2,
  CalendarClock,
  CheckCheck,
  Command,
  FileClock,
  FolderKanban,
  GraduationCap,
  LifeBuoy,
  Loader2,
  Megaphone,
  Search,
  ShieldAlert,
  Siren,
  Sparkles,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Hit {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

type Results = Partial<Record<'users' | 'incidents' | 'alerts' | 'committees' | 'responders' | 'audit', Hit[]>>;

const SECTIONS: { key: keyof Results; label: string; icon: LucideIcon }[] = [
  { key: 'alerts', label: 'Emergency alerts', icon: Siren },
  { key: 'incidents', label: 'Case references', icon: FolderKanban },
  { key: 'responders', label: 'Responders', icon: UserRound },
  { key: 'users', label: 'Users & Accounts', icon: UsersRound },
  { key: 'committees', label: 'Committees', icon: Building2 },
  { key: 'audit', label: 'Audit records', icon: FileClock },
];

interface QuickAction {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  shortcut?: string;
  tone?: 'brand' | 'rose' | 'amber' | 'blue';
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'qa-sos',
    label: 'Open Emergency SOS Operations',
    description: 'Dispatch responders, view active alerts and live safety map',
    href: '/super-admin/emergency-alerts',
    icon: Siren,
    shortcut: 'S',
    tone: 'rose',
  },
  {
    id: 'qa-verif',
    label: 'Review Student Verification Queue',
    description: 'Inspect pending student IDs and university enrollment credentials',
    href: '/super-admin/users/verifications',
    icon: CheckCheck,
    shortcut: 'V',
    tone: 'amber',
  },
  {
    id: 'qa-incidents',
    label: 'Triage Complaints & Incidents',
    description: 'Review new case submissions, assign handlers and track resolution',
    href: '/super-admin/chats?cat=reports',
    icon: FolderKanban,
    shortcut: 'I',
    tone: 'blue',
  },
  {
    id: 'qa-support',
    label: 'CampusCare Support Help Desk',
    description: 'Answer student questions, manage FAQs and resolve tickets',
    href: '/super-admin/support',
    icon: LifeBuoy,
    shortcut: 'H',
    tone: 'brand',
  },
  {
    id: 'qa-announcement',
    label: 'Broadcast Campus Announcement',
    description: 'Send campus-wide notices, push notifications and alerts',
    href: '/super-admin/announcements',
    icon: Megaphone,
    shortcut: 'A',
    tone: 'brand',
  },
  {
    id: 'qa-audit',
    label: 'Database Activity & Audit Logs',
    description: 'Inspect append-only mutation stream and verify hash chain integrity',
    href: '/super-admin/audit-logs',
    icon: FileClock,
    shortcut: 'L',
    tone: 'brand',
  },
  {
    id: 'qa-users',
    label: 'Manage Users & Roles',
    description: 'Directory search, invite staff, manage permissions and sessions',
    href: '/super-admin/users',
    icon: Users,
    shortcut: 'U',
    tone: 'brand',
  },
];

/**
 * Console-wide search with Quick Action launchpad.
 * Strict privacy: Complaint details, private counselling notes, and passwords are never returned in search.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [results, setResults] = React.useState<Results | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(0);

  // Keyboard shortcut Ctrl+K / Cmd+K
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

  // Debounced search query
  React.useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<Results>(`/admin/search?q=${encodeURIComponent(q.trim())}`);
        if (!cancelled) {
          setResults(r);
          setError(null);
          setActive(0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Search failed.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const flatResults = SECTIONS.flatMap((s) => (results?.[s.key] ?? []).map((h) => ({ ...h, section: s })));

  function navigateTo(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-xl border border-line bg-stone-50 px-3 text-sm text-ink-soft transition hover:border-brand-300 hover:bg-white md:flex group"
        aria-label="Search the console"
      >
        <Search className="h-4 w-4 text-ink-soft group-hover:text-brand-600 transition-colors" aria-hidden />
        <span className="flex-1 text-left text-xs">Search people, cases, alerts, audit...</span>
        <kbd className="rounded border border-line bg-white px-1.5 font-mono text-[10px] text-ink-soft shadow-2xs">
          Ctrl K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-xl p-2 text-ink hover:bg-brand-50 md:hidden"
        aria-label="Search"
      >
        <Search className="h-5 w-5" />
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-forest-900/50 backdrop-blur-xs" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[10vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-white shadow-lift focus:outline-none">
            <DialogPrimitive.Title className="sr-only">Search the console & Quick Actions</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Search authorized records or trigger quick administrative actions.
            </DialogPrimitive.Description>

            {/* Search Input Bar */}
            <div className="flex items-center gap-3 border-b border-line px-4 bg-white">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
              ) : (
                <Search className="h-4 w-4 text-ink-soft" />
              )}
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, student ID, email, case reference, SOS ID..."
                className="h-14 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-soft"
                aria-label="Search"
                onKeyDown={(e) => {
                  if (flatResults.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActive((a) => Math.min(a + 1, flatResults.length - 1));
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActive((a) => Math.max(a - 1, 0));
                    }
                    if (e.key === 'Enter' && flatResults[active]) {
                      navigateTo(flatResults[active]!.href);
                    }
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  className="rounded-lg p-1 text-xs text-ink-soft hover:bg-slate-100"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Results or Quick Actions */}
            <div className="max-h-[62vh] overflow-y-auto p-2" role="listbox" aria-label="Search results">
              {/* Show Quick Actions when query is empty */}
              {q.trim().length < 2 && (
                <div className="space-y-4 p-2">
                  <div>
                    <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-brand-600" /> Quick Administrative Actions
                      </p>
                      <span className="text-[10px] text-ink-soft">Shortcuts</span>
                    </div>
                    <div className="space-y-1">
                      {QUICK_ACTIONS.map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          onClick={() => navigateTo(action.href)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl p-2.5 text-left transition hover:bg-brand-50/70 group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={cn(
                                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                                action.tone === 'rose'
                                  ? 'bg-rose-50 text-rose-600'
                                  : action.tone === 'amber'
                                  ? 'bg-amber-50 text-amber-600'
                                  : action.tone === 'blue'
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-emerald-50 text-emerald-700'
                              )}
                            >
                              <action.icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <span className="block truncate text-xs font-bold text-ink-strong group-hover:text-forest">
                                {action.label}
                              </span>
                              <span className="block truncate text-[11px] text-ink-soft">
                                {action.description}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {action.shortcut && (
                              <kbd className="hidden rounded border border-line bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono text-ink-soft sm:inline">
                                {action.shortcut}
                              </kbd>
                            )}
                            <ArrowRight className="h-3.5 w-3.5 text-ink-soft group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-ink-soft">
                    <p className="font-semibold text-ink-strong mb-1">Privacy & Security Filter</p>
                    <p className="text-[11px] leading-relaxed">
                      Complaints are searchable by official case number only. Confidential counselling conversations,
                      passwords, tokens, and private messages are strictly excluded from search results.
                    </p>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && <p className="px-3 py-6 text-center text-sm text-rose-700">{error}</p>}

              {/* Empty state when query returned 0 items */}
              {results && !flatResults.length && !loading && q.trim().length >= 2 && (
                <div className="py-8 text-center">
                  <p className="text-sm font-semibold text-ink-strong">No authorized records found</p>
                  <p className="text-xs text-ink-soft mt-1">
                    No results matched &quot;{q}&quot; within your permitted role scope.
                  </p>
                </div>
              )}

              {/* Active Results Grouped by Section */}
              {SECTIONS.filter((s) => results?.[s.key]?.length).map((s) => (
                <div key={s.key} className="mb-2">
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
                    <s.icon className="h-3.5 w-3.5 text-brand-700" />
                    {s.label}
                  </p>
                  {results![s.key]!.map((h) => {
                    const idx = flatResults.findIndex((f) => f.id === h.id && f.section.key === s.key);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        role="option"
                        aria-selected={idx === active}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => navigateTo(h.href)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition',
                          idx === active ? 'bg-brand-50' : 'hover:bg-stone-50'
                        )}
                      >
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink-strong">{h.title}</span>
                          <span className="block truncate text-xs text-ink-soft">{h.subtitle}</span>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-ink-soft shrink-0" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Footer with keyboard guidance */}
            <div className="flex items-center justify-between border-t border-line bg-slate-50 px-4 py-2 text-[11px] text-ink-soft">
              <span>Use <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to navigate, <kbd className="font-mono">Enter</kbd> to select</span>
              <span><kbd className="font-mono">Esc</kbd> to close</span>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
