import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase } from '../src/db/connect';
import { User } from '../src/models/user';
import { Appointment, Availability } from '../src/models/counselling';
import { ChatChannel, ChatMembership } from '../src/models/chat';
import { AuditLog, SystemSetting } from '../src/models/platform';
import {
  CounsellorAssignmentService,
  ALGORITHM_VERSION,
  DEFAULT_MAX_ACTIVE_CASELOAD,
} from '../src/services/counsellor-assignment.service';

const d = process.env.SKIP_DB_TESTS === 'true' ? describe.skip : describe;

d('Counsellor Assignment Service (integration)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await connectDatabase(mongo.getUri());

    // Disable turnstile in platform settings
    await SystemSetting.findOneAndUpdate(
      { key: 'platform' },
      { $set: { 'value.turnstile.enabled': false } },
      { upsert: true },
    );
  }, 120_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Availability.deleteMany({});
    await Appointment.deleteMany({});
    await ChatChannel.deleteMany({});
    await ChatMembership.deleteMany({});
  });

  async function createCounsellor(name: string, email: string, active = true, extra: Record<string, unknown> = {}) {
    const user = await User.create({
      fullName: name,
      email,
      role: 'counsellor',
      accountStatus: active ? 'active' : 'suspended',
      emailVerified: true,
      ...extra,
    });

    await Availability.create({
      counsellorId: user._id,
      acceptingRequests: true,
      weekly: [
        { weekday: 1, start: '09:00', end: '17:00' },
        { weekday: 2, start: '09:00', end: '17:00' },
      ],
      slotMinutes: 50,
      timezone: 'Asia/Kolkata',
    });

    return user;
  }

  async function createStudent(name: string, email: string) {
    return User.create({
      fullName: name,
      email,
      role: 'student',
      accountStatus: 'active',
      emailVerified: true,
    });
  }

  it('filters out inactive, suspended, or non-accepting counsellors', async () => {
    const student = await createStudent('Alice Student', 'alice@srmap.edu.in');
    const inactive = await createCounsellor('Inactive Dr. A', 'c1@srmap.edu.in', false);
    const nonAccepting = await User.create({
      fullName: 'Dr. Non Accepting',
      email: 'c2@srmap.edu.in',
      role: 'counsellor',
      accountStatus: 'active',
      emailVerified: true,
    });
    await Availability.create({
      counsellorId: nonAccepting._id,
      acceptingRequests: false,
    });

    const active = await createCounsellor('Active Dr. B', 'c3@srmap.edu.in', true);

    const candidate = await CounsellorAssignmentService.findBestEligibleCounsellor(String(student._id));
    expect(candidate).not.toBeNull();
    expect(candidate?.counsellorId).toBe(String(active._id));
    expect(candidate?.counsellorName).toBe('Active Dr. B');
  });

  it('favors counsellors with lower active caseloads (workload score)', async () => {
    const student = await createStudent('Bob Student', 'bob@srmap.edu.in');
    const busy = await createCounsellor('Busy Dr. C', 'busy@srmap.edu.in', true);
    const free = await createCounsellor('Free Dr. D', 'free@srmap.edu.in', true);

    // Create 4 active future appointments for the busy counsellor
    const futureDate = new Date(Date.now() + 86400_000);
    for (let i = 0; i < 4; i++) {
      await Appointment.create({
        studentId: student._id,
        counsellorId: busy._id,
        startAt: new Date(futureDate.getTime() + i * 3600_000),
        endAt: new Date(futureDate.getTime() + (i + 1) * 3600_000),
        status: 'confirmed',
        idempotencyKey: new Types.ObjectId().toString(),
      });
    }

    const candidate = await CounsellorAssignmentService.findBestEligibleCounsellor(String(student._id));
    expect(candidate).not.toBeNull();
    // Free counsellor should win because of higher workload score
    expect(candidate?.counsellorId).toBe(String(free._id));
    expect(candidate?.workloadScore).toBe(40);
  });

  it('rewards continuity of care when student previously consulted a counsellor', async () => {
    const student = await createStudent('Carol Student', 'carol@srmap.edu.in');
    const prevCounsellor = await createCounsellor('Dr. Previous', 'prev@srmap.edu.in', true);
    const otherCounsellor = await createCounsellor('Dr. Other', 'other@srmap.edu.in', true);

    // Previous completed appointment with Dr. Previous
    await Appointment.create({
      studentId: student._id,
      counsellorId: prevCounsellor._id,
      startAt: new Date(Date.now() - 7 * 86400_000),
      endAt: new Date(Date.now() - 7 * 86400_000 + 3600_000),
      status: 'completed',
      idempotencyKey: new Types.ObjectId().toString(),
    });

    const candidate = await CounsellorAssignmentService.findBestEligibleCounsellor(String(student._id));
    expect(candidate).not.toBeNull();
    expect(candidate?.counsellorId).toBe(String(prevCounsellor._id));
    expect(candidate?.continuityScore).toBe(25);
  });

  it('prevents over-allocation when a counsellor has reached max capacity', async () => {
    const student = await createStudent('Dan Student', 'dan@srmap.edu.in');
    const capped = await createCounsellor('Dr. Maxed', 'maxed@srmap.edu.in', true);

    // Fill capacity up to DEFAULT_MAX_ACTIVE_CASELOAD (12)
    const futureDate = new Date(Date.now() + 86400_000);
    for (let i = 0; i < DEFAULT_MAX_ACTIVE_CASELOAD; i++) {
      await Appointment.create({
        studentId: student._id,
        counsellorId: capped._id,
        startAt: new Date(futureDate.getTime() + i * 3600_000),
        endAt: new Date(futureDate.getTime() + (i + 1) * 3600_000),
        status: 'confirmed',
        idempotencyKey: new Types.ObjectId().toString(),
      });
    }

    const candidate = await CounsellorAssignmentService.findBestEligibleCounsellor(String(student._id), {
      maxCaseload: DEFAULT_MAX_ACTIVE_CASELOAD,
    });
    // With only the capped counsellor available, candidate should be null
    expect(candidate).toBeNull();
  });

  it('autoAssign atomically assigns counsellor, updates chat membership, and creates audit record', async () => {
    const student = await createStudent('Eva Student', 'eva@srmap.edu.in');
    const counsellor = await createCounsellor('Dr. Eva Counsellor', 'eva.c@srmap.edu.in', true);

    const thread = await ChatChannel.create({
      kind: 'counselling_thread',
      name: 'Counselling Thread',
      studentId: student._id,
      published: true,
    });

    const appt = await Appointment.create({
      studentId: student._id,
      counsellorId: null,
      mode: 'in_person',
      reason: 'Academic Stress Consultation',
      status: 'requested',
      threadId: thread._id,
      idempotencyKey: new Types.ObjectId().toString(),
    });

    const result = await CounsellorAssignmentService.autoAssign(
      String(appt._id),
      String(student._id),
    );

    expect(result.assigned).toBe(true);
    expect(result.status).toBe('assigned');
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);

    // Verify appointment was updated
    const updated = await Appointment.findById(appt._id);
    expect(updated?.counsellorId).not.toBeNull();
    expect(updated?.status).toBe('requested');
    expect(updated?.slotLock).toBeTruthy();

    // The private chat opens only when the counsellor accepts: no staff member yet, and the one-hour clock is running.
    const staffMember = await ChatMembership.findOne({ channelId: thread._id, role: 'staff' });
    expect(staffMember).toBeNull();
    expect(updated?.assignedAt).toBeTruthy();
    expect(updated!.responseDueAt!.getTime() - updated!.assignedAt!.getTime()).toBe(60 * 60_000);

    // Verify audit log entry
    const auditRecord = await AuditLog.findOne({
      action: 'counsellor.auto_assigned',
      targetId: String(appt._id),
    });
    expect(auditRecord).not.toBeNull();
  });

  it('reassign successfully changes counsellor and records previous and new counsellor in audit trail', async () => {
    const student = await createStudent('Frank Student', 'frank@srmap.edu.in');
    const c1 = await createCounsellor('Dr. First', 'first@srmap.edu.in', true);
    const c2 = await createCounsellor('Dr. Second', 'second@srmap.edu.in', true);

    const thread = await ChatChannel.create({
      kind: 'counselling_thread',
      name: 'Counselling Thread',
      studentId: student._id,
      published: true,
    });

    const appt = await Appointment.create({
      studentId: student._id,
      counsellorId: c1._id,
      mode: 'online',
      reason: 'Consultation transfer test',
      status: 'confirmed',
      startAt: new Date(Date.now() + 2 * 86400_000),
      endAt: new Date(Date.now() + 2 * 86400_000 + 3600_000),
      threadId: thread._id,
      idempotencyKey: new Types.ObjectId().toString(),
    });

    const reassigned = await CounsellorAssignmentService.reassign(
      String(appt._id),
      String(c2._id),
      'Counsellor schedule change',
      '000000000000000000000001',
    );

    expect(String(reassigned.counsellorId)).toBe(String(c2._id));
    expect(reassigned.statusReason).toContain('schedule change');

    // Verify audit log has before/after
    const auditRecord = await AuditLog.findOne({
      action: 'counsellor.reassigned',
      targetId: String(appt._id),
    });
    expect(auditRecord).not.toBeNull();
    expect(auditRecord?.before).toEqual({ counsellorId: String(c1._id) });
    expect(auditRecord?.after).toEqual({ counsellorId: String(c2._id) });
  });
});
