import { Router } from 'express';
import { Types } from 'mongoose';
import { COUNSELLING_TYPES, counsellorDirectoryAdminSchema, counsellorPublicProfileSchema } from '@campuscare/shared';
import { AppError, asyncHandler, notFound, ok, parse } from '../lib/http';
import { Availability } from '../models/counselling';
import { User } from '../models/user';
import { CounsellingFeedback } from '../models/wellness';
import { requireAuth, requireMfaPolicy, requirePermission, requireRole } from '../middleware/auth';
import { audit } from '../services/audit.service';
import { notify, notifyMany } from '../services/notification.service';
import { getSettings } from '../services/settings.service';
import { feedbackMinimum, publicCounsellor, ratingSummaries } from '../services/counsellor-directory.service';

/**
 * Counsellor public profiles: the counsellor edits what students see (credentials wait for approval);
 * a Super Admin approves credentials and controls listing and photo visibility. Mounted under
 * /api/v1/counselling. Ratings, roles, permissions and verification are never editable here.
 */
export const counsellorProfileRouter = Router();
counsellorProfileRouter.use(requireAuth);

const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);

function ownView(a: Record<string, any> | null) {
  return {
    title: a?.title ?? 'Counsellor',
    bio: a?.bio ?? '',
    specializations: a?.specializations ?? [],
    languages: a?.languages ?? [],
    supportedModes: a?.supportedModes ?? ['in_person'],
    qualifications: a?.credentialsApprovedAt ? a?.qualifications ?? [] : [],
    yearsExperience: a?.credentialsApprovedAt ? a?.yearsExperience ?? null : null,
    credentialsApprovedAt: a?.credentialsApprovedAt ?? null,
    pendingCredentials: a?.pendingCredentials?.submittedAt ? a.pendingCredentials : null,
    // Read-only for the counsellor: set by a Super Admin.
    listed: a?.listed !== false,
    listingReason: a?.listed === false ? a?.listingReason ?? null : null,
    photoVisible: a?.photoVisible !== false,
    profileUpdatedAt: a?.profileUpdatedAt ?? null,
  };
}

// ------------------------------------------------------------------ the counsellor's own public profile
counsellorProfileRouter.get(
  '/profile/public',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    const a = await Availability.findOne({ counsellorId: req.user!._id }).lean();
    const s = await getSettings();
    const rating = (await ratingSummaries([req.user!._id], s)).get(String(req.user!._id))!;
    // Exactly what a student would see, so the counsellor can check it.
    const preview = await publicCounsellor(req.user! as never, a, { rating });
    ok(res, { profile: ownView(a), preview, feedbackMinimum: feedbackMinimum(s) });
  }),
);

