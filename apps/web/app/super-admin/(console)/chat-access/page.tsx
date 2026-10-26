'use client';

import * as React from 'react';
import {
  AlertTriangle, CheckCircle2, FileText, Lock, MessageSquare, MessageSquareLock,
  MessagesSquare, Plus, RefreshCw, Save, Shield, ShieldAlert, Sliders, Trash2, Users
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Badge, Alert, Card, Input } from '@/components/ui/primitives';
import { toast } from 'sonner';

interface ChatPolicySettings {
  communityEnabled: boolean;
  media: {
    support: { images: boolean; videos: boolean };
    community: { images: boolean; videos: boolean };
    case: { images: boolean; videos: boolean };
    counselling: { images: boolean; videos: boolean };
  };
  maxImageMb: number;
  maxVideoMb: number;
  blockedKeywords: string[];
}

export default function ChatAccessPage() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [newKeyword, setNewKeyword] = React.useState('');

  const [policy, setPolicy] = React.useState<ChatPolicySettings>({
    communityEnabled: true,
    media: {
      support: { images: false, videos: false },
      community: { images: false, videos: false },
      case: { images: true, videos: false },
      counselling: { images: false, videos: false },
    },
    maxImageMb: 10,
    maxVideoMb: 50,
    blockedKeywords: ['ragging', 'harassment', 'drugs', 'abuse', 'strike'],
  });

  const fetchPolicy = async () => {
    try {
      const res = await api.get<{ settings: any }>('/super-admin/settings');
      if (res?.settings) {
        setPolicy((prev) => ({
          ...prev,
          communityEnabled: res.settings.chat?.communityEnabled ?? true,
          media: res.settings.chat?.media ?? prev.media,
          maxImageMb: res.settings.chat?.maxImageMb ?? 10,
          maxVideoMb: res.settings.chat?.maxVideoMb ?? 50,
        }));
      }
    } catch {
      // Use defaults if settings endpoint handles it
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchPolicy();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch('/super-admin/settings', {
        settings: {
          chat: {
            communityEnabled: policy.communityEnabled,
            media: policy.media,
            maxImageMb: policy.maxImageMb,
            maxVideoMb: policy.maxVideoMb,
          },
        },
      });
      toast.success('Chat access and security policies saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update chat policies');
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    const kw = newKeyword.trim().toLowerCase();
    if (!policy.blockedKeywords.includes(kw)) {
      setPolicy((p) => ({ ...p, blockedKeywords: [...p.blockedKeywords, kw] }));
      setNewKeyword('');
      toast.success(`Added "${kw}" to filter dictionary`);
    }
  };

  const removeKeyword = (kw: string) => {
    setPolicy((p) => ({ ...p, blockedKeywords: p.blockedKeywords.filter((k) => k !== kw) }));
  };

  const toggleMedia = (type: 'support' | 'community' | 'case' | 'counselling', kind: 'images' | 'videos') => {
    setPolicy((prev) => ({
      ...prev,
      media: {
        ...prev.media,
        [type]: {
          ...prev.media[type],
          [kind]: !prev.media[type][kind],
        },
      },
    }));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
            <MessageSquareLock className="h-6 w-6 text-brand-600" />
            Chat Access &amp; Communications Governance
          </h1>
          <p className="text-sm text-ink-soft">
            Manage channel privileges, file attachment permissions, automated toxicity filters, and emergency locks.
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-brand-600 hover:bg-brand-700 text-white flex items-center gap-2 shadow-sm"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Policies'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Media & Access Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* Emergency Chat Lock Switch */}
          <Card className="p-5 border-line shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-ink-strong flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-rose-600" />
                  Campus Community Chat Master Switch
                </h3>
                <p className="text-xs text-ink-soft">
                  Disabling freezes student community channels immediately across all installed mobile apps.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={policy.communityEnabled}
                  onChange={(e) => setPolicy({ ...policy, communityEnabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          </Card>

          {/* Media Attachments Policy Matrix */}
          <Card className="p-6 border-line shadow-sm space-y-5">
            <div>
              <h2 className="text-base font-bold text-ink-strong flex items-center gap-2">
                <Sliders className="h-5 w-5 text-brand-600" />
                Media Attachment Permissions Matrix
              </h2>
              <p className="text-xs text-ink-soft">
                By default, file uploads are restricted to prevent unauthorized media sharing. Enable per chat type as needed.
              </p>
            </div>

            <div className="divide-y divide-line rounded-xl border border-line bg-stone-50/50 overflow-hidden text-xs">
              {/* Header */}
              <div className="grid grid-cols-3 p-3 font-semibold text-ink-soft bg-stone-100">
                <span>Chat Category</span>
                <span className="text-center">Image Uploads</span>
                <span className="text-center">Video Uploads</span>
              </div>

              {/* Support */}
              <div className="grid grid-cols-3 p-3 items-center">
                <div>
                  <p className="font-semibold text-ink">Private Support Service</p>
                  <p className="text-[11px] text-ink-soft">Student with university helpdesk</p>
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.support.images}
                    onChange={() => toggleMedia('support', 'images')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.support.videos}
                    onChange={() => toggleMedia('support', 'videos')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Community */}
              <div className="grid grid-cols-3 p-3 items-center bg-white">
                <div>
                  <p className="font-semibold text-ink">Public Community Channels</p>
                  <p className="text-[11px] text-ink-soft">Campus-wide open groups</p>
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.community.images}
                    onChange={() => toggleMedia('community', 'images')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.community.videos}
                    onChange={() => toggleMedia('community', 'videos')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Case Chat */}
              <div className="grid grid-cols-3 p-3 items-center">
                <div>
                  <p className="font-semibold text-ink">Incident Case Workspace</p>
                  <p className="text-[11px] text-ink-soft">Evidence and committee inquiry</p>
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.case.images}
                    onChange={() => toggleMedia('case', 'images')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.case.videos}
                    onChange={() => toggleMedia('case', 'videos')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
              </div>

              {/* Counselling */}
              <div className="grid grid-cols-3 p-3 items-center bg-white">
                <div>
                  <p className="font-semibold text-ink">Counselling Session Chat</p>
                  <p className="text-[11px] text-ink-soft">Strictly confidential mental health</p>
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.counselling.images}
                    onChange={() => toggleMedia('counselling', 'images')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
                <div className="text-center">
                  <input
                    type="checkbox"
                    checked={policy.media.counselling.videos}
                    onChange={() => toggleMedia('counselling', 'videos')}
                    className="h-4 w-4 rounded accent-brand-600 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Max Sizes */}
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Max Image Size (MB)</label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={policy.maxImageMb}
                  onChange={(e) => setPolicy({ ...policy, maxImageMb: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Max Video Size (MB)</label>
                <Input
                  type="number"
                  min={1}
                  max={200}
                  value={policy.maxVideoMb}
                  onChange={(e) => setPolicy({ ...policy, maxVideoMb: Number(e.target.value) })}
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Right Col: Automated Toxic Word Filter */}
        <div className="space-y-6">
          <Card className="p-6 border-line shadow-sm space-y-4">
            <h2 className="text-base font-bold text-ink-strong flex items-center gap-2">
              <Shield className="h-5 w-5 text-brand-600" />
              Automated Keyword Filter
            </h2>
            <p className="text-xs text-ink-soft">
              Messages containing these keywords are automatically flagged for moderator review before delivery.
            </p>

            {/* Add Keyword Form */}
            <form onSubmit={addKeyword} className="flex gap-2">
              <Input
                placeholder="Add keyword..."
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                className="text-xs"
              />
              <Button type="submit" size="sm" variant="outline" className="shrink-0 text-xs">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </form>

            {/* Keywords List */}
            <div className="flex flex-wrap gap-1.5 pt-2 max-h-60 overflow-y-auto">
              {policy.blockedKeywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-stone-100 text-ink text-xs font-medium border border-line"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    className="text-ink-soft hover:text-rose-600 transition"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <p className="text-[11px] text-ink-soft border-t border-line pt-3">
              Matched messages are logged with an SHA-256 HMAC digest in the tamper-evident audit record.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
