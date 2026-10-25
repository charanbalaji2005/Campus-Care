import { Router } from 'express';
import { Types } from 'mongoose';
import {
  hazardCreateSchema, hazardReviewSchema, hasPermission, lostFoundClaimDecisionSchema, lostFoundClaimSchema, lostFoundCreateSchema, placeSchema,
  suggestionCreateSchema, suggestionReviewSchema, type Role,
} from '@campuscare/shared';
import { z } from 'zod';
import { AppError, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { anonymousReporterTag } from '../lib/crypto';
import { CampusPlace, HazardReport, LostFoundClaim, LostFoundItem, SafetySuggestion } from '../models/community';
import { Evidence, Incident } from '../models/incident';
import { CampusAlert } from '../models/safety';
import { User } from '../models/user';
import { requireAuth, requirePermission } from '../middleware/auth';
import { upload } from '../middleware/security';
import { getSettings } from '../services/settings.service';
import { attachmentView, storeUpload, streamFile } from '../services/files.service';
import { notify, notifyMany } from '../services/notification.service';
import { audit } from '../services/audit.service';

/** Campus safety map, hazard reports, lost & found and anonymous safety suggestions. */
export const communityRouter = Router();
communityRouter.use(requireAuth);

const canManageCommunity = (u: Express.Request['user']) => hasPermission({ role: u!.role as Role, permissions: u!.permissions }, 'community_safety:manage');

// ------------------------------------------------------------------ safety map
/** Grid size for the heatmap (~165 m). Cells below the k-anonymity threshold are never returned. */
const CELL = 0.0015;

communityRouter.get(
  '/map',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    const now = new Date();
    const since = new Date(Date.now() - s.map.heatmapDays * 86400_000);
    const [places, hazards, alerts, heat] = await Promise.all([
      CampusPlace.find({ active: true, verified: true }).lean(),
      HazardReport.find({ status: { $in: ['verified', 'in_progress'] }, latitude: { $ne: null } }, { category: 1, locationLabel: 1, latitude: 1, longitude: 1, status: 1, publicNote: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(200).lean(),
      CampusAlert.find({ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }], createdAt: { $gt: new Date(Date.now() - 7 * 86400_000) } }, { title: 1, body: 1, severity: 1, createdAt: 1, requestCheckIn: 1 }).sort({ createdAt: -1 }).limit(20).lean(),
      // Privacy-preserving heatmap: counts per grid cell only, never individual cases, k-anonymous.
      Incident.aggregate([
        { $match: { createdAt: { $gte: since }, latitude: { $ne: null }, longitude: { $ne: null } } },
        { $project: { cy: { $floor: { $divide: ['$latitude', CELL] } }, cx: { $floor: { $divide: ['$longitude', CELL] } } } },
        { $group: { _id: { cy: '$cy', cx: '$cx' }, count: { $sum: 1 } } },
        { $match: { count: { $gte: s.map.heatmapMinCount } } },
      ]),
    ]);
    ok(res, {
      center: { latitude: s.map.centerLatitude, longitude: s.map.centerLongitude, zoom: s.map.zoom },
      places: places.map((p) => ({ id: String(p._id), name: p.name, kind: p.kind, latitude: p.latitude, longitude: p.longitude, description: p.description, phone: p.phone, hours: p.hours })),
      hazards: hazards.map((h) => ({ id: String(h._id), category: h.category, locationLabel: h.locationLabel, latitude: h.latitude, longitude: h.longitude, status: h.status, note: h.publicNote, reportedAt: h.createdAt })),
      alerts: alerts.map((a) => ({ id: String(a._id), title: a.title, body: a.body, severity: a.severity, createdAt: a.createdAt, requestCheckIn: a.requestCheckIn })),
      heatmap: {
        cellDegrees: CELL,
        minCount: s.map.heatmapMinCount,
        days: s.map.heatmapDays,
        cells: heat.map((c) => ({ latitude: (c._id.cy + 0.5) * CELL, longitude: (c._id.cx + 0.5) * CELL, count: c.count })),
      },
    });
  }),
);

