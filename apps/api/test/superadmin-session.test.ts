import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

describe('Super Admin 12-Hour Session & Mobile Remember Me (Integration)', () => {
  let mongo: MongoMemoryServer;
  let User: typeof import('../src/models/user').User;
  let Session: typeof import('../src/models/user').Session;
  let hashPassword: typeof import('../src/lib/crypto').hashPassword;
  let createSession: typeof import('../src/services/auth.service').createSession;
  let resolveSession: typeof import('../src/services/auth.service').resolveSession;
  let revokeSession: typeof import('../src/services/auth.service').revokeSession;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const { connectDatabase } = await import('../src/db/connect');
    await connectDatabase(mongo.getUri());
    const userModel = await import('../src/models/user');
    User = userModel.User;
    Session = userModel.Session;
    const crypto = await import('../src/lib/crypto');
    hashPassword = crypto.hashPassword;
    const authService = await import('../src/services/auth.service');
    createSession = authService.createSession;
    resolveSession = authService.resolveSession;
    revokeSession = authService.revokeSession;
  });

  afterAll(async () => {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  it('Super Admin web session is created with strict 12-hour absolute lifetime', async () => {
    const passwordHash = await hashPassword('AdminPass123!');
    const admin = await User.create({
      fullName: 'Super Admin User',
      email: 'admin_session_test@srmap.edu.in',
      role: 'super_admin',
      passwordHash,
      emailVerified: true,
      accountStatus: 'active',
    });

    const mockReq = { isMobileClient: false, headers: { 'user-agent': 'Mozilla/5.0 WebBrowser' }, ip: '127.0.0.1' } as any;
    const mockRes = { cookie: () => {}, clearCookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, admin, { method: 'password', mfaVerified: true });
    expect(session.plainToken).toBeUndefined(); // cookie on web, not plain bearer token
    const lifetimeMs = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.round(lifetimeMs / 3600_000)).toBe(12); // Exactly 12 hours
    expect(session.idleExpiresAt.getTime()).toBeLessThanOrEqual(session.expiresAt.getTime());
  });

  it('Student mobile session with Remember Me checked receives extended rememberMeDays lifetime', async () => {
    const passwordHash = await hashPassword('StudentPass123!');
    const student = await User.create({
      fullName: 'Mobile Student',
      email: 'student_rem_test@srmap.edu.in',
      role: 'student',
      passwordHash,
      emailVerified: true,
      accountStatus: 'active',
      studentId: 'AP21110010999',
    });

    const mockReq = { isMobileClient: true, headers: { 'x-campuscare-client': 'android' } } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, student, { remember: true, method: 'password', mfaVerified: true });
    expect(session.plainToken).toBeDefined();
    const lifetimeMs = session.expiresAt.getTime() - session.createdAt.getTime();
    // Default rememberMeDays is 30 days = 30 * 86,400,000 ms
    expect(Math.round(lifetimeMs / 86400_000)).toBe(30); // 30 days remember me
  });

  it('Student mobile session with Remember Me unchecked receives standard session lifetime (not 30 days)', async () => {
    const student = await User.findOne({ email: 'student_rem_test@srmap.edu.in' });
    const mockReq = { isMobileClient: true, headers: { 'x-campuscare-client': 'android' } } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, student!, { remember: false, method: 'password', mfaVerified: true });
    const lifetimeMs = session.expiresAt.getTime() - session.createdAt.getTime();
    expect(Math.round(lifetimeMs / 3600_000)).toBe(24); // Standard 24h absolute, NOT 30 days
  });

  it('Active usage sliding idle window never extends Super Admin session past 12-hour limit', async () => {
    const admin = await User.findOne({ email: 'admin_session_test@srmap.edu.in' });
    const mockReq = { isMobileClient: false, headers: { 'user-agent': 'Mozilla/5.0 Web' }, ip: '127.0.0.1' } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, admin!, { method: 'password', mfaVerified: true });
    const token = 'test-token-' + Date.now();
    const { sha256 } = await import('../src/lib/crypto');
    session.tokenHash = sha256(token);
    await session.save();

    // Fast forward session.lastSeenAt by 5 minutes to trigger sliding idle update
    session.lastSeenAt = new Date(Date.now() - 300_000);
    await session.save();

    const resolved = await resolveSession(token);
    expect(resolved).not.toBeNull();
    // idleExpiresAt must remain strictly capped at expiresAt
    expect(resolved!.session.idleExpiresAt.getTime()).toBeLessThanOrEqual(resolved!.session.expiresAt.getTime());
    expect(resolved!.session.expiresAt.getTime()).toBe(session.expiresAt.getTime());
  });

  it('Super Admin session expires and is rejected when 12 hours elapse', async () => {
    const admin = await User.findOne({ email: 'admin_session_test@srmap.edu.in' });
    const mockReq = { isMobileClient: false, headers: { 'user-agent': 'Mozilla/5.0 Web' }, ip: '127.0.0.1' } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, admin!, { method: 'password', mfaVerified: true });
    const token = 'test-expired-token-' + Date.now();
    const { sha256 } = await import('../src/lib/crypto');
    session.tokenHash = sha256(token);
    // Artificially age session by 12 hours + 1 minute
    const past = new Date(Date.now() - (12 * 3600_000 + 60_000));
    session.createdAt = past;
    session.expiresAt = new Date(past.getTime() + 12 * 3600_000); // expired 1 minute ago
    await session.save();

    const resolved = await resolveSession(token);
    expect(resolved).toBeNull(); // Server rejects expired session!
  });

  it('Explicit logout revokes the server session', async () => {
    const admin = await User.findOne({ email: 'admin_session_test@srmap.edu.in' });
    const mockReq = { isMobileClient: false, headers: { 'user-agent': 'Mozilla/5.0 Web' } } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, admin!, { method: 'password', mfaVerified: true });
    const token = 'token-to-revoke-' + Date.now();
    const { sha256 } = await import('../src/lib/crypto');
    session.tokenHash = sha256(token);
    await session.save();

    await revokeSession(session);
    expect(session.revokedAt).not.toBeNull();

    const resolved = await resolveSession(token);
    expect(resolved).toBeNull();
  });

  it('Account suspension immediately invalidates existing sessions', async () => {
    const admin = await User.findOne({ email: 'admin_session_test@srmap.edu.in' });
    const mockReq = { isMobileClient: false, headers: { 'user-agent': 'Mozilla/5.0 Web' } } as any;
    const mockRes = { cookie: () => {} } as any;

    const session = await createSession(mockReq, mockRes, admin!, { method: 'password', mfaVerified: true });
    const token = 'token-suspended-test-' + Date.now();
    const { sha256 } = await import('../src/lib/crypto');
    session.tokenHash = sha256(token);
    await session.save();

    admin!.accountStatus = 'suspended';
    await admin!.save();

    const resolved = await resolveSession(token);
    expect(resolved).toBeNull();

    // Check that session was marked revoked in database
    const refreshed = await Session.findById(session._id);
    expect(refreshed?.revokedAt).not.toBeNull();
  });
});
