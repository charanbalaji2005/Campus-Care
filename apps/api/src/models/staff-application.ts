import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  APPOINTMENT_MODES, COMMITTEE_APPLICATION_POSITIONS, COUNSELLING_TYPES, SECURITY_SHIFT_PREFERENCES,
  STAFF_APPLICATION_STATUSES, STAFF_REGISTRATION_ROLES,
} from '@campuscare/shared';

const historySchema = new Schema(
  {
    at: { type: Date, default: Date.now },
    /** null = the system (e.g. email verified). */
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    action: { type: String, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    reason: { type: String, default: null, maxlength: 1000 },
  },
  { _id: false },
);

/**
 * A CampusCare College staff application: the role-specific details someone submitted and where the
 * role approval stands. The account (User) carries the other, separate states: email verification,
 * institutional identity verification and activation. Nothing here grants access; only an approval by
 * a Super Admin (routes/staff-applications.routes.ts) assigns the role, from this record, on the server.
 */
const staffApplicationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedRole: { type: String, enum: STAFF_REGISTRATION_ROLES, required: true },
    status: { type: String, enum: STAFF_APPLICATION_STATUSES, default: 'pending_email_verification', required: true },
    registrationMethod: { type: String, enum: ['password', 'google'], default: 'password' },
    // Submitted identity details (the account holds the same values; kept here as submitted).
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true },
    staffId: { type: String, required: true, uppercase: true, trim: true },
    department: { type: String, required: true, trim: true },
    campus: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    phone: { type: String, default: null },
    counsellor: {
      type: new Schema({
        specializations: { type: [String], enum: COUNSELLING_TYPES, default: [] },
        languages: { type: [String], default: [] },
        qualifications: { type: String, default: null },
        bio: { type: String, default: null },
        experienceYears: { type: Number, default: null },
        sessionModes: { type: [String], enum: APPOINTMENT_MODES, default: [] },
      }, { _id: false }),
      default: null,
    },
    admin: {
      type: new Schema({ authorizationReference: { type: String, default: null } }, { _id: false }),
      default: null,
    },
    committee: {
      type: new Schema({
        committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', required: true },
        committeeName: { type: String, default: null },
        position: { type: String, enum: COMMITTEE_APPLICATION_POSITIONS, default: 'member' },
        identifierType: { type: String, enum: ['staff', 'student'], default: 'staff' },
        reason: { type: String, default: null },
        experience: { type: String, default: null },
      }, { _id: false }),
      default: null,
    },
    security: {
      type: new Schema({
        serviceProvider: { type: String, default: null },
        shiftPreference: { type: String, enum: SECURITY_SHIFT_PREFERENCES, default: 'no_preference' },
        qualifications: { type: String, default: null },
        authorizationReference: { type: String, default: null },
      }, { _id: false }),
      default: null,
    },
    /** What a reviewer asked for (needs_info) and the applicant's latest reply. */
    infoRequest: { type: String, default: null },
    applicantNote: { type: String, default: null },
    decisionReason: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    /** Exactly what an approval granted (role, campus scope, committee), for the record. */
    granted: {
      type: new Schema({
        role: String,
        campus: String,
        committeeId: { type: Schema.Types.ObjectId, ref: 'Committee', default: null },
        committeePosition: { type: String, default: null },
        counsellorListed: { type: Boolean, default: null },
      }, { _id: false }),
      default: null,
    },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true },
);
staffApplicationSchema.index({ userId: 1 }, { unique: true });
staffApplicationSchema.index({ status: 1, createdAt: -1 });
staffApplicationSchema.index({ requestedRole: 1, campus: 1 });
staffApplicationSchema.index({ staffId: 1 });

export const StaffApplication = model('StaffApplication', staffApplicationSchema);
export type StaffApplicationDoc = HydratedDocument<InferSchemaType<typeof staffApplicationSchema>>;
