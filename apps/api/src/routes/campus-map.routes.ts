import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Types } from 'mongoose';
import {
  hasPermission,
  BUILDING_CATEGORIES,
  PATHWAY_TYPES,
  PATHWAY_STATUSES,
  MAP_REPORT_TYPES,
  ROUTE_TRAVEL_MODES,
  type Role,
} from '@campuscare/shared';
import { asyncHandler, ok, badRequest, notFound, forbidden } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import {
  CampusBuilding,
  CampusPathwaySegment,
  CampusRoute,
  CampusMapReport,
} from '../models/campus-map';
import { CampusRoutingEngine } from '../services/campus-routing.service';
import { audit } from '../services/audit.service';
import { notify, notifyMany } from '../services/notification.service';
import { User } from '../models/user';
import { getSettings } from '../services/settings.service';

export const campusMapRouter = Router();

// Validation Schemas
const coordSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const calculateRouteInputSchema = z.object({
  origin: coordSchema,
  destination: coordSchema.partial().extend({
    buildingId: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }),
  mode: z.enum(ROUTE_TRAVEL_MODES).default('walking'),
  campus: z.string().default('main'),
});

const mapReportInputSchema = z.object({
  reportType: z.enum(MAP_REPORT_TYPES),
  locationLabel: z.string().min(2).max(120),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  targetEntityId: z.string().optional(),
  targetEntityType: z.enum(['building', 'entrance', 'pathway', 'general']).default('general'),
  description: z.string().min(5).max(1000),
});

const entranceInputSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isAccessible: z.boolean().default(false),
  isMain: z.boolean().default(false),
  isExitOnly: z.boolean().default(false),
  status: z.enum(['open', 'closed', 'maintenance']).default('open'),
});

const buildingInputSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(1).max(20),
  category: z.enum(BUILDING_CATEGORIES),
  campus: z.string().default('main'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  entrances: z.array(entranceInputSchema).default([]),
  operatingHours: z.string().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  description: z.string().default(''),
  photos: z.array(z.string()).default([]),
  status: z.enum(['active', 'temporarily_closed', 'inactive']).default('active'),
  verified: z.boolean().default(true),
  isEmergencyLocation: z.boolean().default(false),
  accessibilityNotes: z.string().nullable().optional(),
});

