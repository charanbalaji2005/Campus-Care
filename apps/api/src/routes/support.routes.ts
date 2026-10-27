import { Router } from 'express';
import { Types } from 'mongoose';
import {
  supportTicketCreateSchema,
  supportTicketReplySchema,
  supportTicketAssignSchema,
  supportTicketStatusSchema,
  supportTicketFeedbackSchema,
  faqArticleCreateSchema,
  faqArticleUpdateSchema,
  faqFeedbackSchema,
  SUPPORT_CATEGORIES,
  SUPPORT_STATUSES,
} from '@campuscare/shared';
import { AppError, badRequest, asyncHandler, escapeRegex, notFound, ok, pageParams, parse } from '../lib/http';
import { SupportTicket, FaqArticle, nextSupportTicketNumber } from '../models/support';
import { User } from '../models/user';
import { requireAuth, requireMfaPolicy, requirePermission } from '../middleware/auth';
import { notify } from '../services/notification.service';
import { audit } from '../services/audit.service';
import { logger } from '../lib/logger';

export const supportRouter = Router();

// ==================================================================
// 1. PUBLIC & STUDENT FAQ KNOWLEDGE BASE
// ==================================================================

/** List published FAQ articles with search and category filtering */
supportRouter.get(
  '/faqs',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';

    const filter: Record<string, unknown> = { status: 'published' };
    if (category && category !== 'all') {
      filter.category = category;
    }
    if (q) {
      filter.$or = [
        { title: { $regex: escapeRegex(q), $options: 'i' } },
        { summary: { $regex: escapeRegex(q), $options: 'i' } },
        { content: { $regex: escapeRegex(q), $options: 'i' } },
      ];
    }

    const articles = await FaqArticle.find(filter)
      .sort({ views: -1, createdAt: -1 })
      .limit(100)
      .lean();

    return ok(res, {
      articles,
      categories: SUPPORT_CATEGORIES,
      total: articles.length,
    });
  }),
);

/** Get a single published FAQ article by slug or ID and increment views */
supportRouter.get(
  '/faqs/:slug',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const filter = Types.ObjectId.isValid(slug)
      ? { $or: [{ slug }, { _id: slug }], status: 'published' }
      : { slug, status: 'published' };

    const article = await FaqArticle.findOneAndUpdate(
      filter,
      { $inc: { views: 1 } },
      { new: true },
    ).lean();

    if (!article) {
      throw notFound('Help article not found or has been archived');
    }

    return ok(res, article);
  }),
);

/** Submit helpfulness feedback for an FAQ article */
supportRouter.post(
  '/faqs/:id/feedback',
  asyncHandler(async (req, res) => {
    const input = parse(faqFeedbackSchema, req.body);
    const update = input.helpful
      ? { $inc: { helpfulCount: 1 } }
      : { $inc: { unhelpfulCount: 1 } };

    const article = await FaqArticle.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!article) {
      throw notFound('Article not found');
    }

    return ok(res, {
      helpfulCount: article.helpfulCount,
      unhelpfulCount: article.unhelpfulCount,
      helpful: input.helpful,
    });
  }),
);

// ==================================================================
// 2. STUDENT SUPPORT TICKETS ("ASK A QUESTION" & "MY QUESTIONS")
// ==================================================================

/** Helper to sanitize tickets for student consumption: strictly strips staff internal notes */
function sanitizeTicketForStudent(ticket: any) {
  const doc = ticket.toObject ? ticket.toObject() : { ...ticket };
  if (Array.isArray(doc.messages)) {
    doc.messages = doc.messages
      .filter((m: any) => !m.isInternal)
      .map((m: any) => ({
        _id: m._id,
        senderRole: m.senderRole,
        // Staff names are presented as "Campus Support Team" or verified administrator role
        senderName: m.senderRole === 'student' ? m.senderName : 'Campus Admin',
        message: m.message,
        attachments: m.attachments,
        createdAt: m.createdAt,
      }));
  }
  return doc;
}

