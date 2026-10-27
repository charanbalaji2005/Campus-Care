import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuditLog } from '../src/models/platform';
import {
  auditMutation,
  verifyAuditChain,
  getRecordHistory,
  getAuditMetrics,
  redactSensitive,
  computeDiff,
} from '../src/services/audit.service';
import { getDbWatcherHealth } from '../src/services/db-watcher.service';

describe('Database Activity & Audit Log System', () => {
  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  it('redacts sensitive fields recursively (passwords, secrets, tokens, hashes)', () => {
    const raw = {
      fullName: 'Dr. Ramesh Kumar',
      password: 'PlaintextPassword123!',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyz',
      nested: {
        token: 'secret-jwt-token',
        totpSecret: 'base32secret',
        email: 'ramesh@srmap.edu.in',
      },
      tags: ['admin', 'verified'],
    };

    const redacted = redactSensitive(raw) as any;
    expect(redacted.fullName).toBe('Dr. Ramesh Kumar');
    expect(redacted.password).toBe('[redacted]');
    expect(redacted.passwordHash).toBe('[redacted]');
    expect(redacted.nested.token).toBe('[redacted]');
    expect(redacted.nested.totpSecret).toBe('[redacted]');
    expect(redacted.nested.email).toBe('ramesh@srmap.edu.in');
    expect(redacted.tags).toEqual(['admin', 'verified']);
  });

  it('computes field-level before/after diffs accurately', () => {
    const before = {
      role: 'student',
      accountStatus: 'pending',
      department: 'CSE',
      tags: ['ug'],
    };
    const after = {
      role: 'campus_admin',
      accountStatus: 'active',
      department: 'CSE',
      tags: ['ug', 'admin'],
    };

    const { changedFields, diff } = computeDiff(before, after);
    expect(changedFields).toContain('role');
    expect(changedFields).toContain('accountStatus');
    expect(changedFields).toContain('tags');
    expect(changedFields).not.toContain('department');

    const roleDiff = diff.find((d) => d.path === 'role');
    expect(roleDiff).toEqual({ path: 'role', prev: 'student', next: 'campus_admin' });
  });

  it('records mutations and verifies SHA-256 tamper-evident hash chaining', async () => {
    const recordId = new mongoose.Types.ObjectId().toString();

    // 1. Initial insert
    const entry1 = await auditMutation({
      collectionName: 'users',
      targetId: recordId,
      operation: 'insert',
      action: 'user.created',
      actorId: 'system',
      actorRole: 'system',
      actorType: 'system',
      after: { fullName: 'Student One', role: 'student', accountStatus: 'active' },
      reason: 'Automated onboarding',
    });

    expect(entry1).toBeDefined();
    expect(entry1.seq).toBeGreaterThan(0);
    expect(entry1.hash).toBeDefined();

    // 2. Field update
    const entry2 = await auditMutation({
      collectionName: 'users',
      targetId: recordId,
      operation: 'update',
      action: 'user.role_changed',
      actorId: 'admin_user_1',
      actorRole: 'super_admin',
      actorType: 'user',
      before: { fullName: 'Student One', role: 'student', accountStatus: 'active' },
      after: { fullName: 'Student One', role: 'safety_officer', accountStatus: 'active' },
      reason: 'Promoted to safety responder on duty',
    });

    expect(entry2.prevHash).toBe(entry1.hash);
    expect(entry2.changedFields).toEqual(['role']);

    // 3. Verify contiguous cryptographic integrity
    const integrity = await verifyAuditChain();
    expect(integrity.ok).toBe(true);
    expect(integrity.checked).toBeGreaterThanOrEqual(2);
  });

  it('retrieves complete record lifecycle timeline history', async () => {
    const testRecordId = new mongoose.Types.ObjectId().toString();

    await auditMutation({
      collectionName: 'emergencyalerts',
      targetId: testRecordId,
      operation: 'insert',
      action: 'sos.created',
      actorId: 'student_123',
      actorRole: 'student',
      after: { status: 'triggered', location: { lat: 16.5, lng: 80.5 } },
    });

    await auditMutation({
      collectionName: 'emergencyalerts',
      targetId: testRecordId,
      operation: 'update',
      action: 'sos.dispatched',
      actorId: 'system',
      actorRole: 'system',
      before: { status: 'triggered' },
      after: { status: 'acknowledged' },
    });

    const history = await getRecordHistory(testRecordId);
    expect(history.recordId).toBe(testRecordId);
    expect(history.count).toBe(2);
    expect(history.events[0].action).toBe('sos.created');
    expect(history.events[1].action).toBe('sos.dispatched');
  });

  it('detects simulated tamper in audit chain', async () => {
    // Attempting direct modification without permission bypasses Mongoose validation via native collection
    const entries = await AuditLog.find().sort({ seq: 1 }).limit(2);
    if (entries.length >= 2) {
      // Tamper with second entry's hash directly in mongo driver
      await mongoose.connection.collection('auditlogs').updateOne(
        { _id: entries[1]._id },
        { $set: { hash: 'tampered-fake-hash-1234567890abcdef' } },
      );

      const tamperedCheck = await verifyAuditChain();
      expect(tamperedCheck.ok).toBe(false);
      expect(tamperedCheck.brokenAtSeq).toBe(entries[1].seq);

      // Restore valid hash to keep clean state
      await mongoose.connection.collection('auditlogs').updateOne(
        { _id: entries[1]._id },
        { $set: { hash: entries[1].hash } },
      );

      const restoredCheck = await verifyAuditChain();
      expect(restoredCheck.ok).toBe(true);
    }
  });

  it('blocks direct modification and deletion of audit records via Mongoose', async () => {
    const entry = await AuditLog.findOne();
    if (entry) {
      // Pre-hooks must prevent updateOne and deleteOne without explicit allowAuditRetention
      await expect(
        AuditLog.updateOne({ _id: entry._id }, { $set: { action: 'tampered.action' } }),
      ).rejects.toThrow();

      await expect(
        AuditLog.deleteOne({ _id: entry._id }),
      ).rejects.toThrow();
    }
  });

  it('aggregates operational audit metrics', async () => {
    const metrics = await getAuditMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.totalEvents).toBe('number');
    expect(metrics.totalEvents).toBeGreaterThan(0);
    expect(metrics.byOperation).toBeDefined();
  });

  it('reports database watcher health and status', () => {
    const health = getDbWatcherHealth();
    expect(health).toBeDefined();
    expect(['active', 'unsupported_standalone', 'stopped', 'reconnecting', 'error']).toContain(health.status);
    expect(Array.isArray(health.monitoredCollections)).toBe(true);
  });
});