const pathwayInputSchema = z.object({
  name: z.string().min(2).max(120),
  campus: z.string().default('main'),
  startNode: z.object({
    id: z.string(),
    label: z.string().default(''),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  endNode: z.object({
    id: z.string(),
    label: z.string().default(''),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2), // [[lng, lat], ...]
  waypoints: z.array(coordSchema).default([]),
  pathType: z.enum(PATHWAY_TYPES).default('pedestrian'),
  isOneWay: z.boolean().default(false),
  distanceMeters: z.number().min(1),
  surfaceType: z.enum(['paved', 'gravel', 'indoor', 'stairs', 'ramp', 'grass']).default('paved'),
  hasLighting: z.boolean().default(true),
  status: z.enum(PATHWAY_STATUSES).default('open'),
  temporaryClosure: z
    .object({
      startDate: z.string().or(z.date()),
      endDate: z.string().or(z.date()),
      reason: z.string(),
      alternativeNotes: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  active: z.boolean().default(true),
});

function requireMapAdmin(req: Request) {
  const user = req.user;
  if (!user) throw forbidden();
  const sub = { role: user.role as Role, permissions: user.permissions || [] };
  const canManage =
    user.role === 'super_admin' ||
    user.role === 'admin' ||
    hasPermission(sub, 'safety_intel:manage');
  if (!canManage) {
    throw forbidden('Insufficient permissions to manage campus map and routes.');
  }
}

// ==================================================================
// STUDENT & PUBLIC ENDPOINTS (AUTHENTICATED)
// ==================================================================

/**
 * Full campus map overview: buildings, emergency points, active pathways, and center coordinates.
 */
campusMapRouter.get(
  '/data',
  requireAuth,
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    const campus = (req.query.campus as string) || 'main';

    const [buildings, pathways, activeReportsCount] = await Promise.all([
      CampusBuilding.find({ campus, status: { $ne: 'inactive' }, verified: true })
        .sort({ name: 1 })
        .lean(),
      CampusPathwaySegment.find({ campus, active: true, status: { $ne: 'closed' } })
        .lean(),
      CampusMapReport.countDocuments({ status: 'pending' }),
    ]);

    const emergencyLocations = buildings.filter(
      (b) =>
        b.isEmergencyLocation ||
        b.category === 'security_office' ||
        b.category === 'medical' ||
        b.category === 'assembly_point' ||
        b.category === 'gate',
    );

    ok(res, {
      center: {
        latitude: s.map.centerLatitude,
        longitude: s.map.centerLongitude,
        zoom: s.map.zoom,
      },
      campus,
      buildings: buildings.map((b) => ({
        id: String(b._id),
        name: b.name,
        code: b.code,
        category: b.category,
        latitude: b.latitude,
        longitude: b.longitude,
        entrances: b.entrances || [],
        operatingHours: b.operatingHours,
        contactPhone: b.contactPhone,
        description: b.description,
        photos: b.photos || [],
        status: b.status,
        isEmergencyLocation: b.isEmergencyLocation,
        accessibilityNotes: b.accessibilityNotes,
      })),
      emergencyLocations: emergencyLocations.map((b) => ({
        id: String(b._id),
        name: b.name,
        code: b.code,
        category: b.category,
        latitude: b.latitude,
        longitude: b.longitude,
        contactPhone: b.contactPhone,
      })),
      pathways: pathways.map((p) => ({
        id: String(p._id),
        name: p.name,
        coordinates: p.coordinates,
        pathType: p.pathType,
        isOneWay: p.isOneWay,
        distanceMeters: p.distanceMeters,
        surfaceType: p.surfaceType,
        hasLighting: p.hasLighting,
        status: p.status,
        temporaryClosure: p.temporaryClosure,
      })),
      stats: {
        totalBuildings: buildings.length,
        totalPathways: pathways.length,
        activeReportsCount,
      },
    });
  }),
);

/**
 * Search buildings and facilities directory.
 */
campusMapRouter.get(
  '/buildings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = ((req.query.q as string) || '').trim();
    const category = req.query.category as string;
    const campus = (req.query.campus as string) || 'main';

    const filter: Record<string, unknown> = {
      campus,
      status: { $ne: 'inactive' },
      verified: true,
    };

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { code: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
      ];
    }

    const items = await CampusBuilding.find(filter).sort({ name: 1 }).limit(100).lean();

    ok(res, {
      items: items.map((b) => ({
        id: String(b._id),
        name: b.name,
        code: b.code,
        category: b.category,
        latitude: b.latitude,
        longitude: b.longitude,
        entrances: b.entrances || [],
        operatingHours: b.operatingHours,
        contactPhone: b.contactPhone,
        description: b.description,
        status: b.status,
        isEmergencyLocation: b.isEmergencyLocation,
        accessibilityNotes: b.accessibilityNotes,
      })),
      count: items.length,
    });
  }),
);

/**
 * Building details with entrances.
 */
campusMapRouter.get(
  '/buildings/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const b = await CampusBuilding.findById(id).lean();
    if (!b) throw notFound('Building not found');

    ok(res, {
      id: String(b._id),
      name: b.name,
      code: b.code,
      category: b.category,
      campus: b.campus,
      latitude: b.latitude,
      longitude: b.longitude,
      entrances: b.entrances || [],
      operatingHours: b.operatingHours,
      contactPhone: b.contactPhone,
      description: b.description,
      photos: b.photos || [],
      status: b.status,
      verified: b.verified,
      isEmergencyLocation: b.isEmergencyLocation,
      accessibilityNotes: b.accessibilityNotes,
    });
  }),
);

