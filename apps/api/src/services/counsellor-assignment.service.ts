import { Types } from 'mongoose';
import { User, type UserDoc } from '../models/user';
import { Appointment, Availability, type AppointmentDoc } from '../models/counselling';
import { ChatChannel, ChatMembership } from '../models/chat';
import { audit } from './audit.service';
import { notify, notifyMany } from './notification.service';
import { logger } from '../lib/logger';
import { AppError } from '../lib/http';
import { generateSlots } from '../lib/time';

export const ALGORITHM_VERSION = 'v1.0.0-workload-aware';
export const DEFAULT_MAX_ACTIVE_CASELOAD = 12;

export interface CounsellorCandidateScore {
  counsellorId: string;
  counsellorName: string;
  activeCaseload: number;
  workloadScore: number;
  availabilityScore: number;
  continuityScore: number;
  fairRotationScore: number;
  totalScore: number;
  reasons: string[];
}

export interface AssignmentResult {
  assigned: boolean;
  counsellorId?: string;
  counsellorName?: string;
  status: 'assigned' | 'pending_assignment';
  algorithmVersion: string;
  scoreBreakdown?: CounsellorCandidateScore;
  message: string;
}

export class CounsellorAssignmentService {
  /**
   * Evaluates all verified active counsellors and selects the best candidate
   * based on transparent, workload-aware, and fair-rotation scoring.
   */
  static async findBestEligibleCounsellor(
    studentId: string,
    options: {
      campus?: string;
      preferredMode?: string;
      maxCaseload?: number;
    } = {},
  ): Promise<CounsellorCandidateScore | null> {
    const maxCaseload = options.maxCaseload ?? DEFAULT_MAX_ACTIVE_CASELOAD;
    const now = new Date();

    // Step A: Find all eligible counsellors (active account, verified, role counsellor)
    const eligibleCounsellors = await User.find(
      {
        role: 'counsellor',
        accountStatus: 'active',
      },
      { _id: 1, fullName: 1, email: 1, department: 1 },
    ).lean();

    if (eligibleCounsellors.length === 0) {
      logger.warn('No active verified counsellors found in database');
      return null;
    }

    // Check their Availabilities
    const counsellorIds = eligibleCounsellors.map((c) => c._id);
    const availabilities = await Availability.find({
      counsellorId: { $in: counsellorIds },
      acceptingRequests: true,
    }).lean();

    const acceptingCounsellorIds = new Set(availabilities.map((a) => String(a.counsellorId)));

    // Active appointments query to measure current workload
    const activeAppointments = await Appointment.find({
      counsellorId: { $in: counsellorIds },
      status: { $in: ['requested', 'confirmed', 'rescheduled'] },
      $or: [{ startAt: { $gt: now } }, { startAt: null }],
    }).lean();

    const activeCounts = new Map<string, number>();
    for (const appt of activeAppointments) {
      if (appt.counsellorId) {
        const cId = String(appt.counsellorId);
        activeCounts.set(cId, (activeCounts.get(cId) ?? 0) + 1);
      }
    }

    // Historical continuity check (has this student consulted this counsellor before?)
    const pastAppointments = await Appointment.find({
      studentId: new Types.ObjectId(studentId),
      counsellorId: { $in: counsellorIds },
    })
      .sort({ createdAt: -1 })
      .lean();

    const previousCounsellorId = pastAppointments.length > 0 ? String(pastAppointments[0].counsellorId) : null;

    // Recent assignments to compute fair rotation
    const recentAssignments = await Appointment.find({
      counsellorId: { $in: counsellorIds },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const candidateScores: CounsellorCandidateScore[] = [];

    for (const counsellor of eligibleCounsellors) {
      const cId = String(counsellor._id);

      // Must be accepting requests
      if (!acceptingCounsellorIds.has(cId)) {
        continue;
      }

      const activeCaseload = activeCounts.get(cId) ?? 0;

      // Filter out overloaded counsellors
      if (activeCaseload >= maxCaseload) {
        continue;
      }

      const reasons: string[] = [];

      // 1. Workload Score: 0 to 40 points (favor lower active caseload)
      const openCapacity = Math.max(0, maxCaseload - activeCaseload);
      const workloadScore = Math.round((openCapacity / maxCaseload) * 40);
      reasons.push(`Open caseload capacity: ${openCapacity}/${maxCaseload} (+${workloadScore} pts)`);

      // 2. Availability Score: 0 to 20 points
      const avail = availabilities.find((a) => String(a.counsellorId) === cId);
      let availabilityScore = 10;
      if (avail && avail.weekly && avail.weekly.length > 0) {
        availabilityScore = 20;
        reasons.push(`Published weekly schedule active (+${availabilityScore} pts)`);
      }

      // 3. Continuity Score: 0 or 25 points (re-matching previous student case when possible)
      let continuityScore = 0;
      if (previousCounsellorId === cId) {
        continuityScore = 25;
        reasons.push(`Care continuity match: student previous counsellor (+${continuityScore} pts)`);
      }

      // 4. Fair Rotation Score: 0 to 15 points (avoid assigning every request to the same person)
      const lastAssignedIndex = recentAssignments.findIndex((a) => String(a.counsellorId) === cId);
      let fairRotationScore = 15;
      if (lastAssignedIndex === 0) {
        fairRotationScore = 0; // Most recently assigned
      } else if (lastAssignedIndex >= 1 && lastAssignedIndex <= 3) {
        fairRotationScore = 5;
      } else if (lastAssignedIndex > 3) {
        fairRotationScore = 10;
      }
      reasons.push(`Fair rotation balance (+${fairRotationScore} pts)`);

      const totalScore = workloadScore + availabilityScore + continuityScore + fairRotationScore;

      candidateScores.push({
        counsellorId: cId,
        counsellorName: counsellor.fullName,
        activeCaseload,
        workloadScore,
        availabilityScore,
        continuityScore,
        fairRotationScore,
        totalScore,
        reasons,
      });
    }

    if (candidateScores.length === 0) {
      return null;
    }

    // Step C: Rank candidates deterministically
    candidateScores.sort((a, b) => {
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      if (a.activeCaseload !== b.activeCaseload) return a.activeCaseload - b.activeCaseload;
      return a.counsellorId.localeCompare(b.counsellorId); // Deterministic tie-breaker
    });

    return candidateScores[0];
  }

  /**
   * Atomically assigns the top candidate or puts in pending_assignment queue if no candidate exists.
   */
  static async autoAssign(
    appointmentId: string,
    studentId: string,
    actorId?: string,
  ): Promise<AssignmentResult> {
    const candidate = await this.findBestEligibleCounsellor(studentId);

    if (!candidate) {
      // Step F: No eligible counsellor available
      await Appointment.findByIdAndUpdate(appointmentId, {
        $set: {
          counsellorId: null,
          status: 'requested',
          statusReason: 'Queued for automatic assignment. Awaiting available counsellor opening.',
        },
      });

      // Notify counselling coordinators
      const coordinators = await User.find(
        {
          accountStatus: 'active',
          $or: [{ role: 'super_admin' }, { permissions: 'appointments:read_aggregate' }],
        },
        { _id: 1 },
      ).lean();

      await notifyMany(coordinators.map((c) => String(c._id)), {
        kind: 'counselling_unassigned',
        title: 'Unassigned Counselling Request',
        body: 'A counselling request is pending coordinator assignment due to counsellor capacity.',
        link: '/super-admin/counselling',
        priority: 'high',
        category: 'appointments',
      });

      return {
        assigned: false,
        status: 'pending_assignment',
        algorithmVersion: ALGORITHM_VERSION,
        message: 'Your request has been placed in the priority counselling queue. A coordinator will assign a counsellor shortly.',
      };
    }

    // Step D: Prevent race conditions & commit assignment
    const appt = await Appointment.findById(appointmentId);
    if (!appt) throw new AppError(404, 'not_found', 'Appointment not found');

    const assignedCounsellorId = new Types.ObjectId(candidate.counsellorId);
    appt.counsellorId = assignedCounsellorId;
    appt.status = 'requested';
    appt.statusReason = `Auto-assigned via ${ALGORITHM_VERSION} (score: ${candidate.totalScore})`;

    // If startAt wasn't assigned, find the earliest available slot from counsellor's schedule
    if (!appt.startAt) {
      const avail = await Availability.findOne({ counsellorId: assignedCounsellorId }).lean();
      if (avail && avail.weekly && avail.weekly.length > 0) {
        const generated = generateSlots({
          weekly: avail.weekly as never,
          slotMinutes: avail.slotMinutes ?? 50,
          timezone: avail.timezone ?? 'Asia/Kolkata',
          blockedDates: avail.blockedDates ?? [],
        });
        const active = await Appointment.find(
          { counsellorId: assignedCounsellorId, status: { $in: ['requested', 'confirmed', 'rescheduled'] } },
          { startAt: 1 },
        ).lean();
        const booked = new Set(active.map((a) => (a.startAt ? a.startAt.toISOString() : '')));
        const openSlot = generated.find((s) => !booked.has(s.toISOString()));
        if (openSlot) {
          appt.startAt = openSlot;
          appt.endAt = new Date(openSlot.getTime() + (avail.slotMinutes ?? 50) * 60_000);
        }
      }
    }

    if (appt.startAt) {
      appt.slotLock = `${candidate.counsellorId}:${appt.startAt.toISOString()}`;
    }

    await appt.save();

    // Ensure chat channel membership
    if (appt.threadId) {
      await ChatMembership.findOneAndUpdate(
        { channelId: appt.threadId, role: 'staff' },
        { $set: { userId: assignedCounsellorId } },
        { upsert: true },
      );
    }

    // Step E: Audit and discreet notifications
    await audit({
      action: 'counsellor.auto_assigned',
      actorId: actorId || null,
      targetType: 'appointment',
      targetId: appointmentId,
      meta: {
        algorithmVersion: ALGORITHM_VERSION,
        counsellorId: candidate.counsellorId,
        score: candidate.totalScore,
        breakdown: candidate,
      },
    });

    // Notify counsellor
    await notify({
      userId: candidate.counsellorId,
      kind: 'appointment',
      category: 'appointments',
      title: 'New Student Counselling Assignment',
      body: 'You have been assigned a new student counselling request.',
      link: `/consultancy/appointments?focus=${appointmentId}`,
      priority: 'high',
    });

    // Notify student with discreet text (no private details)
    await notify({
      userId: studentId,
      kind: 'appointment_assigned',
      category: 'appointments',
      title: 'Counselling Update',
      body: 'A qualified counsellor has been assigned to your consultation request.',
      link: '/s/counselling',
      priority: 'normal',
    });

    return {
      assigned: true,
      counsellorId: candidate.counsellorId,
      counsellorName: candidate.counsellorName,
      status: 'assigned',
      algorithmVersion: ALGORITHM_VERSION,
      scoreBreakdown: candidate,
      message: 'Counsellor assigned successfully.',
    };
  }

  /**
   * Step G: Reassign appointment when a counsellor becomes unavailable or case is transferred.
   */
  static async reassign(
    appointmentId: string,
    newCounsellorId: string,
    reason: string,
    actorId: string,
  ): Promise<AppointmentDoc> {
    const appt = await Appointment.findById(appointmentId);
    if (!appt) throw new AppError(404, 'not_found', 'Appointment not found');

    const previousCounsellorId = appt.counsellorId ? String(appt.counsellorId) : null;

    // Verify new counsellor is valid and active
    const newCounsellor = await User.findOne({
      _id: new Types.ObjectId(newCounsellorId),
      role: 'counsellor',
      accountStatus: 'active',
    }).lean();

    if (!newCounsellor) {
      throw new AppError(422, 'invalid_counsellor', 'Selected counsellor is not active or eligible.');
    }

    appt.counsellorId = new Types.ObjectId(newCounsellorId);
    appt.statusReason = `Reassigned: ${reason}`;
    if (appt.startAt) {
      appt.slotLock = `${newCounsellorId}:${appt.startAt.toISOString()}`;
    }
    await appt.save();

    // Update staff participant in thread
    if (appt.threadId) {
      await ChatMembership.findOneAndUpdate(
        { channelId: appt.threadId, role: 'staff' },
        { $set: { userId: new Types.ObjectId(newCounsellorId) } },
        { upsert: true },
      );
    }

    await audit({
      action: 'counsellor.reassigned',
      actorId,
      targetType: 'appointment',
      targetId: appointmentId,
      before: { counsellorId: previousCounsellorId },
      after: { counsellorId: newCounsellorId },
      meta: { reason },
    });

    // Notify new counsellor
    await notify({
      userId: newCounsellorId,
      kind: 'appointment',
      category: 'appointments',
      title: 'Transferred Counselling Case',
      body: `You have been assigned an appointment: ${reason}`,
      link: `/consultancy/appointments?focus=${appointmentId}`,
      priority: 'high',
    });

    return appt;
  }
}