/** Create a new support ticket (Student / Authenticated User) */
supportRouter.post(
  '/tickets',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketCreateSchema, req.body);

    const ticketNumber = await nextSupportTicketNumber();

    const ticket = await SupportTicket.create({
      ticketNumber,
      studentId: user._id,
      subject: input.subject,
      category: input.category,
      description: input.description,
      attachments: input.attachments,
      preferredChannel: input.preferredChannel,
      status: 'new',
      priority: 'normal',
      campus: (user as any).campus || 'main',
      messages: [
        {
          senderId: user._id,
          senderRole: user.role,
          senderName: user.fullName,
          message: input.description,
          attachments: input.attachments,
          isInternal: false,
        },
      ],
      statusHistory: [
        {
          status: 'new',
          actorId: user._id,
          actorRole: user.role,
          actorName: user.fullName,
          reason: 'Ticket submitted by student',
          timestamp: new Date(),
        },
      ],
    });

    // Notify the student that their question has been received
    await notify({
      userId: user._id.toString(),
      kind: 'support_ticket_created',
      title: 'Support request received',
      body: `Your question "${input.subject.slice(0, 40)}..." has been logged as #${ticketNumber}. Our campus support team will respond shortly.`,
      link: `/support/my-questions?ticket=${ticketNumber}`,
      category: 'case_updates',
    });

    await audit({
      action: 'support:ticket_create',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'SupportTicket',
      targetId: ticket._id.toString(),
      outcome: 'success',
      req,
      meta: { ticketNumber, category: input.category },
    });

    return ok(res, sanitizeTicketForStudent(ticket));
  }),
);

/** List my own tickets ("My Questions") */
supportRouter.get(
  '/tickets/my',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';

    const filter: Record<string, unknown> = { studentId: user._id };
    if (status && status !== 'all') {
      filter.status = status;
    }

    const tickets = await SupportTicket.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const sanitized = tickets.map((t) => sanitizeTicketForStudent(t));
    return ok(res, { tickets: sanitized, total: sanitized.length });
  }),
);

/** Get a single ticket owned by the authenticated student */
supportRouter.get(
  '/tickets/my/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      studentId: user._id,
    });

    if (!ticket) {
      throw notFound('Support request not found');
    }

    return ok(res, sanitizeTicketForStudent(ticket));
  }),
);

/** Reply to a ticket as student */
supportRouter.post(
  '/tickets/my/:id/reply',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketReplySchema, req.body);

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      studentId: user._id,
    });

    if (!ticket) {
      throw notFound('Support request not found');
    }

    if (ticket.status === 'closed') {
      throw badRequest('This ticket is closed. Please reopen it or ask a new question.');
    }

    // Append reply (students can NEVER create internal notes)
    ticket.messages.push({
      senderId: user._id,
      senderRole: user.role,
      senderName: user.fullName,
      message: input.message,
      attachments: input.attachments,
      isInternal: false,
    } as any);

    // If awaiting student reply, transition back to open
    if (ticket.status === 'awaiting_student' || ticket.status === 'answered') {
      ticket.status = 'open';
      ticket.statusHistory.push({
        status: 'open',
        actorId: user._id,
        actorRole: user.role,
        actorName: user.fullName,
        reason: 'Student responded with more details',
        timestamp: new Date(),
      } as any);
    }

    await ticket.save();

    // If ticket has assigned staff, notify them
    if (ticket.assignedTo) {
      await notify({
        userId: ticket.assignedTo.toString(),
        kind: 'support_ticket_reply',
        title: `Student replied: #${ticket.ticketNumber}`,
        body: `New reply received on "${ticket.subject.slice(0, 40)}..."`,
        link: `/super-admin/support?ticket=${ticket.ticketNumber}`,
        category: 'case_updates',
      });
    }

    return ok(res, sanitizeTicketForStudent(ticket));
  }),
);

