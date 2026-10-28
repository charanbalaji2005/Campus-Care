import { ACCOUNT_EMAIL_DOMAIN, DEFAULT_SETTINGS, DISPATCH_POLICIES, DUTY_LIMITS, RESPONDER_SKILLS, deepMerge, type PlatformSettings, type PublicSettings } from '@campuscare/shared';
import { SystemSetting, IdentityProviderConfig } from '../models/platform';
import { turnstileKeys, env } from '../config/env';

const KEY = 'platform';
let cache: { value: PlatformSettings; at: number } | null = null;
const TTL_MS = 15_000;

export async function getSettings(): Promise<PlatformSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const doc = await SystemSetting.findOne({ key: KEY }).lean();
  const value = deepMerge(DEFAULT_SETTINGS, doc?.value ?? {});
  cache = { value, at: Date.now() };
  return value;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function updateSettings(patch: unknown, actorId: string): Promise<{ before: PlatformSettings; after: PlatformSettings }> {
  const before = await getSettings();
  const after = deepMerge(before, patch);
  validateSettings(after);
  await SystemSetting.findOneAndUpdate(
    { key: KEY },
    { $set: { value: after, updatedBy: actorId }, $inc: { version: 1 } },
    { upsert: true, new: true },
  );
  invalidateSettingsCache();
  return { before, after };
}

