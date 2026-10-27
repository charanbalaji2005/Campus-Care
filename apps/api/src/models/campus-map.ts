import { Schema, model, type Document, type Types } from 'mongoose';
import {
  BUILDING_CATEGORIES,
  PATHWAY_TYPES,
  PATHWAY_STATUSES,
  MAP_REPORT_TYPES,
  type BuildingCategory,
  type PathwayType,
  type PathwayStatus,
  type MapReportType,
} from '@campuscare/shared';

// ------------------------------------------------------------------ Building Entrance Sub-schema
export interface CampusEntrance {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  isAccessible: boolean;
  isMain: boolean;
  isExitOnly: boolean;
  status: 'open' | 'closed' | 'maintenance';
}

const entranceSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    isAccessible: { type: Boolean, default: false },
    isMain: { type: Boolean, default: false },
    isExitOnly: { type: Boolean, default: false },
    status: { type: String, enum: ['open', 'closed', 'maintenance'], default: 'open' },
  },
  { _id: false },
);

// ------------------------------------------------------------------ Campus Building Model
export interface CampusBuildingDoc extends Document {
  name: string;
  code: string;
  category: BuildingCategory;
  campus: string;
  latitude: number;
  longitude: number;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  boundary?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  entrances: CampusEntrance[];
  operatingHours?: string | null;
  contactPhone?: string | null;
  description: string;
  photos: string[];
  status: 'active' | 'temporarily_closed' | 'inactive';
  verified: boolean;
  isEmergencyLocation: boolean;
  accessibilityNotes?: string | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const buildingSchema = new Schema<CampusBuildingDoc>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    category: { type: String, enum: BUILDING_CATEGORIES, required: true },
    campus: { type: String, default: 'main', index: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], required: true }, // [lng, lat]
    },
    boundary: {
      type: { type: String, enum: ['Polygon'] },
      coordinates: { type: [[[Number]]] },
    },
    entrances: { type: [entranceSchema], default: [] },
    operatingHours: { type: String, default: null },
    contactPhone: { type: String, default: null },
    description: { type: String, default: '' },
    photos: [{ type: String }],
    status: { type: String, enum: ['active', 'temporarily_closed', 'inactive'], default: 'active' },
    verified: { type: Boolean, default: true },
    isEmergencyLocation: { type: Boolean, default: false },
    accessibilityNotes: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

buildingSchema.index({ location: '2dsphere' });
buildingSchema.index({ campus: 1, category: 1, status: 1 });
buildingSchema.index({ name: 'text', code: 'text', description: 'text' });

export const CampusBuilding = model<CampusBuildingDoc>('CampusBuilding', buildingSchema);

// ------------------------------------------------------------------ Pathway Segment Model
export interface CampusNode {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
}

const campusNodeSchema = new Schema(
  {
    id: { type: String, required: true },
    label: { type: String, default: '' },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false },
);

