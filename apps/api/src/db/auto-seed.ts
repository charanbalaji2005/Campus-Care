import { randomUUID } from 'node:crypto';
import { CATEGORY_INFO, COMMITTEE_TYPE_LABELS, INCIDENT_CATEGORIES, type CommitteeType } from '@campuscare/shared';
import { hashPassword, randomToken } from '../lib/crypto';
import { Committee, RoutingRule } from '../models/incident';
import { Contact, Announcement, TrainingModule } from '../models/content';
import { ChatChannel } from '../models/chat';
import { EmailDomain } from '../models/platform';
import { User } from '../models/user';
import { Availability } from '../models/counselling';
import { createIncident } from '../services/incident.service';
import { logger } from '../lib/logger';

export async function autoSeedDatabase() {
  try {
    // 1. University email domain
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
    const charanHash = await hashPassword('Charan@123');
    const charanUser = await User.findOneAndUpdate(
      { email: 'charanbalaji_neelampalli@srmap.edu.in' },
      {
        $set: {
          fullName: 'Charan Balaji Neelampalli',
          passwordHash: charanHash,
          role: 'super_admin',
          emailVerified: true,
          emailVerifiedAt: new Date(),
          accountStatus: 'active',
          failedLoginCount: 0,
        },
      },
      { upsert: true, new: true },
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
      { fullName: 'Dr. Meera Demo (Counsellor)', email: 'cc-demo-counsellor@srmap.edu.in', role: 'counsellor' },
      { fullName: 'Officer Demo (Security)', email: 'cc-demo-security@srmap.edu.in', role: 'security_officer', memberships: [{ committeeId: committees.security?._id, position: 'member' }] },
      { fullName: 'Admin Demo', email: 'cc-demo-admin@srmap.edu.in', role: 'admin' },
    ];
    for (const d of demo) {
      const { memberships, ...rest } = d as typeof d & { memberships?: unknown[] };
      const u = await User.findOneAndUpdate(
        { email: d.email },
        {
          $set: {
            ...rest,
            passwordHash: charanHash,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            accountStatus: 'active',
            failedLoginCount: 0,
            committeeMemberships: memberships ?? [],
          },
        },
        { upsert: true, new: true },
      );
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

    // Sample incident for testing
    const studentUser = await User.findOne({ email: 'cc-demo-student@srmap.edu.in' });
    if (studentUser) {
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

    logger.info('Auto-seed completed: charanbalaji_neelampalli@srmap.edu.in provisioned with password Charan@123');
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Auto-seed failed');
  }
}
