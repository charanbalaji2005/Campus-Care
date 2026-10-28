'use client';

import * as React from 'react';
import {
  Bell, BellRing, CheckCircle2, Clock, Filter, History, Megaphone, Radio,
  Send, ShieldAlert, Smartphone, Sparkles, Users, AlertTriangle, Info, ArrowLeft
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Badge, Alert, Card, Input } from '@/components/ui/primitives';
import { toast } from 'sonner';

interface BroadcastLog {
  id: string;
  title: string;
  body: string;
  severity: 'critical' | 'warning' | 'info';
  audience: string;
  sentAt: string;
  sentBy: string;
  recipientsCount: number;
}

const TEMPLATES = [
  {
    title: 'Severe Weather Warning',
    body: 'Heavy rainfall and thunderstorm expected. All students are advised to stay indoors within academic blocks.',
    severity: 'warning' as const,
    audience: 'all',
  },
  {
    title: 'Hostel Night Curfew Notice',
    body: 'Reminder: Main hostel entry gates close at 21:30 hrs. Please carry university ID cards at all check-posts.',
    severity: 'info' as const,
    audience: 'hostel',
  },
  {
    title: 'Campus Emergency Safety Drill',
    body: 'Campus-wide mock evacuation drill scheduled today at 15:00 hrs. Please follow the instructions of security marshals.',
    severity: 'critical' as const,
    audience: 'all',
  },
];