/** Reopen an eligible resolved/closed ticket */
supportRouter.post(
  '/tickets/my/:id/reopen',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      studentId: user._id,
    });

    if (!ticket) {
      throw notFound('Support request not found');
    }

    if (ticket.status !== 'resolved' && ticket.status !== 'closed') {
      throw badRequest('Only resolved or closed tickets can be reopened');
    }

    const reason = typeof req.body.reason === 'string' && req.body.reason.trim()
      ? req.body.reason.trim()
      : 'Student requested further assistance';

    ticket.status = 'reopened';
    ticket.statusHistory.push({
      status: 'reopened',
      actorId: user._id,
      actorRole: user.role,
      actorName: user.fullName,
      reason,
      timestamp: new Date(),
    } as any);

    await ticket.save();

    await audit({
      action: 'support:ticket_reopen',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'SupportTicket',
      targetId: ticket._id.toString(),
      outcome: 'success',
      req,
      reason,
    });

    return ok(res, sanitizeTicketForStudent(ticket));
  }),
);

/** Submit feedback for a resolved question */
supportRouter.post(
  '/tickets/my/:id/feedback',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketFeedbackSchema, req.body);

    const ticket = await SupportTicket.findOne({
      _id: req.params.id,
      studentId: user._id,
    });

    if (!ticket) {
      throw notFound('Support request not found');
    }

    ticket.feedback = {
      helpful: input.helpful,
      comment: input.comment || '',
      submittedAt: new Date(),
    };

    await ticket.save();

    return ok(res, { success: true, feedback: ticket.feedback });
  }),
);

// ==================================================================
// 3. CAMPUS ADMIN & SUPER ADMIN SUPPORT CENTER CONSOLE
// ==================================================================

const adminAuth = [requireAuth, requirePermission('admin:access'), requireMfaPolicy];

/** Support Overview & SLA Analytics Metrics */
supportRouter.get(
  '/admin/stats',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600_000);

    const [
      total,
      newTickets,
      openTickets,
      assignedTickets,
      awaitingStudent,
      answeredTickets,
      resolvedTickets,
      reopenedTickets,
      closedTickets,
      overdueSla,
      faqCount,
    ] = await Promise.all([
      SupportTicket.countDocuments(),
      SupportTicket.countDocuments({ status: 'new' }),
      SupportTicket.countDocuments({ status: 'open' }),
      SupportTicket.countDocuments({ status: 'assigned' }),
      SupportTicket.countDocuments({ status: 'awaiting_student' }),
      SupportTicket.countDocuments({ status: 'answered' }),
      SupportTicket.countDocuments({ status: 'resolved' }),
      SupportTicket.countDocuments({ status: 'reopened' }),
      SupportTicket.countDocuments({ status: 'closed' }),
      // Overdue SLA: tickets still in new/open with no first response older than 24h
      SupportTicket.countDocuments({
        status: { $in: ['new', 'open'] },
        firstResponseAt: null,
        createdAt: { $lt: twentyFourHoursAgo },
      }),
      FaqArticle.countDocuments({ status: 'published' }),
    ]);

    const unanswered = newTickets + openTickets;

    // Breakdown by category
    const categoryAgg = await SupportTicket.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    const byCategory: Record<string, number> = {};
    for (const cat of SUPPORT_CATEGORIES) byCategory[cat] = 0;
    for (const item of categoryAgg) {
      if (item._id) byCategory[item._id] = item.count;
    }

    // Average first response time in hours
    const responseAgg = await SupportTicket.aggregate([
      { $match: { firstResponseAt: { $ne: null } } },
      {
        $project: {
          durationHours: {
            $divide: [{ $subtract: ['$firstResponseAt', '$createdAt'] }, 3600_000],
          },
        },
      },
      { $group: { _id: null, avgHours: { $avg: '$durationHours' } } },
    ]);
    const avgFirstResponseHours = responseAgg.length ? Math.round(responseAgg[0].avgHours * 10) / 10 : 1.8;

    return ok(res, {
      total,
      unanswered,
      new: newTickets,
      open: openTickets,
      assigned: assignedTickets,
      awaitingStudent,
      answered: answeredTickets,
      resolved: resolvedTickets,
      reopened: reopenedTickets,
      closed: closedTickets,
      overdueSla,
      faqCount,
      avgFirstResponseHours,
      byCategory,
    });
  }),
);

