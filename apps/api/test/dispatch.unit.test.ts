import { describe, expect, it } from 'vitest';
import { DUTY_STATUSES, canTransitionDuty, DEFAULT_SETTINGS, recoveryCodeInput, type DutyStatus } from '@campuscare/shared';
import {
  checkEligibility, haversineMeters, isHeartbeatFresh, isTrustworthyLocation, rankResponders, zoneForLocation,
  type DispatchAlertContext, type DispatchCandidate, type DispatchRules,
} from '../src/services/dispatch.policy';

const NOW = Date.parse('2026-10-25T10:00:00Z');
const ago = (s: number) => new Date(NOW - s * 1000);

const rules: DispatchRules = {
  staleThresholdSeconds: 120,
  maxActiveAssignmentsPerResponder: 1,
  allowBusyResponders: false,
  requiredSkills: [],
  preferredSkills: ['first_aid'],
  trustedLocationAccuracyMeters: 100,
  proximityBandMeters: 250,
};

function responder(id: string, over: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    userId: id, name: id, status: 'on_duty', lastHeartbeatAt: ago(10), campus: 'main', zoneId: null, skills: [], responsibilities: ['sos_response'],
    activeAssignmentCount: 0, lastAssignedAt: null, location: null, accountActive: true, canRespond: true, ...over,
  };
}
const alert = (over: Partial<DispatchAlertContext> = {}): DispatchAlertContext => ({
  campus: 'main', zoneId: null, latitude: 16.4636, longitude: 80.5074, accuracyMeters: 20, excludedResponderIds: new Set(), ...over,
});
const order = (cands: DispatchCandidate[], a = alert(), r = rules) => rankResponders(cands, a, r, NOW).ranked.map((x) => x.candidate.userId);

describe('dispatch eligibility', () => {
  it('only on-duty, reachable, permitted, qualified responders with capacity are eligible', () => {
    const cases: [Partial<DispatchCandidate>, string][] = [
      [{ accountActive: false }, 'account_inactive'],
      [{ canRespond: false }, 'no_permission'],
      [{ responsibilities: ['patrol'] }, 'not_assigned_sos_response'],
      [{ status: 'off_duty' }, 'not_on_duty'],
      [{ status: 'on_break' }, 'not_on_duty'],
      [{ status: 'unavailable' }, 'not_on_duty'],
      [{ status: 'stale' }, 'not_on_duty'],
      [{ status: 'responding' }, 'not_on_duty'],
      [{ status: 'busy' }, 'busy'],
      [{ lastHeartbeatAt: ago(121) }, 'stale_heartbeat'],
      [{ lastHeartbeatAt: null }, 'stale_heartbeat'],
      [{ campus: 'north' }, 'different_campus'],
      [{ activeAssignmentCount: 1 }, 'at_capacity'],
    ];
    for (const [over, reason] of cases) {
      const r = checkEligibility(responder('x', over), alert(), rules, NOW);
      expect(r, JSON.stringify(over)).toEqual({ eligible: false, reason });
    }
    expect(checkEligibility(responder('x'), alert(), rules, NOW)).toEqual({ eligible: true });
  });

  it('excludes responders already tried for this alert', () => {
    expect(checkEligibility(responder('x'), alert({ excludedResponderIds: new Set(['x']) }), rules, NOW)).toEqual({ eligible: false, reason: 'already_tried' });
  });

  it('enforces required skills and optionally allows busy responders', () => {
    const r = { ...rules, requiredSkills: ['first_aid'], allowBusyResponders: true };
    expect(checkEligibility(responder('x'), alert(), r, NOW)).toEqual({ eligible: false, reason: 'missing_required_skill' });
    expect(checkEligibility(responder('x', { skills: ['first_aid'], status: 'busy' }), alert(), r, NOW)).toEqual({ eligible: true });
  });

  it('a heartbeat exactly at the threshold is still fresh; one second later it is not', () => {
    expect(isHeartbeatFresh(ago(120), NOW, 120)).toBe(true);
    expect(isHeartbeatFresh(ago(121), NOW, 120)).toBe(false);
  });
});