/** Guard rails so a mistaken edit cannot produce an unsafe configuration. */
export function validateSettings(s: PlatformSettings) {
  const errors: string[] = [];
  // Every value must keep the type of its default (no strings where numbers/booleans belong).
  const typeCheck = (value: unknown, def: unknown, path: string) => {
    if (Array.isArray(def)) {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) errors.push(`${path} must be a list`);
      return;
    }
    if (def && typeof def === 'object') {
      if (!value || typeof value !== 'object') { errors.push(`${path} is invalid`); return; }
      for (const k of Object.keys(def)) typeCheck((value as Record<string, unknown>)[k], (def as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return;
    }
    if (typeof value !== typeof def || (typeof def === 'number' && !Number.isFinite(value as number))) errors.push(`${path} has the wrong type`);
  };
  typeCheck(s, DEFAULT_SETTINGS, '');
  if (s.sos.countdownSeconds < 3 || s.sos.countdownSeconds > 30) errors.push('SOS countdown must be between 3 and 30 seconds');
  if (!s.sos.quickTriggerMessage.trim() || s.sos.quickTriggerMessage.length > 160) errors.push('SOS countdown message must be 1–160 characters');
  if (s.security.passwordMinLength < 8 || s.security.passwordMinLength > 64) errors.push('Password minimum length must be 8–64');
  if (s.security.sessionIdleMinutes < 5 || s.security.sessionIdleMinutes > 24 * 60) errors.push('Idle timeout must be 5–1440 minutes');
  if (s.security.sessionAbsoluteHours < 1 || s.security.sessionAbsoluteHours > 24 * 14) errors.push('Absolute session lifetime must be 1–336 hours');
  if (s.security.reauthWindowMinutes < 1 || s.security.reauthWindowMinutes > 60) errors.push('Re-authentication window must be 1–60 minutes');
  if (s.chat.maxImageMb < 1 || s.chat.maxImageMb > 25) errors.push('Image limit must be 1–25 MB');
  if (s.chat.maxVideoMb < 1 || s.chat.maxVideoMb > 200) errors.push('Video limit must be 1–200 MB');
  if (s.incidents.evidenceMaxMb < 1 || s.incidents.evidenceMaxMb > 50) errors.push('Evidence limit must be 1–50 MB');
  if (s.locationSharing.maxDurationMinutes < 5 || s.locationSharing.maxDurationMinutes > 480) errors.push('Location sharing limit must be 5–480 minutes');
  if (!['info', 'warning', 'critical'].includes(s.mobile.bannerSeverity)) errors.push('Banner severity must be info, warning or critical');
  if (s.mobile.minSupportedVersionCode < 1 || s.mobile.minSupportedVersionCode > s.mobile.latestVersionCode) errors.push('Minimum supported app version must be between 1 and the latest version');
  if (s.mobile.downloadUrl && !/^https:\/\//.test(s.mobile.downloadUrl)) errors.push('App download URL must start with https://');
  if (s.sos.escalateAfterSeconds < 30 || s.sos.escalateAfterSeconds > 1800) errors.push('SOS escalation must be 30–1800 seconds');
  if (s.sos.secondEscalationAfterSeconds <= s.sos.escalateAfterSeconds) errors.push('Second escalation must come after the first');
  if (Math.abs(s.map.centerLatitude) > 90 || Math.abs(s.map.centerLongitude) > 180) errors.push('Map centre is not a valid coordinate');
  if (s.map.heatmapMinCount < 3) errors.push('Heatmap minimum group size must be at least 3');
  const within = (v: number, k: keyof typeof DUTY_LIMITS) => v >= DUTY_LIMITS[k].min && v <= DUTY_LIMITS[k].max && Number.isInteger(v);
  if (!within(s.duty.heartbeatIntervalSeconds, 'heartbeatIntervalSeconds')) errors.push(`Heartbeat interval must be ${DUTY_LIMITS.heartbeatIntervalSeconds.min}–${DUTY_LIMITS.heartbeatIntervalSeconds.max} seconds`);
  if (!within(s.duty.staleThresholdSeconds, 'staleThresholdSeconds')) errors.push(`Stale threshold must be ${DUTY_LIMITS.staleThresholdSeconds.min}–${DUTY_LIMITS.staleThresholdSeconds.max} seconds`);
  // At least two missed heartbeats before anyone is marked stale, so one dropped request never does it.
  if (s.duty.staleThresholdSeconds < s.duty.heartbeatIntervalSeconds * 2) errors.push('Stale threshold must be at least twice the heartbeat interval');
  if (s.duty.shiftStartGraceMinutes < 0 || s.duty.shiftStartGraceMinutes > 120) errors.push('Shift start grace must be 0–120 minutes');
  if (!within(s.dispatch.ackDeadlineSeconds, 'ackDeadlineSeconds')) errors.push(`Acknowledgement deadline must be ${DUTY_LIMITS.ackDeadlineSeconds.min}–${DUTY_LIMITS.ackDeadlineSeconds.max} seconds`);
  if (!within(s.dispatch.maxAttempts, 'maxAttempts')) errors.push('Assignment attempts must be 1–10');
  if (!within(s.dispatch.groupSize, 'groupSize')) errors.push('Dispatch group size must be 1–5');
  if (!within(s.dispatch.maxActiveAssignmentsPerResponder, 'maxActiveAssignmentsPerResponder')) errors.push('Assignments per responder must be 1–5');
  if (!(DISPATCH_POLICIES as readonly string[]).includes(s.dispatch.policy)) errors.push('Dispatch policy must be single or group');
  if (s.dispatch.trustedLocationAccuracyMeters < 5 || s.dispatch.trustedLocationAccuracyMeters > 1000) errors.push('Trusted location accuracy must be 5–1000 m');
  if (s.dispatch.proximityBandMeters < 50 || s.dispatch.proximityBandMeters > 2000) errors.push('Proximity band must be 50–2000 m');
  if (s.dispatch.unassignedRetrySeconds < 10 || s.dispatch.unassignedRetrySeconds > 600) errors.push('Unassigned retry must be 10–600 seconds');
  for (const skill of [...s.dispatch.requiredSkills, ...s.dispatch.preferredSkills]) {
    if (!(RESPONDER_SKILLS as readonly string[]).includes(skill)) errors.push(`Unknown responder skill: ${skill}`);
  }
  if (!within(s.chatGovernance.maxReviewMinutes, 'maxReviewMinutes')) errors.push('Private review duration must be 5–240 minutes');
  for (const scope of Object.values(s.chat.media)) {
    if (typeof scope.images !== 'boolean' || typeof scope.videos !== 'boolean') errors.push('Media switches must be on/off values');
  }
  if (errors.length) {
    const err = new Error(errors.join('; '));
    (err as Error & { status?: number }).status = 422;
    throw err;
  }
}

export async function publicSettings(): Promise<PublicSettings> {
  const s = await getSettings();
  const google = await IdentityProviderConfig.findOne({ provider: 'google' }).lean();
  const googleConfigured = google ? Boolean(google.enabled && (google.clientId || env.GOOGLE_CLIENT_ID)) : Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  return {
    platformName: s.platform.name,
    universityName: s.platform.universityName,
    registrationOpen: s.registration.studentRegistrationOpen,
    turnstile: { enabled: s.turnstile.enabled && Boolean(turnstileKeys.siteKey), siteKey: turnstileKeys.siteKey ?? null, forms: s.turnstile.forms },
    googleSignInEnabled: googleConfigured,
    anonymousReportingEnabled: s.incidents.anonymousReportingEnabled,
    anonymousCategories: s.incidents.anonymousCategories,
    chatMedia: s.chat.media,
    maxImageMb: s.chat.maxImageMb,
    maxVideoMb: s.chat.maxVideoMb,
    communityEnabled: s.chat.communityEnabled,
    sos: {
      enabled: s.sos.enabled, countdownSeconds: s.sos.countdownSeconds, allowCancelAfterSend: s.sos.allowCancelAfterSend,
      quickTriggerEnabled: s.sos.quickTriggerEnabled, quickTriggerMessage: s.sos.quickTriggerMessage,
    },
    safeWalkEnabled: s.safeWalk.enabled,
    locationSharingEnabled: s.locationSharing.enabled,
    maxLocationShareMinutes: s.locationSharing.maxDurationMinutes,
    evidenceMaxMb: s.incidents.evidenceMaxMb,
    evidenceMaxFiles: s.incidents.evidenceMaxFiles,
    passwordMinLength: s.security.passwordMinLength,
    map: s.map,
    community: s.community,
    mobile: s.mobile,
    maintenanceMode: s.platform.maintenanceMode,
    supportEmail: s.platform.supportEmail,
    accountEmailDomain: ACCOUNT_EMAIL_DOMAIN,
  };
}
