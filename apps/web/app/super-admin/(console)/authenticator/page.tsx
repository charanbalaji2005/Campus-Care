'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2, Copy, Download, KeyRound, Lock, QrCode, RefreshCw,
  ShieldAlert, ShieldCheck, Smartphone, SmartphoneNfc, Key, AlertTriangle, Eye, EyeOff, Check
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button, Badge, Alert, Card, Input, Field } from '@/components/ui/primitives';
import { toast } from 'sonner';

interface MfaStatus {
  enabled: boolean;
  pendingEnrollment: boolean;
  activatedAt: string | null;
  rotatedAt: string | null;
  lastUsedAt: string | null;
  recoveryCodesRemaining: number;
  recoveryCodesTotal: number;
  recoveryCodesIssuedAt: string | null;
  lockedUntil: string | null;
  required: boolean;
}

interface TotpSetupData {
  qrDataUrl: string;
  manualKey: string;
  secret: string;
  otpauthUrl: string;
  issuer: string;
  accountName: string;
  rotating: boolean;
}

export default function AuthenticatorPage() {
  const searchParams = useSearchParams();
  const setupRequired = searchParams.get('setup') === 'required';

  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<MfaStatus | null>(null);
  const [sessionInfo, setSessionInfo] = React.useState<{ reauthAt?: string | null; mfaVerified?: boolean }>({});
  
  // Setup state
  const [setupData, setSetupData] = React.useState<TotpSetupData | null>(null);
  const [setupCode, setSetupCode] = React.useState('');
  const [setupBusy, setSetupBusy] = React.useState(false);
  const [showSecret, setShowSecret] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState(false);

  // Verification test state
  const [testCode, setTestCode] = React.useState('');
  const [verifying, setVerifying] = React.useState(false);
  const [testSuccess, setTestSuccess] = React.useState<boolean | null>(null);

  // Recovery codes state
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [generatingCodes, setGeneratingCodes] = React.useState(false);
  const [copiedCodes, setCopiedCodes] = React.useState(false);

  const fetchStatus = React.useCallback(async () => {
    try {
      const [s, me] = await Promise.all([
        api.get<MfaStatus>('/auth/mfa/status'),
        api.get<{ session?: { reauthAt?: string | null; mfaVerified?: boolean } }>('/auth/me').catch(() => ({ session: {} })),
      ]);
      setStatus(s);
      setSessionInfo(me.session ?? {});
      return s;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load two-step verification status.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchStatus().then((s) => {
      if (s && (!s.enabled || setupRequired)) {
        startSetup();
      }
    });
  }, [fetchStatus, setupRequired]);

  async function startSetup() {
    setSetupBusy(true);
    try {
      const data = await api.post<TotpSetupData>('/auth/mfa/totp/setup');
      setSetupData(data);
      setSetupCode('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not generate authenticator setup.');
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    if (setupCode.length !== 6) {
      toast.error('Please enter the 6-digit code shown in your authenticator app.');
      return;
    }
    setSetupBusy(true);
    try {
      const res = await api.post<{ ok: boolean; rotated: boolean; recoveryCodes: string[] | null }>('/auth/mfa/totp/verify', { code: setupCode });
      toast.success(res.rotated ? 'Authenticator rotated successfully.' : 'Two-step verification activated successfully!');
      if (res.recoveryCodes && res.recoveryCodes.length > 0) {
        setRecoveryCodes(res.recoveryCodes);
      }
      setSetupData(null);
      setSetupCode('');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Invalid verification code. Check your app and try again.');
    } finally {
      setSetupBusy(false);
    }
  }

  async function handleVerifyTest(e: React.FormEvent) {
    e.preventDefault();
    if (testCode.length !== 6) {
      toast.error('Enter a valid 6-digit verification code.');
      return;
    }
    setVerifying(true);
    setTestSuccess(null);
    try {
      await api.post('/auth/mfa/verify', { code: testCode });
      setTestSuccess(true);
      toast.success('Authenticator code verified! Time synchronization is valid.');
      setTestCode('');
      await fetchStatus();
    } catch (err) {
      setTestSuccess(false);
      toast.error(err instanceof ApiError ? err.message : 'That verification code is not valid.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleRegenerateRecovery() {
    if (!window.confirm('Regenerating will permanently invalidate all previous backup recovery codes. Do you want to continue?')) {
      return;
    }
    setGeneratingCodes(true);
    try {
      const res = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes/regenerate');
      setRecoveryCodes(res.recoveryCodes);
      toast.success('8 fresh single-use backup recovery codes generated.');
      await fetchStatus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to regenerate recovery codes.');
    } finally {
      setGeneratingCodes(false);
    }
  }

  const copySecret = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopiedKey(true);
    toast.success('Secret key copied to clipboard.');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const copyRecoveryCodes = () => {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join('\n'));
    setCopiedCodes(true);
    toast.success('Recovery codes copied to clipboard.');
    setTimeout(() => setCopiedCodes(false), 2000);
  };

  const downloadCodes = () => {
    if (!recoveryCodes) return;
    const text = 'CAMPUSCARE SUPER ADMIN EMERGENCY RECOVERY CODES\n' +
      `Generated: ${new Date().toISOString()}\n\n` +
      recoveryCodes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
      '\n\nKeep these single-use codes offline in a secure password manager or physical vault.';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `campuscare-recovery-codes-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Recovery codes downloaded.');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="flex items-center gap-3 text-ink-soft">
          <RefreshCw className="h-5 w-5 animate-spin text-brand-600" />
          <span>Loading two-step authenticator details...</span>
        </div>
      </div>
    );
  }

  const isEnrolled = Boolean(status?.enabled);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-strong flex items-center gap-2">
          <SmartphoneNfc className="h-6 w-6 text-brand-600" />
          Two-Step Authenticator &amp; Security Keys
        </h1>
        <p className="text-sm text-ink-soft">
          Manage Time-based One-Time Password (TOTP) authenticator apps, security hardware tokens, and emergency backup codes.
        </p>
      </div>

      {setupRequired && !isEnrolled && (
        <Alert tone="amber" title="Two-Step Verification Required">
          Super Admin privileges require two-step verification. Scan the QR code below using Google Authenticator, Microsoft Authenticator, or 1Password to activate your account.
        </Alert>
      )}

      {recoveryCodes && (
        <Alert tone="brand" title="Save Your Emergency Recovery Codes Now">
          <p className="text-sm mb-3">
            Store these single-use codes safely. If you lose your phone, each code can be used once to sign in. These will not be displayed again.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 font-mono text-xs text-ink">
            {recoveryCodes.map((c, idx) => (
              <div key={idx} className="p-2 bg-white rounded border border-brand-200 text-center font-bold">
                {c}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={downloadCodes}>
              <Download className="h-4 w-4 mr-1" /> Download (.txt)
            </Button>
            <Button size="sm" variant="outline" onClick={copyRecoveryCodes}>
              {copiedCodes ? <Check className="h-4 w-4 mr-1 text-emerald-600" /> : <Copy className="h-4 w-4 mr-1" />}
              {copiedCodes ? 'Copied' : 'Copy All'}
            </Button>
          </div>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Authenticator Status & Configuration */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6 border-line shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-line pb-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${isEnrolled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                  {isEnrolled ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                </div>
                <div>
                  <h2 className="text-base font-bold text-ink-strong">Authenticator App (TOTP)</h2>
                  <p className="text-xs text-ink-soft">Compatible with Google Authenticator, Microsoft Authenticator, and 1Password</p>
                </div>
              </div>
              <Badge tone={isEnrolled ? 'brand' : 'amber'} className="font-semibold text-xs px-2.5 py-1">
                {isEnrolled ? 'ENROLLED & ACTIVE' : 'SETUP REQUIRED'}
              </Badge>
            </div>

            {/* Setup / Re-enrollment Section */}
            {(!isEnrolled || setupData) && (
              <div className="p-4 rounded-xl bg-stone-50 border border-line space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                    {isEnrolled ? 'Replace / Rotate Authenticator App' : 'Enroll Authenticator'}
                  </span>
                  {setupData && isEnrolled && (
                    <Button variant="ghost" size="sm" onClick={() => setSetupData(null)} className="text-xs h-7">
                      Cancel
                    </Button>
                  )}
                </div>

                {setupData ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                    {/* Live QR Code from Backend */}
                    <div className="flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-line shadow-xs">
                      <img
                        src={setupData.qrDataUrl}
                        alt="Two-Factor QR Code"
                        className="h-44 w-44 rounded-lg border border-slate-200 object-contain"
                      />
                      <span className="text-[11px] text-ink-soft mt-2">Issuer: {setupData.issuer}</span>
                    </div>

                    {/* Secret Key & Confirmation */}
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-ink">1. Scan QR Code or Enter Key</p>
                        <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-line font-mono text-xs">
                          <span className="flex-1 truncate">{showSecret ? setupData.secret : '••••••••••••••••••••'}</span>
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
                            {copiedKey ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>

                      <form onSubmit={confirmSetup} className="space-y-2">
                        <label className="text-xs font-semibold text-ink">2. Enter 6-Digit Code from App</label>
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="000000"
                            value={setupCode}
                            onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
                            className="font-mono text-center tracking-[0.4em] max-w-[150px] text-base"
                            autoFocus
                          />
                          <Button type="submit" size="sm" disabled={setupBusy || setupCode.length !== 6} loading={setupBusy}>
                            Verify &amp; Activate
                          </Button>
                        </div>
                      </form>
                    </div>
                  </div>
                ) : (
                  <Button onClick={startSetup} loading={setupBusy}>
                    <QrCode className="h-4 w-4 mr-1.5" /> Set Up Authenticator App
                  </Button>
                )}
              </div>
            )}

            {/* Active Details & Verification Test Form */}
            {isEnrolled && !setupData && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-stone-50 rounded-lg border border-line">
                    <span className="text-ink-muted block text-[11px]">Status</span>
                    <span className="font-semibold text-emerald-700 flex items-center gap-1.5 mt-0.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mandatory MFA Policy Met
                    </span>
                  </div>
                  <div className="p-3 bg-stone-50 rounded-lg border border-line">
                    <span className="text-ink-muted block text-[11px]">Activated On</span>
                    <span className="font-medium text-ink mt-0.5 block">
                      {status?.activatedAt ? new Date(status.activatedAt).toLocaleDateString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Active'}
                    </span>
                  </div>
                </div>

                <form onSubmit={handleVerifyTest} className="space-y-3 pt-2 border-t border-line">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-ink">Test Current 6-Digit Authenticator Code</label>
                    {testSuccess === true && (
                      <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Valid Sync
                      </span>
                    )}
                    {testSuccess === false && (
                      <span className="text-xs font-semibold text-rose-600 flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5" /> Invalid Code
                      </span>
                    )}
                  </div>
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
                    <Button type="button" variant="ghost" size="sm" onClick={startSetup} className="text-xs text-ink-soft hover:text-ink ml-auto">
                      Replace Device
                    </Button>
                  </div>
                  <p className="text-[11px] text-ink-soft">
                    Confirms your mobile phone clock and server time are perfectly in sync.
                  </p>
                </form>
              </div>
            )}
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
              <span className="font-medium text-ink">Current Sudo Session State</span>
              <Badge tone={sessionInfo.mfaVerified ? 'brand' : 'neutral'}>
                {sessionInfo.mfaVerified ? 'ELEVATED (SUDO ACTIVE)' : 'STANDARD'}
              </Badge>
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
              <Badge tone={status?.recoveryCodesRemaining ? 'neutral' : 'amber'} className="text-xs">
                {status?.recoveryCodesRemaining ?? 0} Remaining
              </Badge>
            </div>

            <p className="text-xs text-ink-soft">
              If you lose access to your authenticator phone, backup codes allow you to regain access. Each code can be used exactly once.
            </p>

            <div className="p-3 bg-stone-50 rounded-xl border border-line text-xs space-y-2">
              <div className="flex justify-between text-ink-soft">
                <span>Total Issued:</span>
                <span className="font-medium text-ink">{status?.recoveryCodesTotal || 8}</span>
              </div>
              <div className="flex justify-between text-ink-soft">
                <span>Available Unused:</span>
                <span className="font-semibold text-emerald-700">{status?.recoveryCodesRemaining ?? 0}</span>
              </div>
              {status?.recoveryCodesIssuedAt && (
                <div className="flex justify-between text-ink-soft">
                  <span>Last Generated:</span>
                  <span className="font-medium text-ink">
                    {new Date(status.recoveryCodesIssuedAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full flex items-center justify-center gap-1.5 text-xs text-rose-700 hover:bg-rose-50 border-rose-200"
                onClick={handleRegenerateRecovery}
                disabled={generatingCodes || !isEnrolled}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${generatingCodes ? 'animate-spin' : ''}`} />
                {generatingCodes ? 'Regenerating…' : 'Regenerate New Backup Codes'}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