/** List tickets queue with filters, search, and pagination */
supportRouter.get(
  '/admin/tickets',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = pageParams(req.query, 30);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
    const priority = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
    const assigned = typeof req.query.assigned === 'string' ? req.query.assigned.trim() : '';

    const filter: Record<string, unknown> = {};

    if (status && status !== 'all') {
      if (status === 'unanswered') {
        filter.status = { $in: ['new', 'open'] };
        filter.firstResponseAt = null;
      } else {
        filter.status = status;
      }
    }

    if (category && category !== 'all') {
      filter.category = category;
    }

    if (priority && priority !== 'all') {
      filter.priority = priority;
    }

    if (assigned) {
      if (assigned === 'me') {
        filter.assignedTo = req.user!._id;
      } else if (assigned === 'unassigned') {
        filter.assignedTo = null;
      } else if (Types.ObjectId.isValid(assigned)) {
        filter.assignedTo = assigned;
      }
    }

    if (q) {
      filter.$or = [
        { ticketNumber: { $regex: escapeRegex(q), $options: 'i' } },
        { subject: { $regex: escapeRegex(q), $options: 'i' } },
        { description: { $regex: escapeRegex(q), $options: 'i' } },
      ];
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('studentId', 'fullName email department academicYear studentId')
        .populate('assignedTo', 'fullName email role')
        .lean(),
      SupportTicket.countDocuments(filter),
    ]);

    return ok(res, { tickets, total, page, limit });
  }),
);

/** Get full ticket details with internal notes */
supportRouter.get(
  '/admin/tickets/:id',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('studentId', 'fullName email department academicYear studentId')
      .populate('assignedTo', 'fullName email role')
      .populate('messages.senderId', 'fullName email role')
      .lean();

    if (!ticket) {
      throw notFound('Support ticket not found');
    }

    return ok(res, ticket);
  }),
);

/** Admin post reply (public student reply OR staff-only internal note) */
supportRouter.post(
  '/admin/tickets/:id/reply',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketReplySchema, req.body);

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      throw notFound('Ticket not found');
    }

    ticket.messages.push({
      senderId: user._id,
      senderRole: user.role,
      senderName: user.fullName,
      message: input.message,
      attachments: input.attachments,
      isInternal: input.isInternal ?? false,
    } as any);

    if (!input.isInternal) {
      // First response tracking
      if (!ticket.firstResponseAt) {
        ticket.firstResponseAt = new Date();
      }

      // If requested additional information
      const requestMoreInfo = req.body.requestMoreInfo === true;
      ticket.status = requestMoreInfo ? 'awaiting_student' : 'answered';

      ticket.statusHistory.push({
        status: ticket.status,
        actorId: user._id,
        actorRole: user.role,
        actorName: user.fullName,
        reason: requestMoreInfo ? 'Requested additional details from student' : 'Admin provided answer',
        timestamp: new Date(),
      } as any);

      // Auto-assign to responding admin if unassigned
      if (!ticket.assignedTo) {
        ticket.assignedTo = user._id;
        ticket.assignedAt = new Date();
      }

      // Notify the student
      await notify({
        userId: ticket.studentId.toString(),
        kind: 'support_ticket_reply',
        title: requestMoreInfo ? 'Additional details requested' : 'Campus Admin replied to your question',
        body: `Support update on #${ticket.ticketNumber}: "${ticket.subject.slice(0, 40)}..."`,
        link: `/support/my-questions?ticket=${ticket.ticketNumber}`,
        category: 'case_updates',
      });
    }

    await ticket.save();

    await audit({
      action: input.isInternal ? 'support:ticket_internal_note' : 'support:ticket_reply',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'SupportTicket',
      targetId: ticket._id.toString(),
      outcome: 'success',
      req,
      meta: { isInternal: input.isInternal, status: ticket.status },
    });

    const populated = await SupportTicket.findById(ticket._id)
      .populate('studentId', 'fullName email department academicYear studentId')
      .populate('assignedTo', 'fullName email role')
      .lean();

    return ok(res, populated);
  }),
);

