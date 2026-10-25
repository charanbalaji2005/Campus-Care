import { Schema, model } from 'mongoose';
import {
  DATA_REQUEST_STATUSES, DATA_REQUEST_TYPES, HAZARD_CATEGORIES, HAZARD_STATUSES, LOST_FOUND_CATEGORIES, LOST_FOUND_STATUSES,
  PLACE_KINDS, SUGGESTION_CATEGORIES, SUGGESTION_STATUSES,
} from '@campuscare/shared';

/** Campus hazard reports (lighting, unsafe areas…). Reporter identity is never shown on the map. */
const hazardSchema = new Schema(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    /** HMAC tag for anonymous reports, so the reporter can still see their own report. */
    reporterTag: { type: String, default: null, select: false },
    category: { type: String, enum: HAZARD_CATEGORIES, required: true },
    description: { type: String, required: true, maxlength: 1000 },
    locationLabel: { type: String, required: true, maxlength: 200 },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    status: { type: String, enum: HAZARD_STATUSES, default: 'open' },
    publicNote: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
hazardSchema.index({ status: 1, createdAt: -1 });
hazardSchema.index({ reporterId: 1, createdAt: -1 });
export const HazardReport = model('HazardReport', hazardSchema);

/** Verified campus facilities shown on the safety map (security posts, medical centre, safe zones…). */
const placeSchema = new Schema(
  {
    name: { type: String, required: true },
    kind: { type: String, enum: PLACE_KINDS, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    description: { type: String, default: '' },
    phone: { type: String, default: null },
    hours: { type: String, default: null },
    verified: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);
export const CampusPlace = model('CampusPlace', placeSchema);

const lostFoundSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['lost', 'found'], required: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, required: true, maxlength: 1000 },
    category: { type: String, enum: LOST_FOUND_CATEGORIES, required: true },
    location: { type: String, required: true, maxlength: 200 },
    occurredAt: { type: Date, required: true },
    photoIds: [{ type: Schema.Types.ObjectId, ref: 'Evidence' }],
    status: { type: String, enum: LOST_FOUND_STATUSES, default: 'open' },
    removedReason: { type: String, default: null },
    /** Auto-closes after 60 days. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
lostFoundSchema.index({ status: 1, type: 1, createdAt: -1 });
lostFoundSchema.index({ ownerId: 1, createdAt: -1 });
export const LostFoundItem = model('LostFoundItem', lostFoundSchema);

/** A claim is private between the claimant and the poster; contact details are shared only after approval. */
const lostFoundClaimSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'LostFoundItem', required: true },
    claimantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true, maxlength: 500 },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'withdrawn'], default: 'pending' },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
lostFoundClaimSchema.index({ itemId: 1, claimantId: 1 }, { unique: true });
export const LostFoundClaim = model('LostFoundClaim', lostFoundClaimSchema);

/** Anonymous safety suggestions — informal ideas, not formal grievances. */
const suggestionSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorTag: { type: String, default: null, select: false },
    category: { type: String, enum: SUGGESTION_CATEGORIES, required: true },
    text: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: SUGGESTION_STATUSES, default: 'new' },
    response: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    upvotes: { type: Number, default: 0 },
  },
  { timestamps: true },
);
suggestionSchema.index({ status: 1, createdAt: -1 });
export const SafetySuggestion = model('SafetySuggestion', suggestionSchema);

/** Student data export / deletion requests, handled by the Super Admin (data governance). */
const dataRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: DATA_REQUEST_TYPES, required: true },
    reason: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: DATA_REQUEST_STATUSES, default: 'pending' },
    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { timestamps: true },
);
dataRequestSchema.index({ status: 1, createdAt: -1 });
dataRequestSchema.index({ userId: 1, type: 1, status: 1 });
export const DataRequest = model('DataRequest', dataRequestSchema);
