import type { DutyStatus } from '@campuscare/shared';

/**
 * Pure SOS dispatch rules: who is eligible for an alert and in what order they are tried.
 * No database access here, so every rule is unit-tested in isolation.
 *
 * Ranking is lexicographic, most important first:
 *   1. availability tier — on duty before busy (busy only when the policy allows it)
 *   2. preferred qualifications held (more first)
 *   3. current workload (fewer open assignments first)
 *   4. same response zone as the alert
 *   5. travel proximity, in distance bands — only when BOTH positions are trustworthy
 *   6. fairness — whoever was assigned least recently goes first
 *   7. responder id, so the order is deterministic
 * GPS never decides on its own: a nearby responder who is off duty, stale, out of zone,
 * unqualified or at capacity is filtered out before ranking starts.
 */

export interface DispatchCandidate {
  userId: string;
  name?: string;
  status: DutyStatus;
  lastHeartbeatAt: Date | null;
  campus: string;
  zoneId: string | null;
  skills: string[];
  responsibilities: string[];
  activeAssignmentCount: number;
  lastAssignedAt: Date | null;
  location: { latitude: number; longitude: number; accuracyMeters: number | null; at: Date } | null;
  accountActive: boolean;
  /** Holds the sos:respond permission. */
  canRespond: boolean;
}

export interface DispatchAlertContext {
  campus: string;
  zoneId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  /** Responders already tried for this alert (declined, expired, or currently offered). */
  excludedResponderIds: Set<string>;
}

export interface DispatchRules {
  staleThresholdSeconds: number;
  maxActiveAssignmentsPerResponder: number;
  allowBusyResponders: boolean;
  requiredSkills: string[];
  preferredSkills: string[];
  trustedLocationAccuracyMeters: number;
  proximityBandMeters: number;
}

export type IneligibleReason =
  | 'account_inactive'
  | 'no_permission'
  | 'not_assigned_sos_response'
  | 'not_on_duty'
  | 'busy'
  | 'stale_heartbeat'
  | 'different_campus'
  | 'missing_required_skill'
  | 'at_capacity'
  | 'already_tried';