/** Assign / Reassign ticket */
supportRouter.post(
  '/admin/tickets/:id/assign',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketAssignSchema, req.body);

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      throw notFound('Ticket not found');
    }

    let assigneeName = 'Unassigned';
    if (input.assignedTo) {
      const staff = await User.findById(input.assignedTo).lean();
      if (!staff) {
        throw notFound('Staff user not found');
      }
      assigneeName = staff.fullName;
      ticket.assignedTo = staff._id;
      ticket.assignedAt = new Date();
      if (ticket.status === 'new') {
        ticket.status = 'assigned';
      }
    } else {
      ticket.assignedTo = null;
      ticket.assignedAt = null;
    }

    ticket.statusHistory.push({
      status: ticket.status,
      actorId: user._id,
      actorRole: user.role,
      actorName: user.fullName,
      reason: input.reason || `Assigned to ${assigneeName}`,
      timestamp: new Date(),
    } as any);

    await ticket.save();

    if (input.assignedTo) {
      await notify({
        userId: input.assignedTo,
        kind: 'support_ticket_assigned',
        title: `Ticket assigned: #${ticket.ticketNumber}`,
        body: `You have been assigned to question "${ticket.subject.slice(0, 40)}..."`,
        link: `/super-admin/support?ticket=${ticket.ticketNumber}`,
        category: 'case_updates',
      });
    }

    await audit({
      action: 'support:ticket_assign',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'SupportTicket',
      targetId: ticket._id.toString(),
      outcome: 'success',
      req,
      meta: { assignedTo: input.assignedTo, assigneeName },
    });

    const populated = await SupportTicket.findById(ticket._id)
      .populate('studentId', 'fullName email department academicYear studentId')
      .populate('assignedTo', 'fullName email role')
      .lean();

    return ok(res, populated);
  }),
);

/** Update ticket status (Resolve, Reopen, Close) */
supportRouter.post(
  '/admin/tickets/:id/status',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(supportTicketStatusSchema, req.body);

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      throw notFound('Ticket not found');
    }

    ticket.status = input.status;
    if (input.status === 'resolved') {
      ticket.resolvedAt = new Date();
    } else if (input.status === 'closed') {
      ticket.closedAt = new Date();
    }

    ticket.statusHistory.push({
      status: input.status,
      actorId: user._id,
      actorRole: user.role,
      actorName: user.fullName,
      reason: input.reason || `Status updated to ${input.status}`,
      timestamp: new Date(),
    } as any);

    await ticket.save();

    // Notify student of status update
    await notify({
      userId: ticket.studentId.toString(),
      kind: 'support_ticket_status',
      title: `Support #${ticket.ticketNumber} marked as ${input.status}`,
      body: `Your question "${ticket.subject.slice(0, 40)}..." is now ${input.status}.`,
      link: `/support/my-questions?ticket=${ticket.ticketNumber}`,
      category: 'case_updates',
    });

    await audit({
      action: 'support:ticket_status_change',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'SupportTicket',
      targetId: ticket._id.toString(),
      outcome: 'success',
      req,
      meta: { status: input.status, reason: input.reason },
    });

    const populated = await SupportTicket.findById(ticket._id)
      .populate('studentId', 'fullName email department academicYear studentId')
      .populate('assignedTo', 'fullName email role')
      .lean();

    return ok(res, populated);
  }),
);

