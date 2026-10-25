import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { EVENT_KIND_LABELS, communityEventSchema, rsvpSchema, type EventKind } from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { CommunityEvent, EventRsvp } from '../models/feed';
import { requireAuth } from '../middleware/auth';
import { getSettings } from '../services/settings.service';
import { audit } from '../services/audit.service';
import { notifyMany } from '../services/notification.service';
import { can, ensureCounsellingChannel, isActivePublisher, notifyFollowers, sameId } from '../services/feed.service';

/** Official campus events and awareness campaigns: GET/POST /community/events, RSVP and cancellation. */
export const eventsRouter = Router();
eventsRouter.use(requireAuth);

type Viewer = NonNullable<Express.Request['user']>;

/** Organisers: administrators with announcements rights, individually granted organisers, and verified counsellors (counselling events only). */
async function canOrganize(user: Viewer, channel: 'counselling' | null | undefined) {
  if (can(user, 'announcements:manage') || can(user, 'community:organize_events')) return true;
  if (channel === 'counselling') return isActivePublisher(user, (await ensureCounsellingChannel())._id);
  return false;
}

async function assertEventsOn() {
  if (!(await getSettings()).community.eventsEnabled) throw new AppError(403, 'events_disabled', 'Community events are turned off.');
}

async function serializeEvents(user: Viewer, events: Record<string, unknown>[]) {
  const ids = events.map((e) => e._id);
  const [counts, mine, channel] = await Promise.all([
    EventRsvp.aggregate([{ $match: { eventId: { $in: ids } } }, { $group: { _id: { e: '$eventId', s: '$status' }, n: { $sum: 1 } } }]),
    EventRsvp.find({ eventId: { $in: ids }, userId: user._id }, { eventId: 1, status: 1 }).lean(),
    ensureCounsellingChannel(),
  ]);
  const countOf = (id: unknown, s: string) => counts.find((c) => String(c._id.e) === String(id) && c._id.s === s)?.n ?? 0;
  const myMap = new Map(mine.map((m) => [String(m.eventId), m.status]));
  const manageAll = can(user, 'announcements:manage');
  return events.map((e) => ({
    id: String(e._id), title: e.title, description: e.description, kind: e.kind, kindLabel: EVENT_KIND_LABELS[e.kind as EventKind],
    startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, organizer: e.organizer, capacity: e.capacity, status: e.status,
    channel: e.channelId && sameId(e.channelId, channel._id) ? 'counselling' : null,
    going: countOf(e._id, 'going'), interested: countOf(e._id, 'interested'),
    myRsvp: myMap.get(String(e._id)) ?? null,
    past: (e.endsAt as Date) < new Date(),
    canManage: manageAll || sameId(e.createdBy, user._id),
  }));
}

eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const s = await getSettings();
    if (!s.community.eventsEnabled) return ok(res, { items: [], disabled: true });
    const past = req.query.when === 'past';
    const filter: Record<string, unknown> = past ? { endsAt: { $lt: new Date() } } : { endsAt: { $gte: new Date() }, status: 'published' };
    if (req.query.channel === 'counselling') filter.channelId = (await ensureCounsellingChannel())._id;
    if (typeof req.query.kind === 'string' && req.query.kind in EVENT_KIND_LABELS) filter.kind = req.query.kind;
    const events = await CommunityEvent.find(filter).sort({ startsAt: past ? -1 : 1 }).limit(50).lean();
    ok(res, { items: await serializeEvents(req.user!, events as never), canCreate: await canOrganize(req.user!, null) });
  }),
);

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const e = await CommunityEvent.findById(req.params.id).lean();
    if (!e) throw notFound();
    ok(res, (await serializeEvents(req.user!, [e as never]))[0]);
  }),
);

eventsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    await assertEventsOn();
    const input = parse(communityEventSchema, req.body);
    if (!(await canOrganize(req.user!, input.channel))) {
      await audit({ action: 'community.event_create_denied', req, outcome: 'denied' });
      throw new AppError(403, 'forbidden', 'Only authorised organisers can publish official campus events.');
    }
    if (input.startsAt.getTime() < Date.now() - 3600_000) throw new AppError(422, 'validation_failed', 'The event must be in the future.', { fields: { startsAt: 'Choose a future time' } });
    const channel = input.channel === 'counselling' ? await ensureCounsellingChannel() : null;
    const e = await CommunityEvent.create({ ...input, capacity: input.capacity ?? null, channelId: channel?._id ?? null, createdBy: req.user!._id });
    await audit({ action: 'community.event_created', req, targetType: 'community_event', targetId: String(e._id), meta: { kind: input.kind, channel: input.channel ?? null } });
    if (channel) await notifyFollowers(channel, { _id: e._id, authorId: req.user!._id, topic: null }).catch(() => undefined);
    ok(res, (await serializeEvents(req.user!, [e.toObject() as never]))[0], 201);
  }),
);

async function loadManaged(req: Request) {
  if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
  const e = await CommunityEvent.findById(req.params.id);
  if (!e) throw notFound();
  if (!can(req.user!, 'announcements:manage') && !sameId(e.createdBy, req.user!._id)) throw new AppError(403, 'forbidden', 'Only the organiser can change this event.');
  return e;
}

eventsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const e = await loadManaged(req);
    const input = parse(communityEventSchema.innerType().partial(), req.body);
    const before = { startsAt: e.startsAt.getTime(), venue: e.venue };
    const { channel: _ignored, ...rest } = input;
    void _ignored;
    Object.assign(e, rest);
    if (e.endsAt <= e.startsAt) throw new AppError(422, 'validation_failed', 'The event must end after it starts.', { fields: { endsAt: 'Must be after the start' } });
    if (e.startsAt.getTime() !== before.startsAt) e.reminderSentAt = null;
    await e.save();
    await audit({ action: 'community.event_updated', req, targetType: 'community_event', targetId: String(e._id), meta: { fields: Object.keys(rest) } });
    if (e.startsAt.getTime() !== before.startsAt || e.venue !== before.venue) {
      const rsvps = await EventRsvp.find({ eventId: e._id }, { userId: 1 }).lean();
      await notifyMany(rsvps.map((r) => String(r.userId)), { kind: 'event_update', category: 'community', title: `Event updated: ${e.title}`, body: 'The time or venue changed. Check the details.', link: `/student/community/events/${e._id}` });
    }
    ok(res, (await serializeEvents(req.user!, [e.toObject() as never]))[0]);
  }),
);

eventsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const e = await loadManaged(req);
    if (e.status === 'cancelled') return ok(res, { ok: true });
    e.status = 'cancelled';
    await e.save();
    await audit({ action: 'community.event_cancelled', req, targetType: 'community_event', targetId: String(e._id) });
    const rsvps = await EventRsvp.find({ eventId: e._id }, { userId: 1 }).lean();
    await notifyMany(rsvps.map((r) => String(r.userId)), { kind: 'event_update', category: 'community', title: `Event cancelled: ${e.title}`, body: 'The organiser cancelled this event.', link: `/student/community/events/${e._id}` });
    ok(res, { ok: true });
  }),
);

eventsRouter.post(
  '/:id/rsvp',
  asyncHandler(async (req, res) => {
    await assertEventsOn();
    const { status } = parse(rsvpSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const e = await CommunityEvent.findById(req.params.id).lean();
    if (!e) throw notFound();
    if (status === 'none') {
      await EventRsvp.deleteOne({ eventId: e._id, userId: req.user!._id });
    } else {
      if (e.status !== 'published' || e.endsAt < new Date()) throw new AppError(409, 'closed', 'This event is no longer open.');
      if (status === 'going' && e.capacity) {
        const going = await EventRsvp.countDocuments({ eventId: e._id, status: 'going', userId: { $ne: req.user!._id } });
        if (going >= e.capacity) throw new AppError(409, 'full', 'This event is full. Mark yourself as interested to hear about changes.');
      }
      await EventRsvp.updateOne({ eventId: e._id, userId: req.user!._id }, { $set: { status }, $setOnInsert: { eventId: e._id, userId: req.user!._id } }, { upsert: true });
    }
    ok(res, (await serializeEvents(req.user!, [e as never]))[0]);
  }),
);