counsellorProfileRouter.put(
  '/profile/public',
  requireRole('counsellor'),
  asyncHandler(async (req, res) => {
    // Unknown fields (listed, rating, role, verification…) are stripped by the schema and never saved.
    const input = parse(counsellorPublicProfileSchema, req.body);
    const unknown = (input.specializations ?? []).filter((x) => !(COUNSELLING_TYPES as readonly string[]).includes(x));
    if (unknown.length) throw new AppError(422, 'validation_failed', 'Choose specialisations from the list.', { fields: { specializations: `Unknown: ${unknown.join(', ')}` } });
    const prev = await Availability.findOne({ counsellorId: req.user!._id }).lean();
    const set: Record<string, unknown> = {};
    for (const k of ['title', 'bio', 'specializations', 'languages', 'supportedModes'] as const) if (input[k] !== undefined) set[k] = input[k];

    let credentialsSubmitted = false;
    if (input.qualifications !== undefined || input.yearsExperience !== undefined) {
      const quals = input.qualifications ?? prev?.pendingCredentials?.qualifications ?? prev?.qualifications ?? [];
      const years = input.yearsExperience !== undefined ? input.yearsExperience : prev?.pendingCredentials?.yearsExperience ?? prev?.yearsExperience ?? null;
      const approvedSame = Boolean(prev?.credentialsApprovedAt) && sameList(quals, prev?.qualifications ?? []) && (years ?? null) === (prev?.yearsExperience ?? null);
      if (approvedSame) set.pendingCredentials = null;
      else {
        set.pendingCredentials = { qualifications: quals, yearsExperience: years ?? null, submittedAt: new Date() };
        credentialsSubmitted = true;
      }
    }
    if (!Object.keys(set).length) throw new AppError(422, 'validation_failed', 'Nothing to change.');
    set.profileUpdatedAt = new Date();
    const a = await Availability.findOneAndUpdate({ counsellorId: req.user!._id }, { $set: set }, { upsert: true, new: true }).lean();
    await audit({ action: 'counsellor.public_profile_updated', req, targetType: 'user', targetId: String(req.user!._id), changedFields: Object.keys(set).filter((k) => k !== 'profileUpdatedAt') });
    if (credentialsSubmitted) {
      await audit({ action: 'counsellor.credentials_submitted', req, targetType: 'user', targetId: String(req.user!._id) });
      const admins = await User.find({ role: 'super_admin', accountStatus: 'active' }, { _id: 1 }).limit(20).lean();
      await notifyMany(admins.map((x) => String(x._id)), {
        kind: 'counsellor_credentials', category: 'appointments', priority: 'normal',
        title: 'Counsellor credentials to review', body: `${req.user!.fullName} submitted qualifications for their public profile.`, link: '/super-admin/counsellor-directory',
      });
    }
    ok(res, { profile: ownView(a as never), credentialsPending: credentialsSubmitted });
  }),
);

// ------------------------------------------------------------------ Super Admin
const superAdmin = [requirePermission('super_admin:access'), requireMfaPolicy] as const;

/** Every counsellor account with its listing state, credentials and feedback figures (no student identity). */
counsellorProfileRouter.get(
  '/admin/directory',
  ...superAdmin,
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    const users = await User.find({ role: 'counsellor' }, { fullName: 1, email: 1, department: 1, accountStatus: 1, avatarUpdatedAt: 1 }).sort({ fullName: 1 }).limit(500).lean();
    const ids = users.map((u) => u._id);
    const [avail, ratings, fb] = await Promise.all([
      Availability.find({ counsellorId: { $in: ids } }).lean(),
      ratingSummaries(ids, s),
      CounsellingFeedback.aggregate<{ _id: Types.ObjectId; total: number; raters: (string | null)[]; concerns: number; hidden: number; pendingComments: number; reported: number; legacy: number }>([
        { $match: { counsellorId: { $in: ids } } },
        {
          $group: {
            _id: '$counsellorId', total: { $sum: 1 }, raters: { $addToSet: '$raterKey' },
            concerns: { $sum: { $cond: ['$concern', 1, 0] } }, hidden: { $sum: { $cond: ['$hiddenFromPublic', 1, 0] } },
            pendingComments: { $sum: { $cond: [{ $eq: ['$publicComment', 'pending'] }, 1, 0] } },
            reported: { $sum: { $cond: [{ $gt: ['$reportCount', 0] }, 1, 0] } },
            legacy: { $sum: { $cond: [{ $eq: [{ $type: '$raterKey' }, 'string'] }, 0, 1] } },
          },
        },
      ]),
    ]);
    const aBy = new Map(avail.map((a) => [String(a.counsellorId), a]));
    const fBy = new Map(fb.map((f) => [String(f._id), f]));
    const rows = [];
    for (const u of users) {
      const a = aBy.get(String(u._id)) as Record<string, any> | undefined;
      const f = fBy.get(String(u._id));
      const entry = u.accountStatus === 'active' ? await publicCounsellor(u, a, { rating: ratings.get(String(u._id)), staff: true }) : null;
      rows.push({
        id: String(u._id), name: u.fullName, email: u.email, department: u.department ?? null, accountStatus: u.accountStatus,
        listed: a?.listed !== false, listingReason: a?.listingReason ?? null, photoVisible: a?.photoVisible !== false, hasPhoto: Boolean(u.avatarUpdatedAt),
        hasProfile: Boolean(a), title: a?.title ?? 'Counsellor', bio: a?.bio ?? '', specializations: a?.specializations ?? [], languages: a?.languages ?? [],
        qualifications: a?.qualifications ?? [], yearsExperience: a?.yearsExperience ?? null, credentialsApprovedAt: a?.credentialsApprovedAt ?? null,
        pendingCredentials: a?.pendingCredentials?.submittedAt ? a.pendingCredentials : null,
        onDuty: a?.acceptingRequests !== false && Boolean(a),
        nextAvailableAt: entry?.nextAvailableAt ?? null,
        // Whether a student would find them right now, and why not.
        studentVisible: Boolean(entry && entry.acceptingRequests && entry.nextAvailableAt),
        rating: ratings.get(String(u._id)) ?? null,
        feedback: { total: f?.total ?? 0, distinctRaters: (f?.raters ?? []).filter(Boolean).length, concerns: f?.concerns ?? 0, hidden: f?.hidden ?? 0, pendingComments: f?.pendingComments ?? 0, reported: f?.reported ?? 0, legacy: f?.legacy ?? 0 },
      });
    }
    ok(res, { items: rows, settings: { feedbackMinimum: feedbackMinimum(s), showComments: s.counsellorDirectory.showComments } });
  }),
);

