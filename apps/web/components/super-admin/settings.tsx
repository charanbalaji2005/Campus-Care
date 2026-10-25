'use client';

import * as React from 'react';
import { toast } from 'sonner';
import { RotateCcw, Save } from 'lucide-react';
import type { PlatformSettings } from '@campuscare/shared';
import { api, errorMessage } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSensitiveAction } from '@/components/providers';
import { Button, Card, CardHeader } from '@/components/ui/primitives';

export function usePlatformSettings() {
  return useApi<{ settings: PlatformSettings; defaults: PlatformSettings }>('/super-admin/settings');
}

type Key = keyof PlatformSettings;

/**
 * Local draft for one settings section. Saving sends only that section; the server
 * merges it, requires recent re-authentication and writes the changed paths to the audit log.
 */
export function useSectionDraft<K extends Key>(key: K, fields?: (keyof PlatformSettings[K])[]) {
  const { data, mutate } = usePlatformSettings();
  const run = useSensitiveAction();
  const [draft, setDraft] = React.useState<PlatformSettings[K] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const server = data?.settings[key];
  const prevServer = React.useRef<PlatformSettings[K] | null>(null);
  // When the server copy changes (e.g. another card on the page saved), refresh only the fields
  // this card has not edited, so unsaved edits elsewhere are never lost.
  React.useEffect(() => {
    if (!server) return;
    setDraft((current) => {
      const prev = prevServer.current;
      if (!current || !prev) return structuredClone(server);
      const next = { ...(current as object) } as Record<string, unknown>;
      for (const k of Object.keys(server as object)) {
        const c = (current as Record<string, unknown>)[k];
        const p = (prev as Record<string, unknown>)[k];
        if (JSON.stringify(c) === JSON.stringify(p)) next[k] = structuredClone((server as Record<string, unknown>)[k]);
      }
      return next as PlatformSettings[K];
    });
    prevServer.current = server;
  }, [server]);
  const pick = (obj: PlatformSettings[K] | null | undefined) => {
    if (!obj || !fields) return obj;
    return Object.fromEntries(fields.map((f) => [f, (obj as Record<string, unknown>)[f as string]]));
  };
  const dirty = !!draft && !!server && JSON.stringify(pick(draft)) !== JSON.stringify(pick(server));

  async function save(extra: Record<string, unknown> = {}) {
    if (!draft) return false;
    setSaving(true);
    try {
      const r = await run(() => api.patch<{ changed: string[] }>('/super-admin/settings', { settings: { [key]: pick(draft) }, ...extra }));
      if (r === undefined) return false;
      toast.success(r.changed.length ? `Saved — ${r.changed.length} setting(s) changed` : 'No changes');
      await mutate();
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    draft, setDraft, dirty, saving, save,
    defaults: data?.defaults[key] ?? null,
    discard: () => server && draft && setDraft({ ...draft, ...(structuredClone(pick(server)) as object) } as PlatformSettings[K]),
    resetToDefaults: () => data && draft && setDraft({ ...draft, ...(structuredClone(pick(data.defaults[key])) as object) } as PlatformSettings[K]),
  };
}

export function SectionCard({ title, description, dirty, saving, onSave, onDiscard, onDefaults, children }: {
  title: string; description?: string; dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void; onDefaults?: () => void; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={onDefaults && <Button variant="ghost" size="sm" onClick={onDefaults}><RotateCcw className="h-4 w-4" /> Defaults</Button>}
      />
      <div className="px-5 pb-5">{children}</div>
      {dirty && (
        <div className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-amber-200 bg-amber-50 px-5 py-3">
          <span className="text-sm text-amber-800">Unsaved changes</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={onDiscard}>Discard</Button><Button size="sm" loading={saving} onClick={onSave}><Save className="h-4 w-4" /> Save</Button></div>
        </div>
      )}
    </Card>
  );
}