/**
 * Calculate walking or accessible route using the campus pathway graph.
 */
campusMapRouter.post(
  '/route',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = calculateRouteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid route calculation parameters: ' + parsed.error.message);
    }

    const { origin, destination, mode, campus } = parsed.data;

    let destLat = destination.latitude;
    let destLng = destination.longitude;

    if (destination.buildingId && (!destLat || !destLng)) {
      const b = await CampusBuilding.findById(destination.buildingId).lean();
      if (!b) throw notFound('Destination building not found');
      destLat = b.latitude;
      destLng = b.longitude;
    }

    if (destLat == null || destLng == null) {
      throw badRequest('Must provide either destination coordinates or a valid buildingId.');
    }

    const route = await CampusRoutingEngine.calculateRoute({
      campus,
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destLat, longitude: destLng },
      destinationBuildingId: destination.buildingId,
      mode,
    });

    ok(res, route);
  }),
);

/**
 * Quick access to campus emergency locations (security posts, medical, assembly points).
 */
campusMapRouter.get(
  '/emergency-locations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campus = (req.query.campus as string) || 'main';
    const emergencyBuildings = await CampusBuilding.find({
      campus,
      status: 'active',
      $or: [
        { isEmergencyLocation: true },
        { category: { $in: ['security_office', 'medical', 'assembly_point', 'gate'] } },
      ],
    })
      .sort({ category: 1, name: 1 })
      .lean();

    ok(res, {
      items: emergencyBuildings.map((b) => ({
        id: String(b._id),
        name: b.name,
        code: b.code,
        category: b.category,
        latitude: b.latitude,
        longitude: b.longitude,
        contactPhone: b.contactPhone,
        description: b.description,
        entrances: b.entrances || [],
      })),
    });
  }),
);

/**
 * Student reports a map issue (closed pathway, blocked entrance, incorrect location).
 */
campusMapRouter.post(
  '/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = mapReportInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid map report input: ' + parsed.error.message);
    }

    const report = await CampusMapReport.create({
      reporterId: req.user!._id,
      reportType: parsed.data.reportType,
      locationLabel: parsed.data.locationLabel,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      targetEntityId: parsed.data.targetEntityId ? new Types.ObjectId(parsed.data.targetEntityId) : null,
      targetEntityType: parsed.data.targetEntityType,
      description: parsed.data.description,
      status: 'pending',
    });

    // Notify staff responsible for campus safety & facilities
    const staff = await User.find(
      {
        accountStatus: 'active',
        $or: [
          { role: { $in: ['admin', 'super_admin', 'security_officer'] } },
          { permissions: 'safety_intel:manage' },
        ],
      },
      { _id: 1 },
    ).lean();

    await notifyMany(staff.map((s) => String(s._id)), {
      kind: 'map_report',
      title: 'New Campus Map Report',
      body: `Map report (${parsed.data.reportType.replace('_', ' ')}) submitted at ${parsed.data.locationLabel}`,
      link: '/super-admin/campus-map',
      priority: 'normal',
    });

    await audit({
      action: 'map_report.submitted',
      actorId: String(req.user!._id),
      targetType: 'map_report',
      targetId: String(report._id),
      meta: { reportType: parsed.data.reportType, locationLabel: parsed.data.locationLabel },
    });

    ok(
      res,
      {
        id: String(report._id),
        status: report.status,
        message: 'Thank you for your report. Campus administration will review it promptly.',
      },
      201,
    );
  }),
);

/**
 * Student views their submitted map reports.
 */
campusMapRouter.get(
  '/reports/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reports = await CampusMapReport.find({ reporterId: req.user!._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    ok(res, {
      items: reports.map((r) => ({
        id: String(r._id),
        reportType: r.reportType,
        locationLabel: r.locationLabel,
        description: r.description,
        status: r.status,
        resolutionNote: r.resolutionNote,
        createdAt: r.createdAt,
      })),
    });
  }),
);