counsellorProfileRouter.patch(
  '/admin/counsellors/:id/directory',
  ...superAdmin,
  asyncHandler(async (req, res) => {
    const input = parse(counsellorDirectoryAdminSchema, req.body);
    if (!Types.ObjectId.isValid(req.params.id)) throw notFound();
    const u = await User.findOne({ _id: req.params.id, role: 'counsellor' }, { fullName: 1 }).lean();
    if (!u) throw notFound();
    const prev = await Availability.findOne({ counsellorId: u._id }).lean();
    const set: Record<string, unknown> = {};
    if (input.listed !== undefined) { set.listed = input.listed; set.listingReason = input.reason; }
    if (input.photoVisible !== undefined) set.photoVisible = input.photoVisible;
    if (input.credentials) {
      const pending = prev?.pendingCredentials;
      if (!pending?.submittedAt) throw new AppError(409, 'nothing_pending', 'There are no submitted credentials to review.');
      if (input.credentials === 'approve') {
        Object.assign(set, { qualifications: pending.qualifications ?? [], yearsExperience: pending.yearsExperience ?? null, credentialsApprovedAt: new Date(), credentialsApprovedBy: req.user!._id });
      }
      set.pendingCredentials = null;
    }
    const a = await Availability.findOneAndUpdate({ counsellorId: u._id }, { $set: set }, { upsert: true, new: true }).lean();
    const before = { listed: prev?.listed !== false, photoVisible: prev?.photoVisible !== false };
    const after = { listed: a!.listed !== false, photoVisible: a!.photoVisible !== false };
    await audit({ action: 'counsellor.directory_updated', req, targetType: 'user', targetId: String(u._id), reason: input.reason, before, after, meta: { credentials: input.credentials ?? null } });
    const told: string[] = [];
    if (input.credentials) told.push(input.credentials === 'approve' ? 'Your qualifications were approved and now appear on your profile.' : `Your submitted qualifications were not approved: ${input.reason}`);
    if (input.listed !== undefined && before.listed !== after.listed) told.push(after.listed ? 'Your profile is listed in the student directory again.' : `Your profile was removed from the student directory: ${input.reason}`);
    if (input.photoVisible !== undefined && before.photoVisible !== after.photoVisible) told.push(after.photoVisible ? 'Your photo is shown on your public profile again.' : 'Your photo is hidden on your public profile.');
    if (told.length) await notify({ userId: String(u._id), kind: 'counsellor_profile', category: 'appointments', priority: 'normal', title: 'Your public profile was updated', body: told.join(' '), link: '/counsellor/profile' });
    ok(res, { id: String(u._id), ...after, credentialsApprovedAt: a!.credentialsApprovedAt ?? null, pendingCredentials: a!.pendingCredentials?.submittedAt ? a!.pendingCredentials : null });
  }),
);
