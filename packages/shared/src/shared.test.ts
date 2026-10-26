import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS, canTransition, chatMediaDecision, deepMerge, formatCaseNumber, hasPermission,
  incidentCreateSchema, registerSchema, assignableRoles, MEDIA_SCOPES, domainSchema, isAllowedAccountEmail, suggestIncidentCategory,
} from './index';

describe('chat media policy', () => {
  it('is OFF by default for every chat type', () => {
    for (const scope of MEDIA_SCOPES) {
      expect(DEFAULT_SETTINGS.chat.media[scope]).toEqual({ images: false, videos: false });
      expect(chatMediaDecision(DEFAULT_SETTINGS, scope, 'image/jpeg').allowed).toBe(false);
      expect(chatMediaDecision(DEFAULT_SETTINGS, scope, 'video/mp4').allowed).toBe(false);
    }
  });

  it('allows images in support chat only after the Super Admin enables them', () => {
    const s = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: true } } } });
    expect(chatMediaDecision(s, 'support', 'image/png').allowed).toBe(true);
    expect(chatMediaDecision(s, 'support', 'video/mp4').allowed).toBe(false);
    expect(chatMediaDecision(s, 'community', 'image/png').allowed).toBe(false);
  });

  it('enforces size limits and rejects non-media types', () => {
    const s = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: true, videos: true } } } });
    expect(chatMediaDecision(s, 'support', 'video/mp4', 51 * 1024 * 1024).allowed).toBe(false);
    expect(chatMediaDecision(s, 'support', 'video/mp4', 5 * 1024 * 1024).allowed).toBe(true);
    expect(chatMediaDecision(s, 'support', 'application/x-msdownload').allowed).toBe(false);
  });
});

describe('workflow', () => {
  it('only allows defined status transitions', () => {
    expect(canTransition('submitted', 'assigned')).toBe(true);
    expect(canTransition('submitted', 'closed')).toBe(false);
    expect(canTransition('closed', 'in_progress')).toBe(false);
  });

  it('formats case numbers', () => {
    expect(formatCaseNumber(2026, 142)).toBe('CC-2026-000142');
  });
});

describe('permissions', () => {
  it('does not give admins sensitive case content or counselling notes by default', () => {
    expect(hasPermission({ role: 'admin' }, 'incidents:read_sensitive')).toBe(false);
    expect(hasPermission({ role: 'super_admin' }, 'incidents:read_sensitive')).toBe(false);
    expect(hasPermission({ role: 'super_admin' }, 'counselling_notes:read_all')).toBe(false);
    expect(hasPermission({ role: 'admin', permissions: ['incidents:read_sensitive'] }, 'incidents:read_sensitive')).toBe(true);
  });

  it('ignores unknown permission strings', () => {
    expect(hasPermission({ role: 'student', permissions: ['*'] }, 'admin:access')).toBe(false);
  });

  it('prevents admins from creating admins', () => {
    expect(assignableRoles('admin')).not.toContain('admin');
    expect(assignableRoles('admin')).not.toContain('super_admin');
    expect(assignableRoles('student')).toEqual([]);
  });
});

describe('schemas', () => {
  it('rejects weak passwords and mismatches', () => {
    const base = { fullName: 'Sam Student', email: 'sam.student@srmap.edu.in', studentId: 'AP21', department: 'Physics', academicYear: 2, acceptPolicy: true };
    expect(registerSchema.safeParse({ ...base, password: 'short', confirmPassword: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'Str0ngPassword', confirmPassword: 'Different1A' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: 'Str0ngPassword', confirmPassword: 'Str0ngPassword' }).success).toBe(true);
  });

  it('only allows @srmap.edu.in accounts', () => {
    const base = { fullName: 'Sam Student', studentId: 'AP21', department: 'Physics', academicYear: 2, acceptPolicy: true, password: 'Str0ngPassword', confirmPassword: 'Str0ngPassword' };
    expect(registerSchema.safeParse({ ...base, email: 'sam@srmap.edu.in' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, email: 'SAM@SRMAP.EDU.IN' }).success).toBe(true);
    for (const bad of ['sam@srmap.edu.in.evil.com', 'sam@evil-srmap.edu.in', 'sam@sub.srmap.edu.in', 'srmap.edu.in@gmail.com.evil.com']) {
      expect(registerSchema.safeParse({ ...base, email: bad }).success, bad).toBe(false);
    }
    expect(isAllowedAccountEmail('a.b@srmap.edu.in')).toBe(true);
  });

  it('lets handlers move cases only along allowed paths, including review and reopen', () => {
    expect(canTransition('assigned', 'under_review')).toBe(true);
    expect(canTransition('reopened', 'in_progress')).toBe(true);
    expect(canTransition('withdrawn', 'in_progress')).toBe(false);
  });

  it('rejects future incident dates', () => {
    const r = incidentCreateSchema.safeParse({
      category: 'ragging', title: 'Test case', description: 'x'.repeat(40), incidentDate: new Date(Date.now() + 86400000),
      location: 'Block A', idempotencyKey: '7f1f8f3c-8c1e-4a43-9a3e-5bd9b1f4a8d2',
    });
    expect(r.success).toBe(false);
  });

  it('validates domains', () => {
    expect(domainSchema.safeParse({ domain: 'srmap.edu.in' }).success).toBe(true);
    expect(domainSchema.safeParse({ domain: 'not a domain' }).success).toBe(false);
    expect(domainSchema.safeParse({ domain: '@evil.com' }).success).toBe(false);
  });
});

describe('category suggestion (assistive only)', () => {
  it('suggests sensible categories and explains why', () => {
    const r = suggestIncidentCategory('Seniors in the hostel forced us freshers to perform at night, it was ragging');
    expect(r.category).toBe('ragging');
    expect(r.matched.length).toBeGreaterThan(0);
    expect(suggestIncidentCategory('Someone made a fake profile on Instagram with my morphed photos').category).toBe('cyber_abuse');
    expect(suggestIncidentCategory('The lights on the path near the library are broken and it is dark').category).toBe('infrastructure');
  });
  it('falls back to other with low confidence and flags danger / crisis language', () => {
    const r = suggestIncidentCategory('I want to talk to someone about something');
    expect(r.category).toBe('other');
    expect(r.confidence).toBeLessThan(0.35);
    expect(suggestIncidentCategory('a man with a knife is following me now').looksUrgent).toBe(true);
    expect(suggestIncidentCategory('I feel like I want to die').showCrisisSupport).toBe(true);
  });
});
