import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const checkpointSchema = new Schema({
  name: { type: String, required: true },
  requiredTime: { type: String, default: null },
  status: { type: String, enum: ['pending', 'completed'], default: 'pending' },
  completedAt: { type: Date, default: null },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  locationLabel: { type: String, default: 'Campus Grounds' },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
});

const patrolRouteSchema = new Schema(
  {
    name: { type: String, required: true },
    campus: { type: String, default: 'main' },
    shiftTime: { type: String, default: '09:00 AM - 05:00 PM' },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
    assignedOfficerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assignedOfficerName: { type: String, default: 'Duty Officer' },
    checkpoints: [checkpointSchema],
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

patrolRouteSchema.index({ campus: 1, status: 1 });
patrolRouteSchema.index({ assignedOfficerId: 1, status: 1 });

export const PatrolRoute = model('PatrolRoute', patrolRouteSchema);
export type PatrolRouteDoc = HydratedDocument<InferSchemaType<typeof patrolRouteSchema>>;