// ==================================================================
// SUPER ADMIN & CAMPUS ADMIN MANAGEMENT ENDPOINTS
// ==================================================================

/**
 * Admin: List all buildings with full administration details.
 */
campusMapRouter.get(
  '/admin/buildings',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const campus = (req.query.campus as string) || 'main';

    const buildings = await CampusBuilding.find({ campus })
      .sort({ name: 1 })
      .lean();

    ok(res, {
      items: buildings.map((b) => ({
        id: String(b._id),
        name: b.name,
        code: b.code,
        category: b.category,
        campus: b.campus,
        latitude: b.latitude,
        longitude: b.longitude,
        entrances: b.entrances || [],
        operatingHours: b.operatingHours,
        contactPhone: b.contactPhone,
        description: b.description,
        photos: b.photos || [],
        status: b.status,
        verified: b.verified,
        isEmergencyLocation: b.isEmergencyLocation,
        accessibilityNotes: b.accessibilityNotes,
        updatedAt: b.updatedAt,
      })),
      count: buildings.length,
    });
  }),
);

/**
 * Admin: Create building or campus facility.
 */
campusMapRouter.post(
  '/admin/buildings',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const parsed = buildingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid building input: ' + parsed.error.message);
    }

    const b = await CampusBuilding.create({
      ...parsed.data,
      location: {
        type: 'Point',
        coordinates: [parsed.data.longitude, parsed.data.latitude],
      },
      updatedBy: req.user!._id,
    });

    await audit({
      action: 'campus_building.created',
      actorId: String(req.user!._id),
      targetType: 'campus_building',
      targetId: String(b._id),
      meta: { name: b.name, code: b.code, category: b.category },
    });

    ok(
      res,
      {
        id: String(b._id),
        name: b.name,
        message: 'Building created successfully.',
      },
      201,
    );
  }),
);

/**
 * Admin: Update building, entrances, or coordinates.
 */
campusMapRouter.put(
  '/admin/buildings/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const parsed = buildingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid building input: ' + parsed.error.message);
    }

    const old = await CampusBuilding.findById(id).lean();
    if (!old) throw notFound('Building not found');

    const updated = await CampusBuilding.findByIdAndUpdate(
      id,
      {
        $set: {
          ...parsed.data,
          location: {
            type: 'Point',
            coordinates: [parsed.data.longitude, parsed.data.latitude],
          },
          updatedBy: req.user!._id,
        },
      },
      { new: true },
    ).lean();

    await audit({
      action: 'campus_building.updated',
      actorId: String(req.user!._id),
      targetType: 'campus_building',
      targetId: id,
      before: { name: old.name, status: old.status, entrancesCount: old.entrances?.length },
      after: { name: updated?.name, status: updated?.status, entrancesCount: updated?.entrances?.length },
    });

    ok(res, {
      id,
      message: 'Building updated successfully.',
      building: updated,
    });
  }),
);

/**
 * Admin: Delete or archive building.
 */
campusMapRouter.delete(
  '/admin/buildings/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const building = await CampusBuilding.findByIdAndUpdate(
      id,
      { $set: { status: 'inactive', updatedBy: req.user!._id } },
      { new: true },
    );
    if (!building) throw notFound('Building not found');

    await audit({
      action: 'campus_building.archived',
      actorId: String(req.user!._id),
      targetType: 'campus_building',
      targetId: id,
    });

    ok(res, { message: 'Building archived successfully.' });
  }),
);

/**
 * Admin: List pathway segments.
 */