// ------------------------------------------------------------------ hazard reports
communityRouter.post(
  '/hazards',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.community.hazardReportsEnabled) throw new AppError(403, 'disabled', 'Hazard reporting is turned off.');
    const input = parse(hazardCreateSchema, req.body);
    const recent = await HazardReport.countDocuments({ $or: [{ reporterId: req.user!._id }, { reporterTag: anonymousReporterTag(String(req.user!._id)) }], createdAt: { $gt: new Date(Date.now() - 3600_000) } });
    if (recent >= 5) throw new AppError(429, 'rate_limited', 'You have reported several hazards recently. Please wait before reporting more.');
    const h = await HazardReport.create({
      reporterId: input.anonymous ? null : req.user!._id,
      reporterTag: input.anonymous ? anonymousReporterTag(String(req.user!._id)) : null,
      category: input.category, description: input.description, locationLabel: input.locationLabel,
      latitude: input.latitude ?? null, longitude: input.longitude ?? null,
    });
    const reviewers = await User.find({ accountStatus: 'active', $or: [{ role: { $in: ['admin', 'moderator', 'security_officer'] } }, { permissions: 'community_safety:manage' }] }, { _id: 1 }).lean();
    await notifyMany(reviewers.map((r) => String(r._id)), { kind: 'hazard', title: 'New hazard report', body: `${input.category.replace('_', ' ')} at ${input.locationLabel}`, link: '/moderator/hazards' });
    await audit({ action: 'hazard.reported', actorId: input.anonymous ? null : String(req.user!._id), targetType: 'hazard', targetId: String(h._id) });
    ok(res, { id: String(h._id), status: h.status }, 201);
  }),
);

communityRouter.get(
  '/hazards/mine',
  asyncHandler(async (req, res) => {
    const list = await HazardReport.find({ $or: [{ reporterId: req.user!._id }, { reporterTag: anonymousReporterTag(String(req.user!._id)) }] }).sort({ createdAt: -1 }).limit(50).lean();
    ok(res, list.map((h) => ({ id: String(h._id), category: h.category, description: h.description, locationLabel: h.locationLabel, status: h.status, publicNote: h.publicNote, createdAt: h.createdAt })));
  }),
);

communityRouter.get(
  '/manage/hazards',
  requirePermission('community_safety:manage'),
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    const list = await HazardReport.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    // Reviewers see what was reported, never who reported it.
    ok(res, list.map((h) => ({ id: String(h._id), category: h.category, description: h.description, locationLabel: h.locationLabel, latitude: h.latitude, longitude: h.longitude, status: h.status, publicNote: h.publicNote, anonymous: !h.reporterId, createdAt: h.createdAt, reviewedAt: h.reviewedAt })));
  }),
);