export interface RankedCandidate {
  candidate: DispatchCandidate;
  tier: number;
  preferredMatches: number;
  sameZone: boolean;
  /** Null when either position is not trustworthy enough to compare. */
  distanceMeters: number | null;
  distanceBand: number | null;
  explanation: string;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isHeartbeatFresh(lastHeartbeatAt: Date | null, now: number, staleThresholdSeconds: number): boolean {
  return Boolean(lastHeartbeatAt) && now - lastHeartbeatAt!.getTime() <= staleThresholdSeconds * 1000;
}

/** A position is usable for proximity only if it is precise enough and not older than the stale threshold. */
export function isTrustworthyLocation(
  loc: { accuracyMeters: number | null; at?: Date } | null,
  rules: Pick<DispatchRules, 'trustedLocationAccuracyMeters' | 'staleThresholdSeconds'>,
  now: number,
): boolean {
  if (!loc || loc.accuracyMeters == null) return false; // unknown precision is never trusted
  if (loc.accuracyMeters > rules.trustedLocationAccuracyMeters) return false;
  if (loc.at && now - loc.at.getTime() > rules.staleThresholdSeconds * 1000) return false;
  return true;
}

export function checkEligibility(c: DispatchCandidate, alert: DispatchAlertContext, rules: DispatchRules, now: number): { eligible: true } | { eligible: false; reason: IneligibleReason } {
  if (!c.accountActive) return { eligible: false, reason: 'account_inactive' };
  if (!c.canRespond) return { eligible: false, reason: 'no_permission' };
  if (!c.responsibilities.includes('sos_response')) return { eligible: false, reason: 'not_assigned_sos_response' };
  if (alert.excludedResponderIds.has(c.userId)) return { eligible: false, reason: 'already_tried' };
  if (c.status === 'busy') {
    if (!rules.allowBusyResponders) return { eligible: false, reason: 'busy' };
  } else if (c.status !== 'on_duty') {
    return { eligible: false, reason: 'not_on_duty' };
  }
  if (!isHeartbeatFresh(c.lastHeartbeatAt, now, rules.staleThresholdSeconds)) return { eligible: false, reason: 'stale_heartbeat' };
  if (c.campus !== alert.campus) return { eligible: false, reason: 'different_campus' };
  if (rules.requiredSkills.some((s) => !c.skills.includes(s))) return { eligible: false, reason: 'missing_required_skill' };
  if (c.activeAssignmentCount >= rules.maxActiveAssignmentsPerResponder) return { eligible: false, reason: 'at_capacity' };
  return { eligible: true };
}

function bandLabel(band: number, size: number) {
  return `~${band * size}–${(band + 1) * size} m`;
}

function describe(r: Omit<RankedCandidate, 'explanation'>, rules: DispatchRules, now: number): string {
  const parts = [r.tier === 0 ? 'On duty' : 'Busy'];
  if (rules.preferredSkills.length) parts.push(`${r.preferredMatches}/${rules.preferredSkills.length} preferred skills`);
  parts.push(`${r.candidate.activeAssignmentCount} open assignment(s)`);
  if (r.sameZone) parts.push('same zone');
  parts.push(r.distanceBand != null ? bandLabel(r.distanceBand, rules.proximityBandMeters) : 'distance not compared');
  const last = r.candidate.lastAssignedAt;
  parts.push(last ? `last assigned ${Math.round((now - last.getTime()) / 60000)} min ago` : 'not assigned recently');
  return parts.join(' · ');
}

/** Eligible responders in the order dispatch should try them. Ineligible ones are returned separately with reasons. */
export function rankResponders(candidates: DispatchCandidate[], alert: DispatchAlertContext, rules: DispatchRules, now = Date.now()) {
  const alertTrusted = alert.latitude != null && alert.longitude != null && isTrustworthyLocation({ accuracyMeters: alert.accuracyMeters }, rules, now);
  const ranked: RankedCandidate[] = [];
  const ineligible: { candidate: DispatchCandidate; reason: IneligibleReason }[] = [];

  for (const c of candidates) {
    const check = checkEligibility(c, alert, rules, now);
    if (!check.eligible) {
      ineligible.push({ candidate: c, reason: check.reason });
      continue;
    }
    let distanceMeters: number | null = null;
    if (alertTrusted && c.location && isTrustworthyLocation(c.location, rules, now)) {
      distanceMeters = haversineMeters({ latitude: alert.latitude!, longitude: alert.longitude! }, c.location);
    }
    const base = {
      candidate: c,
      tier: c.status === 'on_duty' ? 0 : 1,
      preferredMatches: rules.preferredSkills.filter((s) => c.skills.includes(s)).length,
      sameZone: Boolean(alert.zoneId) && c.zoneId === alert.zoneId,
      distanceMeters,
      distanceBand: distanceMeters == null ? null : Math.floor(distanceMeters / Math.max(1, rules.proximityBandMeters)),
    };
    ranked.push({ ...base, explanation: describe(base, rules, now) });
  }

  ranked.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.preferredMatches !== b.preferredMatches) return b.preferredMatches - a.preferredMatches;
    if (a.candidate.activeAssignmentCount !== b.candidate.activeAssignmentCount) return a.candidate.activeAssignmentCount - b.candidate.activeAssignmentCount;
    if (a.sameZone !== b.sameZone) return a.sameZone ? -1 : 1;
    // A confirmed nearby position beats an unknown one; unknown positions are never assumed close.
    const ab = a.distanceBand ?? Number.POSITIVE_INFINITY;
    const bb = b.distanceBand ?? Number.POSITIVE_INFINITY;
    if (ab !== bb) return ab - bb;
    const al = a.candidate.lastAssignedAt?.getTime() ?? 0;
    const bl = b.candidate.lastAssignedAt?.getTime() ?? 0;
    if (al !== bl) return al - bl;
    return a.candidate.userId < b.candidate.userId ? -1 : a.candidate.userId > b.candidate.userId ? 1 : 0;
  });

  return { ranked, ineligible };
}

/** The response zone an alert falls in — only when its location is precise enough to say so. */
export function zoneForLocation<Z extends { id: string; latitude: number; longitude: number; radiusMeters: number }>(
  point: { latitude: number | null; longitude: number | null; accuracyMeters: number | null },
  zones: Z[],
  trustedLocationAccuracyMeters: number,
): Z | null {
  if (point.latitude == null || point.longitude == null) return null;
  if (point.accuracyMeters == null || point.accuracyMeters > trustedLocationAccuracyMeters) return null;
  const containing = zones
    .map((z) => ({ z, d: haversineMeters({ latitude: point.latitude!, longitude: point.longitude! }, z) }))
    .filter(({ z, d }) => d <= z.radiusMeters)
    .sort((a, b) => a.z.radiusMeters - b.z.radiusMeters);
  return containing[0]?.z ?? null;
}