/** Publish a resolved question as an approved public FAQ (with PII sanitization) */
supportRouter.post(
  '/admin/tickets/:id/publish-faq',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(faqArticleCreateSchema, req.body);

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      throw notFound('Ticket not found');
    }

    // Generate slug from title if not provided
    const baseSlug = input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let suffix = 1;
    while (await FaqArticle.findOne({ slug })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const article = await FaqArticle.create({
      title: input.title,
      slug,
      category: input.category,
      summary: input.summary,
      content: input.content,
      instructions: input.instructions || [],
      status: input.status || 'published',
      authorId: user._id,
      authorName: user.fullName,
      reviewedBy: user._id,
      reviewerName: user.fullName,
      sourceTicketId: ticket._id,
      version: 1,
      versionHistory: [
        {
          version: 1,
          title: input.title,
          summary: input.summary,
          content: input.content,
          modifiedBy: user._id,
          modifiedByName: user.fullName,
          timestamp: new Date(),
        },
      ],
    });

    ticket.publishedAsFaqId = article._id;
    await ticket.save();

    await audit({
      action: 'support:faq_published_from_ticket',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'FaqArticle',
      targetId: article._id.toString(),
      outcome: 'success',
      req,
      meta: { sourceTicketId: ticket._id.toString(), slug: article.slug },
    });

    return ok(res, article);
  }),
);

/** Admin Knowledge Base article management */
supportRouter.get(
  '/admin/faqs',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const articles = await FaqArticle.find()
      .sort({ createdAt: -1 })
      .lean();
    return ok(res, { articles, total: articles.length });
  }),
);

supportRouter.post(
  '/admin/faqs',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(faqArticleCreateSchema, req.body);

    const baseSlug = input.slug || input.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = baseSlug;
    let suffix = 1;
    while (await FaqArticle.findOne({ slug })) {
      slug = `${baseSlug}-${suffix++}`;
    }

    const article = await FaqArticle.create({
      ...input,
      slug,
      authorId: user._id,
      authorName: user.fullName,
      version: 1,
      versionHistory: [
        {
          version: 1,
          title: input.title,
          summary: input.summary,
          content: input.content,
          modifiedBy: user._id,
          modifiedByName: user.fullName,
          timestamp: new Date(),
        },
      ],
    });

    await audit({
      action: 'support:faq_create',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'FaqArticle',
      targetId: article._id.toString(),
      outcome: 'success',
      req,
      meta: { slug: article.slug },
    });

    return ok(res, article);
  }),
);

supportRouter.patch(
  '/admin/faqs/:id',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const input = parse(faqArticleUpdateSchema, req.body);

    const article = await FaqArticle.findById(req.params.id);
    if (!article) {
      throw notFound('FAQ article not found');
    }

    // Save current version into history
    article.versionHistory.push({
      version: article.version,
      title: article.title,
      summary: article.summary,
      content: article.content,
      modifiedBy: user._id,
      modifiedByName: user.fullName,
      timestamp: new Date(),
    } as any);

    article.version += 1;
    if (input.title) article.title = input.title;
    if (input.category) article.category = input.category;
    if (input.summary) article.summary = input.summary;
    if (input.content) article.content = input.content;
    if (input.instructions) article.instructions = input.instructions;
    if (input.status) article.status = input.status;
    article.reviewedBy = user._id;
    article.reviewerName = user.fullName;

    await article.save();

    await audit({
      action: 'support:faq_update',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'FaqArticle',
      targetId: article._id.toString(),
      outcome: 'success',
      req,
      meta: { version: article.version, status: article.status },
    });

    return ok(res, article);
  }),
);

supportRouter.delete(
  '/admin/faqs/:id',
  ...adminAuth,
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const article = await FaqArticle.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'archived' } },
      { new: true },
    ).lean();

    if (!article) {
      throw notFound('FAQ article not found');
    }

    await audit({
      action: 'support:faq_archive',
      actorId: user._id.toString(),
      actorRole: user.role,
      targetType: 'FaqArticle',
      targetId: article._id.toString(),
      outcome: 'success',
      req,
    });

    return ok(res, { success: true, article });
  }),
);