communityRouter.patch(
  '/manage/hazards/:id',
  requirePermission('community_safety:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(hazardReviewSchema, req.body);
    const h = await HazardReport.findByIdAndUpdate(req.params.id, {
      $set: { status: input.status, publicNote: input.publicNote ?? null, reviewedBy: req.user!._id, reviewedAt: new Date(), ...(input.status === 'resolved' ? { resolvedAt: new Date() } : {}) },
    }, { new: true });
    if (!h) throw notFound();
    if (h.reporterId) await notify({ userId: String(h.reporterId), kind: 'hazard', category: 'announcements', title: 'Update on your hazard report', body: `Status: ${input.status.replace('_', ' ')}.`, link: '/student/hazards' });
    await audit({ action: 'hazard.reviewed', req, targetType: 'hazard', targetId: String(h._id), meta: { status: input.status } });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ campus places (safety intelligence)
communityRouter.get(
  '/manage/places',
  requirePermission('safety_intel:manage'),
  asyncHandler(async (_req, res) => {
    const list = await CampusPlace.find({}).sort({ kind: 1, name: 1 }).lean();
    ok(res, list.map((p) => ({ ...p, id: String(p._id) })));
  }),
);
communityRouter.post(
  '/manage/places',
  requirePermission('safety_intel:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(placeSchema, req.body);
    const p = await CampusPlace.create({ ...input, phone: input.phone || null, hours: input.hours || null, updatedBy: req.user!._id });
    await audit({ action: 'place.created', req, targetType: 'place', targetId: String(p._id) });
    ok(res, { id: String(p._id) }, 201);
  }),
);
communityRouter.patch(
  '/manage/places/:id',
  requirePermission('safety_intel:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(placeSchema.partial(), req.body);
    const p = await CampusPlace.findByIdAndUpdate(req.params.id, { $set: { ...input, updatedBy: req.user!._id } }, { new: true });
    if (!p) throw notFound();
    await audit({ action: 'place.updated', req, targetType: 'place', targetId: String(p._id), meta: { fields: Object.keys(input) } });
    ok(res, { ok: true });
  }),
);
communityRouter.delete(
  '/manage/places/:id',
  requirePermission('safety_intel:manage'),
  asyncHandler(async (req, res) => {
    await CampusPlace.deleteOne({ _id: req.params.id });
    await audit({ action: 'place.deleted', req, targetType: 'place', targetId: req.params.id });
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ lost & found
function itemView(i: Record<string, unknown> & { _id: unknown; ownerId: unknown; photoIds?: unknown[] }, viewerId: string) {
  return {
    id: String(i._id), type: i.type, title: i.title, description: i.description, category: i.category, location: i.location,
    occurredAt: i.occurredAt, status: i.status, createdAt: i.createdAt, mine: String(i.ownerId) === viewerId,
    photoIds: (i.photoIds ?? []).map(String),
  };
}

communityRouter.post(
  '/lost-found/photos',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const doc = await storeUpload(req.file, { purpose: 'lost_found', uploaderId: String(req.user!._id) });
    ok(res, attachmentView(doc), 201);
  }),
);

communityRouter.get(
  '/lost-found/photos/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    // Photos are visible to signed-in campus users only once attached to a listed item.
    const item = await LostFoundItem.exists({ photoIds: req.params.id, status: { $in: ['open', 'claimed'] } });
    const own = await Evidence.exists({ _id: req.params.id, purpose: 'lost_found', uploaderId: req.user!._id });
    if (!item && !own) throw notFound();
    await streamFile(res, req, req.params.id, 'inline');
  }),
);

communityRouter.get(
  '/lost-found',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.community.lostFoundEnabled) return ok(res, { items: [], total: 0, disabled: true });
    const { page, limit, skip } = pageParams(req.query, 50);
    const filter: Record<string, unknown> = { status: req.query.mine === 'true' ? { $ne: 'removed' } : { $in: ['open', 'claimed'] }, expiresAt: { $gt: new Date() } };
    if (req.query.mine === 'true') { filter.ownerId = req.user!._id; delete filter.expiresAt; }
    if (req.query.type === 'lost' || req.query.type === 'found') filter.type = req.query.type;
    if (req.query.category) filter.category = String(req.query.category);
    if (req.query.q) filter.title = { $regex: escapeRegex(String(req.query.q).slice(0, 60)), $options: 'i' };
    const [items, total] = await Promise.all([LostFoundItem.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), LostFoundItem.countDocuments(filter)]);
    ok(res, { items: items.map((i) => itemView(i as never, String(req.user!._id))), total, page, limit });
  }),
);

communityRouter.post(
  '/lost-found',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.community.lostFoundEnabled) throw new AppError(403, 'disabled', 'Lost & found is turned off.');
    const input = parse(lostFoundCreateSchema, req.body);
    const photos = input.photoIds.length ? await Evidence.find({ _id: { $in: input.photoIds }, purpose: 'lost_found', uploaderId: req.user!._id, bound: false }, { _id: 1 }).lean() : [];
    if (photos.length !== input.photoIds.length) throw new AppError(400, 'bad_photos', 'One or more photos are invalid.');
    const open = await LostFoundItem.countDocuments({ ownerId: req.user!._id, status: 'open' });
    if (open >= 10) throw new AppError(429, 'too_many', 'You have 10 open listings. Close some before adding more.');
    const item = await LostFoundItem.create({ ...input, ownerId: req.user!._id, photoIds: photos.map((p) => p._id), expiresAt: new Date(Date.now() + 60 * 86400_000) });
    if (photos.length) await Evidence.updateMany({ _id: { $in: photos.map((p) => p._id) } }, { $set: { bound: true } });
    ok(res, itemView(item.toObject() as never, String(req.user!._id)), 201);
  }),
);

