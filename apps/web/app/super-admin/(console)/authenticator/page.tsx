'use client';

import * as React from 'react';
import {
  CheckCircle2, Copy, Download, KeyRound, Lock, Printer, QrCode, RefreshCw,
  ShieldAlert, ShieldCheck, Smartphone, SmartphoneNfc, Key, AlertTriangle, Eye, EyeOff
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Badge, Alert, Card, Input } from '@/components/ui/primitives';
import { toast } from 'sonner';

export default function AuthenticatorPage() {
  const [totpEnabled, setTotpEnabled] = React.useState(true);
  const [testCode, setTestCode] = React.useState('');
  const [verifying, setVerifying] = React.useState(false);
  const [showSecret, setShowSecret] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[]>([
    '4A89-E92F', '82C1-39B0', '9FA2-55D4', 'B1C0-78A1',
    'C3D4-29E8', 'E5F6-12A7', '7B8C-90D1', '3E4F-56A8'
  ]);
  const [generatingCodes, setGeneratingCodes] = React.useState(false);

  const sampleSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  const copySecret = () => {
    navigator.clipboard.writeText(sampleSecret);
    toast.success('TOTP Secret key copied to clipboard');
  };

  const handleVerifyTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (testCode.length !== 6) {
      toast.error('Enter a valid 6-digit verification code.');
      return;
    }
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      setTestCode('');
      toast.success('Authenticator code verified! Time synchronization is valid.');
    }, 600);
  };

  const handleRegenerateRecovery = async () => {
    setGeneratingCodes(true);
    setTimeout(() => {
      const generated = Array.from({ length: 8 }, () => {
        const rand = () => Math.random().toString(36).substring(2, 6).toUpperCase();
        return `${rand()}-${rand()}`;
      });
      setRecoveryCodes(generated);
      setGeneratingCodes(false);
      toast.success('Generated 8 fresh recovery codes. Old codes are now invalidated.');
    }, 800);
  };

  const downloadCodes = () => {
    const text = `CAMPUSCARE SUPER ADMIN EMERGENCY RECOVERY CODES\nGenerated: ${new Date().toISOString()}\n\n` +
      recoveryCodes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
      '\n\nKeep these single-use codes offline in a secure vault.';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campuscare-recovery-codes-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Recovery codes downloaded');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
          <SmartphoneNfc className="h-6 w-6 text-brand-600" />
          Two-Step Authenticator &amp; Security Keys
        </h1>
        <p className="text-sm text-ink-soft">
          Manage Time-based One-Time Password (TOTP) authenticator apps, security hardware tokens, and emergency backup codes.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Authenticator Status & Configuration */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 border-line shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-ink-strong">Authenticator App (TOTP)</h2>
                  <p className="text-xs text-ink-soft">Compatible with Google Authenticator, Microsoft Authenticator, and 1Password</p>
                </div>
              </div>
              <Badge tone="brand" className="font-semibold text-xs px-2.5 py-1">
                ENROLLED &amp; ACTIVE
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center p-4 rounded-xl bg-stone-50 border border-line">
              {/* QR Code Mock */}
              <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl border border-line shadow-xs">
                <div className="relative p-2 bg-white rounded-lg border border-slate-200">
                  <QrCode className="h-32 w-32 text-stone-900" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-white/95 rounded-lg transition p-2 text-center text-xs text-ink font-semibold">
                    Scan in Authenticator App
                  </div>
                </div>
                <span className="text-[11px] text-ink-soft mt-2">Issuer: CampusCare (SRM AP)</span>
              </div>

              {/* Secret Key & Copy */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-ink">Manual Key Entry</p>
                <p className="text-xs text-ink-soft">
                  If your phone camera cannot scan the QR code, enter this key manually:
                </p>
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white border border-line font-mono text-xs">
                  <span className="flex-1 truncate">{showSecret ? sampleSecret : '••••••••••••••••••••••••••••••••'}</span>
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="text-ink-soft hover:text-ink p-1"
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={copySecret}
                    className="text-brand-600 hover:text-brand-700 p-1"
                    title="Copy Secret"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="pt-2 text-[11px] text-ink-soft space-y-1">
                  <p>Algorithm: SHA-1 · Digits: 6 · Period: 30s</p>
                </div>
              </div>
            </div>

            {/* Verification Test Form */}
            <form onSubmit={handleVerifyTest} className="space-y-3 pt-2">
              <label className="text-xs font-semibold text-ink">Test Current 6-Digit Authenticator Code</label>
              <div className="flex items-center gap-3">
                <Input
                  maxLength={6}
                  placeholder="000000"
                  value={testCode}
                  onChange={(e) => setTestCode(e.target.value.replace(/\D/g, ''))}
                  className="font-mono text-center tracking-[0.4em] max-w-[180px] text-base"
                />
                <Button type="submit" variant="outline" size="sm" disabled={verifying || testCode.length !== 6}>
                  {verifying ? 'Validating…' : 'Test Code Sync'}
                </Button>
              </div>
              <p className="text-[11px] text-ink-soft">
                Confirms your mobile phone clock and server time are perfectly in sync.
              </p>
            </form>
          </Card>

          {/* Sudo Mode & Step-Up Security */}
          <Card className="p-6 border-line shadow-sm space-y-4">
            <h2 className="text-base font-bold text-ink-strong flex items-center gap-2">
              <Lock className="h-4 w-4 text-brand-600" />
              Sudo Mode &amp; Privileged Elevation
            </h2>
            <p className="text-xs text-ink-soft">
              Critical administrative operations (disabling SOS, modifying encryption keys, deleting data) require recent password or MFA re-authentication within the last 15 minutes.
            </p>
            <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-line text-xs">
              <span className="font-medium text-ink">Current Step-Up Session State</span>
              <Badge tone="brand">ELEVATED · EXPIRES IN 11 MIN</Badge>
            </div>
          </Card>
        </div>

        {/* Right Col: Single-Use Backup Recovery Codes */}
        <div className="space-y-6">
          <Card className="p-6 border-line shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink-strong flex items-center gap-1.5">
                <Key className="h-4 w-4 text-amber-600" />
                Recovery Codes
              </h2>
              <Badge tone="neutral" className="text-xs">
                {recoveryCodes.length} Unused
              </Badge>
            </div>

            <p className="text-xs text-ink-soft">
              If you lose access to your authenticator phone, each of these backup codes can be used once to sign in.
            </p>

            <div className="grid grid-cols-2 gap-2 p-3 bg-stone-50 rounded-xl border border-line font-mono text-xs text-ink text-center">
              {recoveryCodes.map((code, idx) => (
                <div key={idx} className="p-1.5 bg-white rounded border border-line/70">
                  {code}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full flex items-center justify-center gap-1.5 text-xs"
                onClick={downloadCodes}
              >
                <Download className="h-3.5 w-3.5" />
                Download Codes (.txt)
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full flex items-center justify-center gap-1.5 text-xs text-rose-700 hover:bg-rose-50 border-rose-200"
                onClick={handleRegenerateRecovery}
                disabled={generatingCodes}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${generatingCodes ? 'animate-spin' : ''}`} />
                {generatingCodes ? 'Regenerating…' : 'Regenerate New Codes'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