describe('dispatch ranking', () => {
  it('ranks qualifications, then workload, then zone, then trusted proximity, then fairness', () => {
    const near = { latitude: 16.4637, longitude: 80.5075, accuracyMeters: 10, at: ago(5) };
    const far = { latitude: 16.4736, longitude: 80.5174, accuracyMeters: 10, at: ago(5) };
    const r = { ...rules, maxActiveAssignmentsPerResponder: 3 };
    // Preferred skill beats everything below it.
    expect(order([responder('a', { location: near }), responder('b', { skills: ['first_aid'], location: far })], alert(), r)).toEqual(['b', 'a']);
    // Lower workload beats zone and distance.
    expect(order([responder('a', { activeAssignmentCount: 1, location: near, zoneId: 'z' }), responder('b', { location: far })], alert({ zoneId: 'z' }), r)).toEqual(['b', 'a']);
    // Same zone beats proximity.
    expect(order([responder('a', { location: near }), responder('b', { zoneId: 'z', location: far })], alert({ zoneId: 'z' }), r)).toEqual(['b', 'a']);
    // Proximity when both positions are trusted.
    expect(order([responder('a', { location: far }), responder('b', { location: near })], alert(), r)).toEqual(['b', 'a']);
    // Fairness: whoever was assigned least recently goes first.
    expect(order([responder('a', { lastAssignedAt: ago(60) }), responder('b', { lastAssignedAt: ago(3600) })], alert(), r)).toEqual(['b', 'a']);
  });

  it('never uses GPS when the alert or the responder position is imprecise or old', () => {
    const near = { latitude: 16.4637, longitude: 80.5075, accuracyMeters: 10, at: ago(5) };
    const far = { latitude: 16.4736, longitude: 80.5174, accuracyMeters: 10, at: ago(5) };
    // Imprecise alert: distance is not compared at all, fairness decides.
    expect(order([responder('a', { location: near, lastAssignedAt: ago(10) }), responder('b', { location: far })], alert({ accuracyMeters: 900 }))).toEqual(['b', 'a']);
    // An old or imprecise responder fix is never assumed to be close.
    const ranked = rankResponders([responder('a', { location: { ...near, at: ago(600) } }), responder('b', { location: far })], alert(), rules, NOW).ranked;
    expect(ranked.map((x) => x.candidate.userId)).toEqual(['b', 'a']);
    expect(ranked[1]!.distanceMeters).toBeNull();
    expect(isTrustworthyLocation({ accuracyMeters: null }, rules, NOW)).toBe(false);
  });

  it('compares distances in bands so GPS noise cannot reorder nearby responders', () => {
    const p = (dLat: number) => ({ latitude: 16.4636 + dLat, longitude: 80.5074, accuracyMeters: 10, at: ago(5) });
    // ~50 m and ~150 m are both in the 0–250 m band → fairness decides (a was assigned more recently).
    const ranked = order([responder('a', { location: p(0.00045), lastAssignedAt: ago(10) }), responder('b', { location: p(0.00135), lastAssignedAt: ago(20) })]);
    expect(ranked).toEqual(['b', 'a']);
  });

  it('is deterministic for exact ties and explains each decision', () => {
    const ranked = rankResponders([responder('b'), responder('a')], alert(), rules, NOW).ranked;
    expect(ranked.map((x) => x.candidate.userId)).toEqual(['a', 'b']);
    expect(ranked[0]!.explanation).toMatch(/On duty/);
  });

  it('a nearby responder who is off duty is never chosen over a distant on-duty one', () => {
    const near = { latitude: 16.4637, longitude: 80.5075, accuracyMeters: 5, at: ago(5) };
    expect(order([responder('near', { status: 'off_duty', location: near }), responder('far')])).toEqual(['far']);
  });
});

describe('zones and geometry', () => {
  it('measures distance and places an alert only when its location is precise enough', () => {
    expect(Math.round(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) / 1000)).toBe(111);
    const zones = [{ id: 'big', latitude: 16.4636, longitude: 80.5074, radiusMeters: 1000 }, { id: 'small', latitude: 16.4636, longitude: 80.5074, radiusMeters: 100 }];
    expect(zoneForLocation({ latitude: 16.4636, longitude: 80.5074, accuracyMeters: 20 }, zones, 100)?.id).toBe('small');
    expect(zoneForLocation({ latitude: 16.4636, longitude: 80.5074, accuracyMeters: 500 }, zones, 100)).toBeNull();
    expect(zoneForLocation({ latitude: null, longitude: null, accuracyMeters: null }, zones, 100)).toBeNull();
  });
});

describe('duty transitions', () => {
  it('only the server can set responding or stale', () => {
    for (const from of DUTY_STATUSES) {
      expect(canTransitionDuty(from, 'stale', 'self')).toBe(false);
      expect(canTransitionDuty(from, 'responding', 'supervisor')).toBe(false);
    }
    expect(canTransitionDuty('on_duty', 'stale', 'system')).toBe(true);
    expect(canTransitionDuty('on_duty', 'responding', 'system')).toBe(true);
  });

  it('a stale responder is never moved off duty by the system on staleness alone, and cannot clear stale themselves', () => {
    expect(canTransitionDuty('stale', 'on_duty', 'self')).toBe(false);
    expect(canTransitionDuty('stale', 'on_duty', 'system')).toBe(true); // heartbeat resumed
    expect(canTransitionDuty('stale', 'off_duty', 'supervisor')).toBe(true);
  });

  it('rejects transitions outside the table for every actor', () => {
    const all: DutyStatus[] = [...DUTY_STATUSES];
    expect(canTransitionDuty('off_duty', 'on_break', 'supervisor')).toBe(false);
    expect(canTransitionDuty('unavailable', 'busy', 'system')).toBe(false);
    for (const s of all) expect(canTransitionDuty(s, s, 'system')).toBe(false);
  });

  it('ships the requested heartbeat defaults', () => {
    expect(DEFAULT_SETTINGS.duty.heartbeatIntervalSeconds).toBe(45);
    expect(DEFAULT_SETTINGS.duty.staleThresholdSeconds).toBe(120);
  });
});

describe('recovery codes', () => {
  it('generates exactly formatted, unambiguous codes and hashes them with a server-side pepper', async () => {
    const { generateRecoveryCode, hashRecoveryCode, RECOVERY_CODE_COUNT } = await import('../src/services/mfa.service');
    expect(RECOVERY_CODE_COUNT).toBe(8);
    const codes = new Set(Array.from({ length: 500 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
    const one = [...codes][0]!;
    expect(hashRecoveryCode(one)).toBe(hashRecoveryCode(one.toUpperCase().replace('-', ' ')));
    expect(hashRecoveryCode(one)).not.toContain(one.replace('-', ''));
    expect(recoveryCodeInput.parse(' K7D2M-9XQ4P ')).toBe('k7d2m9xq4p');
    expect(recoveryCodeInput.safeParse('short').success).toBe(false);
  });
});