communityRouter.get(
  '/lost-found/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const item = await LostFoundItem.findById(req.params.id).lean();
    if (!item || item.status === 'removed') throw notFound();
    const mine = String(item.ownerId) === String(req.user!._id);
    const claims = mine ? await LostFoundClaim.find({ itemId: item._id }).sort({ createdAt: -1 }).lean() : await LostFoundClaim.find({ itemId: item._id, claimantId: req.user!._id }).lean();
    const people = await User.find({ _id: { $in: [...claims.map((c) => c.claimantId), item.ownerId] } }, { fullName: 1, email: 1, phone: 1 }).lean();
    const pmap = new Map(people.map((p) => [String(p._id), p]));
    const owner = pmap.get(String(item.ownerId));
    ok(res, {
      ...itemView(item as never, String(req.user!._id)),
      claims: claims.map((c) => {
        const claimant = pmap.get(String(c.claimantId));
        // Contact details are exchanged only after the poster approves a claim.
        const approved = c.status === 'approved';
        return {
          id: String(c._id), status: c.status, message: mine || String(c.claimantId) === String(req.user!._id) ? c.message : null, createdAt: c.createdAt,
          claimant: mine ? { name: claimant?.fullName ?? 'Student', email: approved ? claimant?.email : null, phone: approved ? claimant?.phone : null } : null,
          poster: !mine && approved ? { name: owner?.fullName ?? 'Student', email: owner?.email, phone: owner?.phone } : null,
        };
      }),
    });
  }),
);

communityRouter.post(
  '/lost-found/:id/claims',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const input = parse(lostFoundClaimSchema, req.body);
    const item = await LostFoundItem.findOne({ _id: req.params.id, status: 'open' });
    if (!item) throw notFound();
    if (String(item.ownerId) === String(req.user!._id)) throw new AppError(422, 'own_item', 'This is your own listing.');
    const claim = await LostFoundClaim.findOneAndUpdate(
      { itemId: item._id, claimantId: req.user!._id },
      { $setOnInsert: { message: input.message, status: 'pending' } },
      { upsert: true, new: true },
    );
    await notify({ userId: String(item.ownerId), kind: 'lost_found', category: 'community', title: item.type === 'found' ? 'Someone thinks this is theirs' : 'Someone may have found your item', body: `New response on "${item.title}".`, link: `/student/lost-found/${item._id}` });
    ok(res, { id: String(claim._id), status: claim.status }, 201);
  }),
);

communityRouter.post(
  '/lost-found/claims/:claimId/decision',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.claimId)) throw notFound();
    const { decision } = parse(lostFoundClaimDecisionSchema, req.body);
    const claim = await LostFoundClaim.findById(req.params.claimId);
    if (!claim || claim.status !== 'pending') throw notFound();
    const item = await LostFoundItem.findById(claim.itemId);
    if (!item || String(item.ownerId) !== String(req.user!._id)) throw notFound();
    claim.status = decision === 'approve' ? 'approved' : 'rejected';
    claim.decidedAt = new Date();
    await claim.save();
    if (decision === 'approve') {
      item.status = 'claimed';
      await item.save();
    }
    await notify({ userId: String(claim.claimantId), kind: 'lost_found', category: 'community', title: decision === 'approve' ? 'Your claim was accepted' : 'Your claim was declined', body: decision === 'approve' ? `Contact details for "${item.title}" are now visible.` : `The poster declined your response on "${item.title}".`, link: `/student/lost-found/${item._id}` });
    await audit({ action: `lost_found.claim_${claim.status}`, req, targetType: 'lost_found', targetId: String(item._id) });
    ok(res, { ok: true, status: claim.status });
  }),
);

