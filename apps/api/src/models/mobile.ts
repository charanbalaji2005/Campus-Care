import { Schema, model } from 'mongoose';

/** One row per signed-in app installation. Removed when its session is revoked or signs out. */
const deviceRegistrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true },
    platform: { type: String, enum: ['android'], required: true },
    /** CampusCare Student or CampusCare College (null for app builds from before the split). */
    app: { type: String, enum: ['student', 'college', null], default: null },
    /** Firebase Cloud Messaging registration token (only when push is configured). */
    pushToken: { type: String, default: null },
    appVersion: { type: String, required: true },
    appVersionCode: { type: Number, required: true },
    deviceName: { type: String, default: null },
    lastSeenAt: { type: Date, default: Date.now },
    pushFailures: { type: Number, default: 0 },
  },
  { timestamps: true },
);
deviceRegistrationSchema.index({ sessionId: 1 }, { unique: true });
deviceRegistrationSchema.index({ userId: 1 });
deviceRegistrationSchema.index({ pushToken: 1 });
deviceRegistrationSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 120 * 86400 });
export const DeviceRegistration = model('DeviceRegistration', deviceRegistrationSchema);