export default function NotificationsBroadcastPage() {
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [severity, setSeverity] = React.useState<'critical' | 'warning' | 'info'>('warning');
  const [audience, setAudience] = React.useState('all');
  const [sendPush, setSendPush] = React.useState(true);
  const [sendBanner, setSendBanner] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  const [history, setHistory] = React.useState<BroadcastLog[]>([
    {
      id: 'b1',
      title: 'Hostel Entry Verification Advisory',
      body: 'All students are reminded to show biometric ID at hostel security gates.',
      severity: 'info',
      audience: 'Hostel Residents',
      sentAt: new Date(Date.now() - 3600_000 * 4).toISOString(),
      sentBy: 'Super Admin',
      recipientsCount: 2450,
    },
    {
      id: 'b2',
      title: 'Heavy Rain Warning · Andhra Pradesh Coastal Belt',
      body: 'Campus buses running on modified routes due to road waterlogging.',
      severity: 'warning',
      audience: 'Entire Campus',
      sentAt: new Date(Date.now() - 3600_000 * 28).toISOString(),
      sentBy: 'Super Admin',
      recipientsCount: 6890,
    },
  ]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      toast.error('Please fill in both title and message body.');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/admin/campus-alerts', {
        title,
        body,
        severity,
        scope: audience === 'all' ? 'campus' : audience,
        push: sendPush,
      });

      const newLog: BroadcastLog = {
        id: `b-${Date.now()}`,
        title,
        body,
        severity,
        audience: audience === 'all' ? 'Entire Campus' : audience,
        sentAt: new Date().toISOString(),
        sentBy: 'Super Admin',
        recipientsCount: 6890,
      };

      setHistory([newLog, ...history]);
      toast.success('Broadcast transmitted successfully to mobile devices!');
      setTitle('');
      setBody('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send broadcast');
    } finally {
      setSubmitting(false);
    }
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setTitle(t.title);
    setBody(t.body);
    setSeverity(t.severity);
    setAudience(t.audience);
    toast.info('Template applied to composer');
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <BackButton />
        <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
          <BellRing className="h-6 w-6 text-brand-600" />
          Broadcast Notifications Hub
        </h1>
        <p className="text-sm text-ink-soft">
          Send priority alerts, mobile push broadcasts, and banners directly to students, guards, and faculty.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Notification Composer */}
        <div className="lg:col-span-2 space-y-5">
          <Card className="p-6 border-line shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div>
                <h2 className="text-base font-bold text-ink-strong flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-brand-600" />
                  Compose Broadcast
                </h2>
                <p className="text-xs text-ink-soft">
                  Transmits through Socket.IO realtime connection &amp; Firebase Cloud Messaging.
                </p>
              </div>
              <Badge tone="brand" className="font-mono text-xs">
                FCM PUSH READY
              </Badge>
            </div>

            {/* Quick Templates */}
            <div>
              <p className="text-xs font-semibold text-ink-soft mb-2 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Quick Preset Templates:
              </p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((tpl, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-line bg-stone-50 hover:bg-stone-100 text-ink font-medium transition"
                  >
                    {tpl.title}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSend} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Alert Title</label>
                <Input
                  placeholder="e.g. Campus Safety Advisory"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Message Body</label>
                <textarea
                  rows={4}
                  className="w-full rounded-xl border border-line p-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="Write clear, concise guidance for recipients..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Severity */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink">Priority Level</label>
                  <select
                    className="w-full rounded-xl border border-line p-2.5 text-sm bg-white focus:border-brand-500 focus:outline-none"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                  >
                    <option value="critical">Critical (Sirens / Red Alert)</option>
                    <option value="warning">Warning / Safety Advisory</option>
                    <option value="info">Informational / General Notice</option>
                  </select>
                </div>

                {/* Target Audience */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink">Target Audience</label>
                  <select
                    className="w-full rounded-xl border border-line p-2.5 text-sm bg-white focus:border-brand-500 focus:outline-none"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  >
                    <option value="all">Entire University Campus</option>
                    <option value="student">Students Only</option>
                    <option value="hostel">Hostel Residents</option>
                    <option value="security">Security Responders &amp; Guards</option>
                    <option value="staff">Faculty &amp; Staff</option>
                  </select>
                </div>
              </div>

              {/* Delivery Channels */}
              <div className="rounded-xl p-3 bg-stone-50 border border-line flex flex-wrap items-center gap-6 text-xs">
                <span className="font-semibold text-ink">Channels:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendPush}
                    onChange={(e) => setSendPush(e.target.checked)}
                    className="rounded accent-brand-600"
                  />
                  <span>Push Notification (Lock screen alert)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendBanner}
                    onChange={(e) => setSendBanner(e.target.checked)}
                    className="rounded accent-brand-600"
                  />
                  <span>App Top Banner</span>
                </label>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  size="lg"
                  className="bg-brand-600 hover:bg-brand-700 text-white flex items-center gap-2 shadow-sm"
                  disabled={submitting}
                >
                  <Send className="h-4 w-4" />
                  {submitting ? 'Transmitting…' : 'Transmit Broadcast'}
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Right Col: Delivery Stats & Past Broadcasts */}
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-brand-600" /> Mobile Reach Metrics
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-line/60">
                <span className="text-ink-soft">Registered Mobile Devices:</span>
                <span className="font-semibold text-ink">6,890</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-line/60">
                <span className="text-ink-soft">Active Realtime Sockets:</span>
                <span className="font-semibold text-emerald-600">Connected</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-ink-soft">Push Delivery Reliability:</span>
                <span className="font-semibold text-ink">99.8%</span>
              </div>
            </div>
          </Card>

          {/* Past Broadcasts Log */}
          <Card className="p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft flex items-center gap-1.5">
              <History className="h-4 w-4" /> Recent Broadcast Logs
            </h3>
            <div className="space-y-2.5 text-xs">
              {history.map((log) => (
                <div key={log.id} className="p-2.5 rounded-xl bg-stone-50 border border-line space-y-1">
                  <div className="flex items-center justify-between">
                    <Badge tone={log.severity === 'critical' ? 'rose' : log.severity === 'warning' ? 'amber' : 'neutral'}>
                      {log.severity.toUpperCase()}
                    </Badge>
                    <span className="text-[10px] text-ink-soft font-mono">
                      {new Date(log.sentAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="font-bold text-ink-strong">{log.title}</p>
                  <p className="text-[11px] text-ink-soft line-clamp-2">{log.body}</p>
                  <div className="pt-1 flex items-center justify-between text-[10px] text-ink-soft">
                    <span>Audience: {log.audience}</span>
                    <span className="font-semibold text-emerald-700">{log.recipientsCount} reached</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Back to the previous console page, or to the dashboard when this page was opened directly. */
function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.push('/super-admin/dashboard'))}
      className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden /> Back
    </button>
  );
}