campusMapRouter.get(
  '/admin/pathways',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const campus = (req.query.campus as string) || 'main';

    const pathways = await CampusPathwaySegment.find({ campus })
      .sort({ createdAt: -1 })
      .lean();

    ok(res, {
      items: pathways.map((p) => ({
        id: String(p._id),
        name: p.name,
        campus: p.campus,
        startNode: p.startNode,
        endNode: p.endNode,
        coordinates: p.coordinates,
        pathType: p.pathType,
        isOneWay: p.isOneWay,
        distanceMeters: p.distanceMeters,
        surfaceType: p.surfaceType,
        hasLighting: p.hasLighting,
        status: p.status,
        temporaryClosure: p.temporaryClosure,
        active: p.active,
        publishedVersion: p.publishedVersion,
        updatedAt: p.updatedAt,
      })),
      count: pathways.length,
    });
  }),
);

/**
 * Admin: Create pathway segment.
 */
campusMapRouter.post(
  '/admin/pathways',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const parsed = pathwayInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid pathway input: ' + parsed.error.message);
    }

    const seg = await CampusPathwaySegment.create({
      ...parsed.data,
      geometry: {
        type: 'LineString',
        coordinates: parsed.data.coordinates,
      },
      updatedBy: req.user!._id,
    });

    await audit({
      action: 'pathway_segment.created',
      actorId: String(req.user!._id),
      targetType: 'pathway_segment',
      targetId: String(seg._id),
      meta: { name: seg.name, pathType: seg.pathType, distanceMeters: seg.distanceMeters },
    });

    ok(
      res,
      {
        id: String(seg._id),
        message: 'Pathway segment created successfully.',
      },
      201,
    );
  }),
);

/**
 * Admin: Update pathway segment.
 */
campusMapRouter.put(
  '/admin/pathways/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const parsed = pathwayInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid pathway input: ' + parsed.error.message);
    }

    const old = await CampusPathwaySegment.findById(id).lean();
    if (!old) throw notFound('Pathway segment not found');

    const updated = await CampusPathwaySegment.findByIdAndUpdate(
      id,
      {
        $set: {
          ...parsed.data,
          geometry: {
            type: 'LineString',
            coordinates: parsed.data.coordinates,
          },
          $inc: { publishedVersion: 1 },
          updatedBy: req.user!._id,
        },
      },
      { new: true },
    ).lean();

    await audit({
      action: 'pathway_segment.updated',
      actorId: String(req.user!._id),
      targetType: 'pathway_segment',
      targetId: id,
      before: { status: old.status, distanceMeters: old.distanceMeters },
      after: { status: updated?.status, distanceMeters: updated?.distanceMeters },
    });

    ok(res, {
      id,
      message: 'Pathway segment updated successfully.',
      pathway: updated,
    });
  }),
);

/**
 * Admin: Apply temporary closure to a pathway and optionally broadcast closure notification.
 */
campusMapRouter.post(
  '/admin/pathways/:id/closure',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const bodySchema = z.object({
      status: z.enum(['closed', 'maintenance', 'open']),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      reason: z.string().min(3).max(300),
      alternativeNotes: z.string().optional(),
      broadcastNotice: z.boolean().default(false),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid closure payload: ' + parsed.error.message);
    }

    const { status, startDate, endDate, reason, alternativeNotes, broadcastNotice } = parsed.data;

    const seg = await CampusPathwaySegment.findById(id);
    if (!seg) throw notFound('Pathway not found');

    seg.status = status;
    if (status === 'open') {
      seg.temporaryClosure = null;
    } else {
      seg.temporaryClosure = {
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 7 * 86400_000),
        reason,
        alternativeNotes: alternativeNotes || null,
      };
    }
    seg.updatedBy = req.user!._id;
    await seg.save();

    await audit({
      action: status === 'open' ? 'pathway.reopened' : 'pathway.closed',
      actorId: String(req.user!._id),
      targetType: 'pathway_segment',
      targetId: id,
      meta: { reason, status, broadcastNotice },
    });

    // If requested, broadcast notification to campus students & staff
    if (broadcastNotice && status !== 'open') {
      const users = await User.find({ accountStatus: 'active' }, { _id: 1 }).lean();
      await notifyMany(users.map((u) => String(u._id)), {
        kind: 'route_closure',
        title: `Campus Pathway Notice: ${seg.name}`,
        body: `Pathway temporary closure: ${reason}.${alternativeNotes ? ` Alternate: ${alternativeNotes}` : ''}`,
        link: '/s/map',
        priority: 'high',
        category: 'announcements',
      });
    }

    ok(res, {
      id,
      status: seg.status,
      message: `Pathway ${status === 'open' ? 'reopened' : 'closure scheduled'} successfully.`,
    });
  }),
);