export interface CampusPathwaySegmentDoc extends Document {
  name: string;
  campus: string;
  startNode: CampusNode;
  endNode: CampusNode;
  coordinates: [number, number][]; // Array of [lng, lat]
  geometry: {
    type: 'LineString';
    coordinates: [number, number][]; // [lng, lat]
  };
  waypoints: Array<{ latitude: number; longitude: number }>;
  pathType: PathwayType;
  isOneWay: boolean;
  distanceMeters: number;
  surfaceType: 'paved' | 'gravel' | 'indoor' | 'stairs' | 'ramp' | 'grass';
  hasLighting: boolean;
  status: PathwayStatus;
  temporaryClosure?: {
    startDate: Date;
    endDate: Date;
    reason: string;
    alternativeNotes?: string | null;
  } | null;
  active: boolean;
  publishedVersion: number;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const pathwaySegmentSchema = new Schema<CampusPathwaySegmentDoc>(
  {
    name: { type: String, required: true, trim: true },
    campus: { type: String, default: 'main', index: true },
    startNode: { type: campusNodeSchema, required: true },
    endNode: { type: campusNodeSchema, required: true },
    coordinates: { type: [[Number]], required: true }, // [[lng, lat], ...]
    geometry: {
      type: { type: String, enum: ['LineString'], default: 'LineString' },
      coordinates: { type: [[Number]], required: true },
    },
    waypoints: [
      {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
      },
    ],
    pathType: { type: String, enum: PATHWAY_TYPES, default: 'pedestrian' },
    isOneWay: { type: Boolean, default: false },
    distanceMeters: { type: Number, required: true, min: 0 },
    surfaceType: {
      type: String,
      enum: ['paved', 'gravel', 'indoor', 'stairs', 'ramp', 'grass'],
      default: 'paved',
    },
    hasLighting: { type: Boolean, default: true },
    status: { type: String, enum: PATHWAY_STATUSES, default: 'open' },
    temporaryClosure: {
      startDate: { type: Date },
      endDate: { type: Date },
      reason: { type: String },
      alternativeNotes: { type: String, default: null },
    },
    active: { type: Boolean, default: true },
    publishedVersion: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

pathwaySegmentSchema.index({ geometry: '2dsphere' });
pathwaySegmentSchema.index({ campus: 1, status: 1, active: 1 });
pathwaySegmentSchema.index({ 'startNode.id': 1, 'endNode.id': 1 });

export const CampusPathwaySegment = model<CampusPathwaySegmentDoc>(
  'CampusPathwaySegment',
  pathwaySegmentSchema,
);

// ------------------------------------------------------------------ Campus Route (Named Corridors)
export interface CampusRouteRevision {
  version: number;
  updatedBy: Types.ObjectId;
  updatedAt: Date;
  changeNotes: string;
  snapshot: Record<string, unknown>;
}

const revisionSchema = new Schema(
  {
    version: { type: Number, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedAt: { type: Date, default: Date.now },
    changeNotes: { type: String, default: '' },
    snapshot: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

export interface CampusRouteDoc extends Document {
  name: string;
  campus: string;
  originPlaceId?: Types.ObjectId | null;
  originLabel: string;
  destinationPlaceId?: Types.ObjectId | null;
  destinationLabel: string;
  pathwaySegmentIds: Types.ObjectId[];
  waypoints: Array<{ latitude: number; longitude: number }>;
  distanceMeters: number;
  estimatedDurationSeconds: number;
  routeType: PathwayType;
  status: 'published' | 'draft' | 'restricted' | 'archived';
  isEmergencyCorridor: boolean;
  notes?: string | null;
  revisions: CampusRouteRevision[];
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const campusRouteSchema = new Schema<CampusRouteDoc>(
  {
    name: { type: String, required: true, trim: true },
    campus: { type: String, default: 'main', index: true },
    originPlaceId: { type: Schema.Types.ObjectId, ref: 'CampusBuilding', default: null },
    originLabel: { type: String, required: true },
    destinationPlaceId: { type: Schema.Types.ObjectId, ref: 'CampusBuilding', default: null },
    destinationLabel: { type: String, required: true },
    pathwaySegmentIds: [{ type: Schema.Types.ObjectId, ref: 'CampusPathwaySegment' }],
    waypoints: [
      {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
      },
    ],
    distanceMeters: { type: Number, required: true, default: 0 },
    estimatedDurationSeconds: { type: Number, required: true, default: 0 },
    routeType: { type: String, enum: PATHWAY_TYPES, default: 'pedestrian' },
    status: { type: String, enum: ['published', 'draft', 'restricted', 'archived'], default: 'published' },
    isEmergencyCorridor: { type: Boolean, default: false },
    notes: { type: String, default: null },
    revisions: { type: [revisionSchema], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

campusRouteSchema.index({ campus: 1, status: 1 });

export const CampusRoute = model<CampusRouteDoc>('CampusRoute', campusRouteSchema);

// ------------------------------------------------------------------ Student Map Report
export interface CampusMapReportDoc extends Document {
  reporterId: Types.ObjectId;
  reportType: MapReportType;
  locationLabel: string;
  latitude?: number | null;
  longitude?: number | null;
  targetEntityId?: Types.ObjectId | null;
  targetEntityType: 'building' | 'entrance' | 'pathway' | 'general';
  description: string;
  status: 'pending' | 'in_review' | 'resolved' | 'dismissed';
  resolutionNote?: string | null;
  reviewedBy?: Types.ObjectId | null;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mapReportSchema = new Schema<CampusMapReportDoc>(
  {
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportType: { type: String, enum: MAP_REPORT_TYPES, required: true },
    locationLabel: { type: String, required: true, trim: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    targetEntityId: { type: Schema.Types.ObjectId, default: null },
    targetEntityType: {
      type: String,
      enum: ['building', 'entrance', 'pathway', 'general'],
      default: 'general',
    },
    description: { type: String, required: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['pending', 'in_review', 'resolved', 'dismissed'],
      default: 'pending',
      index: true,
    },
    resolutionNote: { type: String, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mapReportSchema.index({ status: 1, createdAt: -1 });

export const CampusMapReport = model<CampusMapReportDoc>('CampusMapReport', mapReportSchema);