communityRouter.post(
  '/lost-found/:id/status',
  asyncHandler(async (req, res) => {
    const input = parse(z.object({ status: z.enum(['returned', 'closed', 'removed']), reason: z.string().trim().max(300).optional() }), req.body);
    const item = await LostFoundItem.findById(req.params.id);
    if (!item) throw notFound();
    const mine = String(item.ownerId) === String(req.user!._id);
    if (input.status === 'removed' ? !canManageCommunity(req.user) : !mine) throw notFound();
    item.status = input.status;
    if (input.status === 'removed') item.removedReason = input.reason ?? 'Community guidelines';
    await item.save();
    if (input.status === 'removed') {
      await notify({ userId: String(item.ownerId), kind: 'lost_found', title: 'Listing removed by a moderator', body: `"${item.title}" was removed: ${item.removedReason}.`, link: '/student/lost-found' });
      await audit({ action: 'lost_found.removed', req, targetType: 'lost_found', targetId: String(item._id) });
    }
    ok(res, { ok: true });
  }),
);

// ------------------------------------------------------------------ anonymous safety suggestions
communityRouter.post(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.community.suggestionsEnabled) throw new AppError(403, 'disabled', 'Safety suggestions are turned off.');
    const input = parse(suggestionCreateSchema, req.body);
    const tag = anonymousReporterTag(String(req.user!._id));
    const recent = await SafetySuggestion.countDocuments({ $or: [{ authorId: req.user!._id }, { authorTag: tag }], createdAt: { $gt: new Date(Date.now() - 86400_000) } });
    if (recent >= 5) throw new AppError(429, 'rate_limited', 'You can share up to 5 suggestions a day.');
    const sug = await SafetySuggestion.create({ authorId: input.anonymous ? null : req.user!._id, authorTag: input.anonymous ? tag : null, category: input.category, text: input.text });
    ok(res, { id: String(sug._id), status: sug.status }, 201);
  }),
);

communityRouter.get(
  '/suggestions',
  asyncHandler(async (req, res) => {
    const tag = anonymousReporterTag(String(req.user!._id));
    const [mine, published] = await Promise.all([
      SafetySuggestion.find({ $or: [{ authorId: req.user!._id }, { authorTag: tag }] }).sort({ createdAt: -1 }).limit(50).lean(),
      // "You said, we did": suggestions the university has acted on, without author details.
      SafetySuggestion.find({ status: { $in: ['planned', 'done'] }, response: { $ne: null } }).sort({ updatedAt: -1 }).limit(20).lean(),
    ]);
    const view = (x: (typeof mine)[number]) => ({ id: String(x._id), category: x.category, text: x.text, status: x.status, response: x.response, createdAt: x.createdAt });
    ok(res, { mine: mine.map(view), youSaidWeDid: published.map(view) });
  }),
);

communityRouter.get(
  '/manage/suggestions',
  requirePermission('community_safety:manage'),
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: String(req.query.status) } : {};
    const list = await SafetySuggestion.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, list.map((x) => ({ id: String(x._id), category: x.category, text: x.text, status: x.status, response: x.response, anonymous: !x.authorId, createdAt: x.createdAt })));
  }),
);

communityRouter.patch(
  '/manage/suggestions/:id',
  requirePermission('community_safety:manage'),
  asyncHandler(async (req, res) => {
    const input = parse(suggestionReviewSchema, req.body);
    const x = await SafetySuggestion.findByIdAndUpdate(req.params.id, { $set: { status: input.status, response: input.response ?? null, reviewedBy: req.user!._id } }, { new: true });
    if (!x) throw notFound();
    if (x.authorId) await notify({ userId: String(x.authorId), kind: 'suggestion', category: 'announcements', title: 'Response to your safety suggestion', body: `Status: ${input.status}.`, link: '/student/suggestions' });
    await audit({ action: 'suggestion.reviewed', req, targetType: 'suggestion', targetId: String(x._id), meta: { status: input.status } });
    ok(res, { ok: true });
  }),
);

communityRouter.get(
  '/manage/lost-found',
  requirePermission('community_safety:manage'),
  asyncHandler(async (_req, res) => {
    const list = await LostFoundItem.find({ status: { $in: ['open', 'claimed'] } }).sort({ createdAt: -1 }).limit(200).lean();
    ok(res, list.map((i) => ({ ...itemView(i as never, ''), mine: undefined })));
  }),
);