/**
 * Admin: List and filter student map reports.
 */
campusMapRouter.get(
  '/admin/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const status = req.query.status as string;
    const filter: Record<string, unknown> = {};
    if (status && status !== 'all') {
      filter.status = status;
    }

    const reports = await CampusMapReport.find(filter)
      .populate('reporterId', 'name email role')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    ok(res, {
      items: reports.map((r) => ({
        id: String(r._id),
        reporter: r.reporterId,
        reportType: r.reportType,
        locationLabel: r.locationLabel,
        latitude: r.latitude,
        longitude: r.longitude,
        targetEntityType: r.targetEntityType,
        description: r.description,
        status: r.status,
        resolutionNote: r.resolutionNote,
        createdAt: r.createdAt,
      })),
      count: reports.length,
    });
  }),
);

/**
 * Admin: Resolve, update or dismiss student map report.
 */
campusMapRouter.patch(
  '/admin/reports/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) throw notFound();

    const bodySchema = z.object({
      status: z.enum(['in_review', 'resolved', 'dismissed']),
      resolutionNote: z.string().max(500).optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid resolution payload');
    }

    const report = await CampusMapReport.findByIdAndUpdate(
      id,
      {
        $set: {
          status: parsed.data.status,
          resolutionNote: parsed.data.resolutionNote || null,
          reviewedBy: req.user!._id,
          reviewedAt: new Date(),
        },
      },
      { new: true },
    );

    if (!report) throw notFound('Report not found');

    // Notify student who submitted the report
    await notify({
      userId: String(report.reporterId),
      kind: 'map_report_update',
      title: 'Update on Your Campus Map Report',
      body: `Your report regarding "${report.locationLabel}" was marked ${parsed.data.status}.${parsed.data.resolutionNote ? ` Note: ${parsed.data.resolutionNote}` : ''}`,
      link: '/s/map',
      priority: 'normal',
    });

    await audit({
      action: 'map_report.reviewed',
      actorId: String(req.user!._id),
      targetType: 'map_report',
      targetId: id,
      meta: { status: parsed.data.status, note: parsed.data.resolutionNote },
    });

    ok(res, {
      id,
      status: report.status,
      message: 'Report status updated successfully.',
    });
  }),
);

/**
 * Admin: Test / Preview route calculation in the admin console.
 */
campusMapRouter.post(
  '/admin/preview-route',
  requireAuth,
  asyncHandler(async (req, res) => {
    requireMapAdmin(req);
    const parsed = calculateRouteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('Invalid preview route parameters');
    }

    const { origin, destination, mode, campus } = parsed.data;
    let destLat = destination.latitude;
    let destLng = destination.longitude;

    if (destination.buildingId && (!destLat || !destLng)) {
      const b = await CampusBuilding.findById(destination.buildingId).lean();
      if (b) {
        destLat = b.latitude;
        destLng = b.longitude;
      }
    }

    if (destLat == null || destLng == null) {
      throw badRequest('Destination coordinates or valid buildingId required');
    }

    const route = await CampusRoutingEngine.calculateRoute({
      campus,
      origin: { latitude: origin.latitude, longitude: origin.longitude },
      destination: { latitude: destLat, longitude: destLng },
      destinationBuildingId: destination.buildingId,
      mode,
    });

    ok(res, route);
  }),
);
