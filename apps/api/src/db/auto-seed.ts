import { env } from '../config/env';
import { randomUUID } from 'node:crypto';
import { CATEGORY_INFO, COMMITTEE_TYPE_LABELS, INCIDENT_CATEGORIES, type CommitteeType } from '@campuscare/shared';
import { encryptSecret, hashPassword, randomToken } from '../lib/crypto';
import { Committee, Incident, RoutingRule } from '../models/incident';
import { DutyShift, ResponderAvailability } from '../models/duty';
import { Contact, Announcement, TrainingModule } from '../models/content';
import { ChatChannel, ChatMembership, ChatMessage } from '../models/chat';
import { EmailDomain, EmailProviderConfig, IdentityProviderConfig, SystemSetting } from '../models/platform';
import { User } from '../models/user';
import { Appointment, Availability, CounsellingCase, CounsellingNote, CounsellingResource } from '../models/counselling';
import { EmergencyAlert } from '../models/safety';
import { PatrolRoute } from '../models/patrol';
import { createIncident } from '../services/incident.service';
import { seedFaqArticlesIfEmpty } from '../services/support-seed';
import { logger } from '../lib/logger';

export async function autoSeedDatabase() {
  try {
    // 0. Disable Turnstile and mandatory MFA for smooth local dev / testing
    await SystemSetting.findOneAndUpdate(
      { key: 'platform' },
      {
        $set: {
          'value.turnstile.enabled': Boolean(env.TURNSTILE_SECRET && env.TURNSTILE_SECRET !== '1x0000000000000000000000000000000AA'),
          'value.security.requireMfaForSuperAdmin': false,
          'value.duty.allowDutyWithoutShift': true,
          'value.turnstile.forms.login': true,
          'value.turnstile.forms.register': true,
          'value.turnstile.forms.forgotPassword': true,
          'value.turnstile.forms.resetPassword': true,
          'value.turnstile.forms.resendVerification': true,
          'value.turnstile.forms.incidentSubmit': true,
        },
      },
      { upsert: true },
    );
    // 1. Email domains
    await EmailDomain.findOneAndUpdate(
      { domain: 'srmap.edu.in' },
      {
        $setOnInsert: {
          domain: 'srmap.edu.in',
          purpose: 'both',
          status: 'active',
          verifiedAt: new Date(),
          verificationToken: randomToken(18),
          note: 'SRM University-AP (Auto-seeded)',
        },
      },
      { upsert: true },
    );
    await EmailDomain.findOneAndUpdate(
      { domain: 'gmail.com' },
      {
        $setOnInsert: {
          domain: 'gmail.com',
          purpose: 'both',
          status: 'active',
          verifiedAt: new Date(),
          verificationToken: randomToken(18),
          note: 'Gmail (Auto-seeded for Google OAuth)',
        },
      },
      { upsert: true },
    );

    // 1b. Active Nodemailer Email Provider Config
    const mailUser = env.MAIL_USER || 'neelampallicharanbalaji14@gmail.com';
    const mailPass = env.MAIL_APP_PASSWORD || 'hwipnbegmfaoxfju';
    await EmailProviderConfig.findOneAndUpdate(
      { active: true },
      {
        $set: {
          type: 'nodemailer',
          service: env.MAIL_SERVICE || 'gmail',
          fromName: env.EMAIL_FROM_NAME || 'CampusCare',
          fromEmail: env.EMAIL_FROM || mailUser,
          authUser: mailUser,
          authPassEnc: encryptSecret(mailPass),
          active: true,
        },
      },
      { upsert: true },
    );

    // 1c. Google OAuth 2.0 Provider Config (read from environment, never hardcode in repository)
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      await IdentityProviderConfig.findOneAndUpdate(
        { provider: 'google' },
        {
          $set: {
            provider: 'google',
            enabled: true,
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecretEnc: encryptSecret(process.env.GOOGLE_CLIENT_SECRET),
            allowedDomains: [],
          },
        },
        { upsert: true },
      );
    }

    // 2. Committees & Routing rules
    const committees: Record<string, { _id: unknown }> = {};
    const confidential: CommitteeType[] = ['gender_sensitivity', 'anti_ragging'];
    for (const type of Object.keys(COMMITTEE_TYPE_LABELS) as CommitteeType[]) {
      if (type === 'other') continue;
      const categories = INCIDENT_CATEGORIES.filter((c) => CATEGORY_INFO[c].defaultCommittee === type);
      const c = await Committee.findOneAndUpdate(
        { name: COMMITTEE_TYPE_LABELS[type] },
        {
          $setOnInsert: {
            name: COMMITTEE_TYPE_LABELS[type],
            type,
            categories,
            confidential: confidential.includes(type),
            mandate: `Handles ${categories.map((x) => CATEGORY_INFO[x].label.toLowerCase()).join(', ') || 'referred'} matters under university policy.`,
            active: true,
          },
        },
        { upsert: true, new: true },
      );
      committees[type] = c!;
    }
    for (const category of INCIDENT_CATEGORIES) {
      const target = committees[CATEGORY_INFO[category].defaultCommittee];
      if (target) {
        await RoutingRule.findOneAndUpdate(
          { category },
          { $setOnInsert: { category, committeeId: target._id, defaultPriority: CATEGORY_INFO[category].sensitive ? 'high' : 'normal' } },
          { upsert: true },
        );
      }
    }

    // 3. Contacts
    const contacts = [
      { name: 'National Emergency Response (ERSS)', purpose: 'Police, fire and medical emergencies', category: 'emergency', phone: '112', verified: true, emergency: true, hours: '24/7', order: 1 },
      { name: 'Ambulance', purpose: 'Emergency ambulance (most states)', category: 'medical', phone: '108', verified: true, emergency: true, hours: '24/7', order: 2 },
      { name: 'Women Helpline', purpose: 'Support for women facing violence or harassment', category: 'helpline', phone: '181', verified: true, hours: '24/7', order: 3 },
      { name: 'National Anti-Ragging Helpline (UGC)', purpose: 'Report ragging to the national helpline', category: 'helpline', phone: '1800-180-5522', email: 'helpline@antiragging.in', verified: true, hours: '24/7, toll free', order: 4 },
      { name: 'Tele-MANAS', purpose: 'Free, confidential mental health support', category: 'helpline', phone: '14416', verified: true, hours: '24/7', order: 5 },
      { name: 'Cyber Crime Helpline', purpose: 'Online fraud and cyber crime (cybercrime.gov.in)', category: 'helpline', phone: '1930', verified: true, hours: '24/7', order: 6 },
      { name: 'Campus Security Control Room', purpose: 'On-campus security emergencies and escorts', category: 'security', verified: true, phone: '0863-2343000', emergency: true, order: 10 },
      { name: 'Campus Health Centre', purpose: 'First aid and medical assistance', category: 'medical', verified: true, phone: '0863-2343001', emergency: true, order: 11 },
      { name: 'Counselling Centre', purpose: 'Confidential counselling and wellbeing', category: 'counselling', verified: true, phone: '0863-2343002', order: 20 },
      { name: 'Hostel Office', purpose: 'Hostel safety and warden contact', category: 'hostel', verified: true, phone: '0863-2343003', order: 21 },
    ];
    for (const c of contacts) await Contact.findOneAndUpdate({ name: c.name }, { $setOnInsert: c }, { upsert: true });

    // 4. Chat channels
    const channels = [
      { kind: 'community', name: 'Campus General', slug: 'general', description: 'General questions about campus life. Be kind — moderated.', published: true, order: 0 },
      { kind: 'community', name: 'Safety Tips', slug: 'safety-tips', description: 'Share safety information and awareness resources.', published: true, order: 1 },
      { kind: 'community', name: 'Official Updates', slug: 'official', description: 'Read-only updates from the university.', published: true, readOnly: true, order: 2 },
      { kind: 'support_service', name: 'Talk to a Counsellor', slug: 'counsellor-chat', description: 'Private chat with the counselling team.', published: true, serviceRole: 'counsellor', order: 0 },
      { kind: 'support_service', name: 'Campus Security Desk', slug: 'security-desk', description: 'Non-emergency questions for campus security. In an emergency use SOS or call 112.', published: true, serviceRole: 'security_officer', order: 1 },
    ];
    for (const ch of channels) await ChatChannel.findOneAndUpdate({ slug: ch.slug }, { $setOnInsert: ch }, { upsert: true });

    // 5. Training modules
    const modules = [
      {
        title: 'Understanding ragging', category: 'Anti-ragging', summary: 'What ragging is, why it is prohibited and how to get help.', durationMinutes: 8, published: true,
        sections: [
          { heading: 'What counts as ragging', body: 'Any act that teases, harasses, intimidates or humiliates a student, or forces them to do something against their will.' },
          { heading: 'Getting help', body: 'Report it in CampusCare or call the National Anti-Ragging Helpline on 1800-180-5522.' },
        ],
        quiz: [
          { question: 'Which of these can be ragging?', options: ['Forcing a junior to perform in a corridor', 'Helping a junior find a classroom'], correctIndex: 0 },
          { question: 'The National Anti-Ragging Helpline is…', options: ['1800-180-5522', '100', '1098'], correctIndex: 0 },
        ],
      },
      {
        title: 'Consent and respectful conduct', category: 'Gender sensitivity', summary: 'Recognising consent, boundaries and respectful behaviour.', durationMinutes: 10, published: true,
        sections: [{ heading: 'Consent', body: 'Consent is clear, freely given and can be withdrawn at any time.' }],
        quiz: [{ question: 'Can consent be withdrawn after it is given?', options: ['Yes, at any time', 'No'], correctIndex: 0 }],
      },
    ];
    for (const m of modules) await TrainingModule.findOneAndUpdate({ title: m.title }, { $setOnInsert: m }, { upsert: true });

    // 6. User Account: charanbalaji_neelampalli@srmap.edu.in
    // The seed password is only set when an account is first created ($setOnInsert). Overwriting it
    // on every start would silently undo password resets and changes made since.
    const charanHash = await hashPassword('Charan@123');
    const charanUser = await User.findOneAndUpdate(
      { email: 'charanbalaji_neelampalli@srmap.edu.in' },
      {
        $setOnInsert: { passwordHash: charanHash },
        $set: {
          fullName: 'Charan Balaji Neelampalli',
          role: 'super_admin',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          accountStatus: 'active',
          failedLoginCount: 0,
        },
      },
      { upsert: true, new: true },
    );

    // Also seed neelampallicharanbalaji14@gmail.com as Super Admin
    await User.findOneAndUpdate(
      { email: 'neelampallicharanbalaji14@gmail.com' },
      {
        $setOnInsert: { passwordHash: charanHash },
        $set: {
          fullName: 'Charan Balaji',
          role: 'super_admin',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          accountStatus: 'active',
          failedLoginCount: 0,
        },
      },
      { upsert: true },
    );

    // Consultant / Counsellor availability for Charan
    await Availability.findOneAndUpdate(
      { counsellorId: charanUser!._id },
      {
        $set: {
          weekly: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
          slotMinutes: 50,
          timezone: 'Asia/Kolkata',
          acceptingRequests: true,
          title: 'Lead Consultant & Counsellor',
          bio: 'CampusCare Senior Consultant & Lead Counsellor.',
        },
      },
      { upsert: true },
    );

    // 7. Demo accounts for testing with password Charan@123
    const demo = [
      { fullName: 'Asha Demo (Student)', email: 'cc-demo-student@srmap.edu.in', role: 'student', studentId: 'DEMO-0001', department: 'Computer Science & Engineering', academicYear: 3 },
      { fullName: 'Dr. Meera Sharma', email: 'cc-demo-counsellor@srmap.edu.in', role: 'counsellor', designation: 'Counsellor', department: 'Student Wellbeing Centre', campusZone: 'Main Campus' },
      { fullName: 'Officer Kumar', email: 'cc-demo-security@srmap.edu.in', role: 'security_officer', designation: 'Security Officer', department: 'Campus Safety & Security', campusZone: 'Main Campus', phone: '+91 98765 00001', memberships: [{ committeeId: committees.security?._id, position: 'member' }] },
      { fullName: 'Dr. Priya Nair', email: 'cc-demo-committee@srmap.edu.in', role: 'committee_member', designation: 'Committee Member', department: 'Internal Complaints Committee', campusZone: 'Main Campus', phone: '+91 98765 00002', memberships: [{ committeeId: committees.gender_sensitivity?._id, position: 'member' }, { committeeId: committees.anti_ragging?._id, position: 'member' }] },
      { fullName: 'Admin Demo', email: 'cc-demo-admin@srmap.edu.in', role: 'admin' },
      { fullName: 'Ananya Reddy', email: 'ananya.reddy@srmap.edu.in', role: 'student', studentId: 'CSE22045', department: 'Computer Science', academicYear: 2, campusZone: 'Main Campus', phone: '+91 98765 43210' },
      { fullName: 'Rohit Kumar', email: 'rohit.kumar@srmap.edu.in', role: 'student', studentId: 'ECE23012', department: 'Electronics & Communication', academicYear: 1, campusZone: 'Main Campus' },
      { fullName: 'Priya Nair', email: 'priya.nair@srmap.edu.in', role: 'student', studentId: 'CSE22098', department: 'Computer Science & Engineering', academicYear: 2, campusZone: 'Main Campus' },
      { fullName: 'Aditya Verma', email: 'aditya.verma@srmap.edu.in', role: 'student', studentId: 'ECE23045', department: 'Electronics & Communication', academicYear: 1, campusZone: 'Main Campus' },
      { fullName: 'Kavya S', email: 'kavya.s@srmap.edu.in', role: 'student', studentId: 'BBA21004', department: 'Business Administration', academicYear: 3, campusZone: 'Main Campus' },
      { fullName: 'Sneha Iyer', email: 'sneha.iyer@srmap.edu.in', role: 'student', studentId: 'CSE22019', department: 'Computer Science', academicYear: 2, campusZone: 'Main Campus' },
      { fullName: 'Vikram Patel', email: 'vikram.patel@srmap.edu.in', role: 'student', studentId: 'MEC21088', department: 'Mechanical Engineering', academicYear: 3, campusZone: 'Main Campus' },
    ];
    for (const d of demo) {
      const { memberships, ...rest } = d as typeof d & { memberships?: unknown[] };
      const u = await User.findOneAndUpdate(
        { email: d.email },
        {
          $setOnInsert: { passwordHash: charanHash },
          $set: {
            ...rest,
            // The cc-demo-* mailboxes do not exist: notification emails to them only bounce (550 5.1.1).
            'privacy.allowEmailNotifications': false,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            accountStatus: 'active',
            failedLoginCount: 0,
            committeeMemberships: memberships ?? [],
          },
        },
        { upsert: true, new: true },
      );
      if (d.role === 'security_officer') {
        const now = new Date();
        await ResponderAvailability.findOneAndUpdate(
          { userId: u!._id },
          {
            $set: {
              userId: u!._id,
              status: 'on_duty',
              campus: 'main',
              responsibilities: ['sos_response', 'patrol'],
              skills: ['first_aid', 'fire_safety', 'de_escalation'],
              locationConsent: true,
              statusChangedAt: now,
            },
          },
          { upsert: true },
        );

        const shiftStart = new Date(now.getTime() - 2 * 3600_000);
        const shiftEnd = new Date(now.getTime() + 10 * 3600_000);
        if (!(await DutyShift.exists({ responderId: u!._id, status: { $in: ['accepted', 'active'] }, endAt: { $gt: now } }))) {
          await DutyShift.create({
            responderId: u!._id,
            startAt: shiftStart,
            endAt: shiftEnd,
            campus: 'main',
            status: 'accepted',
            notes: 'Standard campus security rotation shift',
          });
        }
      }
      if (d.role === 'counsellor') {
        await Availability.findOneAndUpdate(
          { counsellorId: u!._id },
          {
            $set: {
              weekly: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '10:00', end: '16:00' })),
              slotMinutes: 50,
              timezone: 'Asia/Kolkata',
              acceptingRequests: true,
              title: 'Senior Counsellor',
              bio: 'Counselling and psychological support.',
            },
          },
          { upsert: true },
        );
      }
    }

    // Sample incident for testing: created once, not on every start (each one emailed a mailbox that does not exist).
    const studentUser = await User.findOne({ email: 'cc-demo-student@srmap.edu.in' });
    if (studentUser && !(await Incident.exists({ reporterId: studentUser._id }))) {
      await createIncident(studentUser, {
        category: 'ragging',
        title: 'Seniors forcing juniors to perform (Sample Case)',
        description: 'Sample incident report for consultant and committee testing.',
        location: 'Hostel Block B',
        anonymous: false,
        incidentDate: new Date(Date.now() - 86400_000),
        severity: 'medium',
        urgent: false,
        preferredContact: 'in_app',
        idempotencyKey: randomUUID(),
      }).catch(() => undefined);
    }

    // Sample official announcement
    if (charanUser && !(await Announcement.exists({ title: 'Campus Wellness & Student Support Services Open' }))) {
      await Announcement.create({
        title: 'Campus Wellness & Student Support Services Open',
        body: 'The Student Wellbeing & Counselling Centre is available across campus and online. Reach out anytime through CampusCare Chats.',
        category: 'general',
        priority: 'standard',
        campus: 'all',
        targetRoles: ['all'],
        pinned: true,
        status: 'published',
        publishedAt: new Date(),
        authorId: charanUser._id,
      });
    }

    // Sample student conversation for counselling inbox
    const meeraUser = await User.findOne({ email: 'cc-demo-counsellor@srmap.edu.in' });
    if (studentUser && (charanUser || meeraUser) && !(await ChatChannel.exists({ kind: 'counselling_thread', studentId: studentUser._id }))) {
      const assignedStaff = meeraUser || charanUser;
      const thread = await ChatChannel.create({
        kind: 'counselling_thread',
        studentId: studentUser._id,
        name: 'Wellbeing Consultation & Academic Balance',
        assignedStaffId: assignedStaff!._id,
        published: true,
        createdBy: studentUser._id,
        lastMessageAt: new Date(),
      });
      await ChatMembership.insertMany([
        { channelId: thread._id, userId: studentUser._id, role: 'student', lastReadAt: new Date(Date.now() - 3600_000) },
        { channelId: thread._id, userId: assignedStaff!._id, role: 'staff', lastReadAt: new Date(0) },
      ]);
      await ChatMessage.create({
        channelId: thread._id,
        senderId: studentUser._id,
        senderLabel: studentUser.fullName,
        body: 'Hello, I would like guidance on managing academic workload and semester stress.',
        clientMessageId: randomUUID(),
        createdAt: new Date(),
      });
    }

    // 8. Seed Counselling Resources Library
    const sampleResources = [
      {
        title: 'Managing Academic Stress',
        category: 'academic',
        type: 'article',
        readTime: 'Article • 5 min read',
        summary: 'Evidence-based cognitive restructuring and practical study-scheduling techniques for midterms.',
        content: 'College academics often present overlapping deadlines. Break assignments into 25-minute sprints using the Pomodoro technique. Prioritize tasks by urgency and impact rather than anxiety level.',
        tags: ['Academic Stress', 'Study Habits', 'Time Management'],
        order: 1,
      },
      {
        title: 'Anxiety Relief Techniques',
        category: 'mental_health',
        type: 'video',
        readTime: 'Video • 8 min',
        summary: 'Guided grounding exercises (5-4-3-2-1 sensory orientation) and diaphragmatic breathing.',
        content: 'When feeling overwhelmed, practice diaphragmatic breathing: inhale for 4 seconds, hold for 4, exhale slowly for 6 seconds. This activates the parasympathetic nervous system.',
        tags: ['Anxiety', 'Grounding', 'Wellness'],
        order: 2,
      },
      {
        title: 'Career Planning Guide',
        category: 'career',
        type: 'pdf',
        fileSize: '2.4 MB',
        readTime: 'PDF • 2.4 MB',
        summary: 'A step-by-step career path discovery tool designed for first-to-final-year students.',
        content: 'Comprehensive roadmap for evaluating industry interests, resume readiness, networking strategies, and campus placement prep.',
        tags: ['Career', 'Guidance', 'Planning'],
        order: 3,
      },
      {
        title: 'Mindfulness for Students',
        category: 'mindfulness',
        type: 'article',
        readTime: 'Article • 6 min read',
        summary: 'Simple, practical mindfulness micro-practices to build focus and calm during lectures.',
        content: 'Take three conscious breaths before each lecture. Notice physical tension in your shoulders and jaw, and deliberately release it with every exhale.',
        tags: ['Mindfulness', 'Focus', 'Meditation'],
        order: 4,
      },
      {
        title: 'Healthy Lifestyle Tips',
        category: 'healthy_habits',
        type: 'article',
        readTime: 'Article • 4 min read',
        summary: 'Sleep hygiene, balanced cafeteria nutrition, and physical movement habits for students.',
        content: 'Protect 7 hours of sleep each night. Limit caffeine intake after 4 PM. Regular 20-minute daily walks noticeably improve concentration and emotional resilience.',
        tags: ['Healthy Habits', 'Sleep', 'Nutrition'],
        order: 5,
      },
    ];
    for (const r of sampleResources) {
      await CounsellingResource.findOneAndUpdate({ title: r.title }, { $setOnInsert: r }, { upsert: true });
    }

    // 9. Seed Appointments, Requests and Cases for Dr. Meera Sharma
    const meera = await User.findOne({ email: 'cc-demo-counsellor@srmap.edu.in' });
    const ananya = await User.findOne({ email: 'ananya.reddy@srmap.edu.in' });
    const rohit = await User.findOne({ email: 'rohit.kumar@srmap.edu.in' });
    const priya = await User.findOne({ email: 'priya.nair@srmap.edu.in' });
    const aditya = await User.findOne({ email: 'aditya.verma@srmap.edu.in' });
    const kavya = await User.findOne({ email: 'kavya.s@srmap.edu.in' });
    const sneha = await User.findOne({ email: 'sneha.iyer@srmap.edu.in' });
    const vikram = await User.findOne({ email: 'vikram.patel@srmap.edu.in' });

    if (meera && ananya) {
      const today = new Date();
      const setTime = (hours: number, mins: number) => {
        const d = new Date(today);
        d.setHours(hours, mins, 0, 0);
        return d;
      };

      // Appointment 1: Ananya Reddy (10:00 AM - 11:00 AM Online)
      await Appointment.findOneAndUpdate(
        { studentId: ananya._id, counsellorId: meera._id, startAt: setTime(10, 0) },
        {
          $setOnInsert: {
            studentId: ananya._id,
            counsellorId: meera._id,
            startAt: setTime(10, 0),
            endAt: setTime(11, 0),
            mode: 'online',
            counsellingType: 'individual_counselling',
            status: 'confirmed',
            reason: 'Exam stress and study habit balance',
            meetingLink: 'https://meet.srmap.edu.in/counsel-ananya',
            idempotencyKey: 'seed-appt-ananya-1',
          },
        },
        { upsert: true },
      );

      // Appointment 2: Rohit Kumar (11:30 AM - 12:30 PM In-person Room 203)
      if (rohit) {
        await Appointment.findOneAndUpdate(
          { studentId: rohit._id, counsellorId: meera._id, startAt: setTime(11, 30) },
          {
            $setOnInsert: {
              studentId: rohit._id,
              counsellorId: meera._id,
              startAt: setTime(11, 30),
              endAt: setTime(12, 30),
              mode: 'in_person',
              counsellingType: 'follow_up_session',
              status: 'confirmed',
              reason: 'Room 203 - Follow up on anxiety progress',
              idempotencyKey: 'seed-appt-rohit-1',
            },
          },
          { upsert: true },
        );
      }

      // Appointment 3: Sneha Iyer (02:00 PM - 03:00 PM Room 105)
      if (sneha) {
        await Appointment.findOneAndUpdate(
          { studentId: sneha._id, counsellorId: meera._id, startAt: setTime(14, 0) },
          {
            $setOnInsert: {
              studentId: sneha._id,
              counsellorId: meera._id,
              startAt: setTime(14, 0),
              endAt: setTime(15, 0),
              mode: 'in_person',
              counsellingType: 'career_guidance',
              status: 'confirmed',
              reason: 'Room 105 - Career transition support',
              idempotencyKey: 'seed-appt-sneha-1',
            },
          },
          { upsert: true },
        );
      }

      // Appointment 4: Vikram Patel (04:00 PM - 05:00 PM Online)
      if (vikram) {
        await Appointment.findOneAndUpdate(
          { studentId: vikram._id, counsellorId: meera._id, startAt: setTime(16, 0) },
          {
            $setOnInsert: {
              studentId: vikram._id,
              counsellorId: meera._id,
              startAt: setTime(16, 0),
              endAt: setTime(17, 0),
              mode: 'online',
              counsellingType: 'anxiety_support',
              status: 'confirmed',
              reason: 'Anxiety coping strategies',
              meetingLink: 'https://meet.srmap.edu.in/counsel-vikram',
              idempotencyKey: 'seed-appt-vikram-1',
            },
          },
          { upsert: true },
        );
      }

      // Requests: Priya Nair, Aditya Verma, Kavya S
      if (priya) {
        await Appointment.findOneAndUpdate(
          { studentId: priya._id, status: 'requested' },
          {
            $setOnInsert: {
              studentId: priya._id,
              counsellorId: meera._id,
              startAt: setTime(10, 0),
              mode: 'in_person',
              counsellingType: 'counseling',
              status: 'requested',
              reason: 'Anxiety & Stress, Academic Pressure',
              idempotencyKey: 'seed-req-priya',
            },
          },
          { upsert: true },
        );
      }
      if (aditya) {
        await Appointment.findOneAndUpdate(
          { studentId: aditya._id, status: 'requested' },
          {
            $setOnInsert: {
              studentId: aditya._id,
              counsellorId: meera._id,
              startAt: setTime(14, 0),
              mode: 'online',
              counsellingType: 'career_guidance',
              status: 'requested',
              reason: 'Career Confusion',
              idempotencyKey: 'seed-req-aditya',
            },
          },
          { upsert: true },
        );
      }
      if (kavya) {
        await Appointment.findOneAndUpdate(
          { studentId: kavya._id, status: 'requested' },
          {
            $setOnInsert: {
              studentId: kavya._id,
              counsellorId: meera._id,
              startAt: setTime(15, 0),
              mode: 'in_person',
              counsellingType: 'personal_support',
              status: 'requested',
              reason: 'Personal Issues',
              idempotencyKey: 'seed-req-kavya',
            },
          },
          { upsert: true },
        );
      }

      // Cases for Screen 7
      const sampleCases = [
        {
          caseNumber: 'CC-CS-2026-0012',
          studentId: ananya._id,
          counsellorId: meera._id,
          status: 'active',
          priority: 'normal',
          concern: 'Academic Stress',
          tags: ['Academic Stress', 'Anxiety', 'Time Management'],
          keyObservations: ['Anxiety about exams', 'Low confidence'],
          supportPlan: ['Practice daily 10-minute mindfulness breathing', 'Establish regular study schedule and breaks', 'Follow-up in 2 weeks'],
          reviewDate: new Date(Date.now() + 14 * 86_400_000),
          timeline: [
            { action: 'Case Opened', note: 'Initial assessment conducted', actorId: meera._id, actorName: meera.fullName, at: new Date(Date.now() - 18 * 86_400_000) },
          ],
        },
        rohit && {
          caseNumber: 'CC-CS-2026-0009',
          studentId: rohit._id,
          counsellorId: meera._id,
          status: 'active',
          priority: 'normal',
          concern: 'Anxiety & Wellbeing',
          tags: ['Anxiety & Wellbeing', 'Stress'],
          keyObservations: ['Difficulty unwinding after practicals'],
          supportPlan: ['Gradual exposure techniques', 'Sleep schedule consistency'],
          timeline: [{ action: 'Case Opened', note: 'Referred by tutor', actorId: meera._id, actorName: meera.fullName, at: new Date(Date.now() - 30 * 86_400_000) }],
        },
        sneha && {
          caseNumber: 'CC-CS-2026-0008',
          studentId: sneha._id,
          counsellorId: meera._id,
          status: 'follow_up',
          priority: 'normal',
          concern: 'Career Guidance',
          tags: ['Career Guidance', 'Internship Prep'],
          keyObservations: ['Unsure about industry specialization vs higher studies'],
          supportPlan: ['Review departmental internship roadmap', 'Follow-up consultation'],
          timeline: [{ action: 'Case Opened', note: 'Career discovery started', actorId: meera._id, actorName: meera.fullName, at: new Date(Date.now() - 43 * 86_400_000) }],
        },
        vikram && {
          caseNumber: 'CC-CS-2026-0005',
          studentId: vikram._id,
          counsellorId: meera._id,
          status: 'active',
          priority: 'normal',
          concern: 'Personal Issues',
          tags: ['Personal Issues', 'Homesickness'],
          keyObservations: ['First time staying in hostel, adjusting to campus routine'],
          supportPlan: ['Weekly check-ins', 'Joining campus club activities'],
          timeline: [{ action: 'Case Opened', note: 'Hostel warden assisted referral', actorId: meera._id, actorName: meera.fullName, at: new Date(Date.now() - 59 * 86_400_000) }],
        },
      ].filter(Boolean);

      for (const cs of sampleCases) {
        if (!cs) continue;
        await CounsellingCase.findOneAndUpdate({ caseNumber: cs.caseNumber }, { $setOnInsert: cs }, { upsert: true });
      }

      // Seed Conversations for Messages Screen (Screen 10)
      const chatSeed = [
        { student: ananya, preview: 'Thank you for today’s session!', unread: 2 },
        { student: rohit, preview: 'See you tomorrow.', unread: 0 },
        { student: kavya, preview: 'I have a question about the exercise.', unread: 0 },
        { student: aditya, preview: 'Thank you!', unread: 0 },
      ];

      for (const ch of chatSeed) {
        if (!ch.student) continue;
        const exists = await ChatChannel.findOne({ kind: 'counselling_thread', studentId: ch.student._id });
        if (!exists) {
          const t = await ChatChannel.create({
            kind: 'counselling_thread',
            studentId: ch.student._id,
            name: `Consultation: ${ch.student.fullName}`,
            assignedStaffId: meera._id,
            published: true,
            createdBy: ch.student._id,
            lastMessageAt: new Date(),
          });
          await ChatMembership.insertMany([
            { channelId: t._id, userId: ch.student._id, role: 'student', lastReadAt: new Date() },
            { channelId: t._id, userId: meera._id, role: 'staff', lastReadAt: ch.unread > 0 ? new Date(0) : new Date() },
          ]);
          await ChatMessage.create({
            channelId: t._id,
            senderId: ch.student._id,
            senderLabel: ch.student.fullName,
            body: ch.preview,
            clientMessageId: randomUUID(),
            createdAt: new Date(),
          });
        }
      }
    }

    // 10. Seed SOS Alert #2026-1042 and Patrol Route for Security Officer Portal
    const ananyaUser = await User.findOne({ email: 'ananya.reddy@srmap.edu.in' });
    const kumarUser = await User.findOne({ email: 'cc-demo-security@srmap.edu.in' });
    if (ananyaUser && kumarUser) {
      const existingSos = await EmergencyAlert.findOne({ alertNumber: '#2026-1042' });
      if (!existingSos) {
        await EmergencyAlert.create({
          alertNumber: '#2026-1042',
          userId: ananyaUser._id,
          status: 'en_route',
          severity: 'high',
          assignedTo: kumarUser._id,
          latitude: 16.4636,
          longitude: 80.5074,
          locationLabel: 'Library Block - Room 202',
          note: 'I feel unsafe. Someone is following me near the library.',
          idempotencyKey: 'seed-sos-2026-1042',
          acknowledgedAt: new Date(Date.now() - 120_000),
          enRouteAt: new Date(Date.now() - 60_000),
          events: [
            { type: 'created', at: new Date(Date.now() - 180_000), actorId: ananyaUser._id, actorLabel: ananyaUser.fullName, studentVisible: true },
            { type: 'acknowledged', at: new Date(Date.now() - 120_000), actorId: kumarUser._id, actorLabel: 'Officer Kumar (Security)', studentVisible: true },
            { type: 'en_route', at: new Date(Date.now() - 60_000), actorId: kumarUser._id, actorLabel: 'Officer Kumar (Security)', studentVisible: true },
          ],
        });
      }

      const existingPatrol = await PatrolRoute.findOne({ campus: 'main', status: 'in_progress' });
      if (!existingPatrol) {
        await PatrolRoute.create({
          name: 'Main Campus Patrol',
          campus: 'main',
          shiftTime: '09:00 AM - 05:00 PM',
          status: 'in_progress',
          assignedOfficerId: kumarUser._id,
          assignedOfficerName: kumarUser.fullName,
          checkpoints: [
            { name: 'Main Gate', requiredTime: '09:05 AM', status: 'completed', completedAt: new Date(Date.now() - 3600_000), locationLabel: 'Main Entrance Gate' },
            { name: 'Library', requiredTime: '09:28 AM', status: 'completed', completedAt: new Date(Date.now() - 1800_000), locationLabel: 'Central Library Block' },
            { name: 'Academic Block', requiredTime: '10:15 AM', status: 'pending', locationLabel: 'Academic Complex A' },
            { name: 'Hostel Block', requiredTime: '11:00 AM', status: 'pending', locationLabel: 'Hostel Block B' },
            { name: 'Sports Complex', requiredTime: '12:00 PM', status: 'pending', locationLabel: 'Athletic Ground & Arena' },
            { name: 'Cafeteria', requiredTime: '01:00 PM', status: 'pending', locationLabel: 'Central Dining Hall' },
          ],
        });
      }
    }

    // 11. Seed Incident Reports for Committee Member Portal
    const priyaUser = await User.findOne({ email: 'cc-demo-committee@srmap.edu.in' });
    const rohitUser = await User.findOne({ email: 'rohit.kumar@srmap.edu.in' });
    if (ananyaUser && priyaUser) {
      const sampleReports = [
        {
          caseNumber: '#2026-0871',
          category: 'harassment',
          title: 'Harassment near library',
          description: 'A student reported inappropriate behaviour from another student near the library.',
          location: 'Library Block',
          incidentDate: new Date(Date.now() - 86400_000),
          reporterId: ananyaUser._id,
          status: 'submitted',
          severity: 'high',
          priority: 'urgent',
          urgent: true,
          assignedTo: priyaUser._id,
          idempotencyKey: 'seed-rep-2026-0871',
        },
        {
          caseNumber: '#2026-0865',
          category: 'property_damage',
          title: 'Damaged lab equipment',
          description: 'Broken display monitor reported in laboratory 3.',
          location: 'Hostel Block C',
          incidentDate: new Date(Date.now() - 2 * 86400_000),
          reporterId: rohitUser?._id || ananyaUser._id,
          status: 'in_review',
          severity: 'medium',
          priority: 'normal',
          assignedTo: priyaUser._id,
          idempotencyKey: 'seed-rep-2026-0865',
        },
        {
          caseNumber: '#2026-0861',
          category: 'theft_vandalism',
          title: 'Missing sports equipment',
          description: 'Equipment locker in sports arena found damaged.',
          location: 'Sports Complex',
          incidentDate: new Date(Date.now() - 3 * 86400_000),
          reporterId: ananyaUser._id,
          status: 'investigating',
          severity: 'medium',
          priority: 'normal',
          assignedTo: priyaUser._id,
          idempotencyKey: 'seed-rep-2026-0861',
        },
        {
          caseNumber: '#2026-0859',
          category: 'academic_misconduct',
          title: 'Academic integrity inquiry',
          description: 'Report regarding unauthorized examination materials.',
          location: 'Academic Complex',
          incidentDate: new Date(Date.now() - 4 * 86400_000),
          reporterId: rohitUser?._id || ananyaUser._id,
          status: 'investigating',
          severity: 'medium',
          priority: 'normal',
          assignedTo: priyaUser._id,
          idempotencyKey: 'seed-rep-2026-0859',
        },
        {
          caseNumber: '#2026-0856',
          category: 'other',
          title: 'Noise disturbance inquiry',
          description: 'Resolved complaint regarding late night noise in courtyard.',
          location: 'Hostel Courtyard',
          incidentDate: new Date(Date.now() - 5 * 86400_000),
          reporterId: ananyaUser._id,
          status: 'closed',
          severity: 'low',
          priority: 'low',
          assignedTo: priyaUser._id,
          resolvedAt: new Date(Date.now() - 2 * 86400_000),
          closedAt: new Date(Date.now() - 86400_000),
          idempotencyKey: 'seed-rep-2026-0856',
        },
      ];

      for (const rep of sampleReports) {
        await Incident.findOneAndUpdate({ caseNumber: rep.caseNumber }, { $setOnInsert: rep }, { upsert: true });
      }
    }

    await seedFaqArticlesIfEmpty();
    logger.info('Auto-seed completed: charanbalaji_neelampalli@srmap.edu.in provisioned with password Charan@123');
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Auto-seed failed');
  }
}
