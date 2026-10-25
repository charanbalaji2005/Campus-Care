/**
 * Seeds reference data and CLEARLY FICTIONAL demo content.
 *   npm run seed                       -> committees, routing, contacts, training, channels
 *   SEED_DEMO_USERS=true SEED_DEMO_PASSWORD='...' npm run seed  -> also demo accounts and sample cases (never in production)
 */
import { randomUUID } from 'node:crypto';
import { CATEGORY_INFO, COMMITTEE_TYPE_LABELS, INCIDENT_CATEGORIES, type CommitteeType } from '@campuscare/shared';
import { env } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../db/connect';
import { hashPassword, randomToken } from '../lib/crypto';
import { Committee, RoutingRule } from '../models/incident';
import { Contact, Announcement, TrainingModule } from '../models/content';
import { ChatChannel } from '../models/chat';
import { EmailDomain } from '../models/platform';
import { User } from '../models/user';
import { Availability } from '../models/counselling';
import { createIncident } from '../services/incident.service';

async function seedReference() {
  const committees: Record<string, { _id: unknown }> = {};
  const confidential: CommitteeType[] = ['gender_sensitivity', 'anti_ragging'];
  for (const type of Object.keys(COMMITTEE_TYPE_LABELS) as CommitteeType[]) {
    if (type === 'other') continue;
    const categories = INCIDENT_CATEGORIES.filter((c) => CATEGORY_INFO[c].defaultCommittee === type);
    const c = await Committee.findOneAndUpdate(
      { name: COMMITTEE_TYPE_LABELS[type] },
      { $setOnInsert: { name: COMMITTEE_TYPE_LABELS[type], type, categories, confidential: confidential.includes(type), mandate: `Handles ${categories.map((x) => CATEGORY_INFO[x].label.toLowerCase()).join(', ') || 'referred'} matters under university policy.`, active: true } },
      { upsert: true, new: true },
    );
    committees[type] = c!;
  }
  for (const category of INCIDENT_CATEGORIES) {
    const target = committees[CATEGORY_INFO[category].defaultCommittee];
    if (target) await RoutingRule.findOneAndUpdate({ category }, { $setOnInsert: { category, committeeId: target._id, defaultPriority: CATEGORY_INFO[category].sensitive ? 'high' : 'normal' } }, { upsert: true });
  }

  // National helplines are real public numbers (India). Campus entries are placeholders — unverified until the university fills them in.
  const contacts = [
    { name: 'National Emergency Response (ERSS)', purpose: 'Police, fire and medical emergencies', category: 'emergency', phone: '112', verified: true, emergency: true, hours: '24/7', order: 1 },
    { name: 'Ambulance', purpose: 'Emergency ambulance (most states)', category: 'medical', phone: '108', verified: true, emergency: true, hours: '24/7', order: 2 },
    { name: 'Women Helpline', purpose: 'Support for women facing violence or harassment', category: 'helpline', phone: '181', verified: true, hours: '24/7', order: 3 },
    { name: 'National Anti-Ragging Helpline (UGC)', purpose: 'Report ragging to the national helpline', category: 'helpline', phone: '1800-180-5522', email: 'helpline@antiragging.in', verified: true, hours: '24/7, toll free', order: 4 },
    { name: 'Tele-MANAS', purpose: 'Free, confidential mental health support', category: 'helpline', phone: '14416', verified: true, hours: '24/7', order: 5 },
    { name: 'Cyber Crime Helpline', purpose: 'Online fraud and cyber crime (cybercrime.gov.in)', category: 'helpline', phone: '1930', verified: true, hours: '24/7', order: 6 },
    { name: 'Campus Security Control Room', purpose: 'On-campus security emergencies and escorts', category: 'security', verified: false, emergency: true, order: 10 },
    { name: 'Campus Health Centre', purpose: 'First aid and medical assistance', category: 'medical', verified: false, emergency: true, order: 11 },
    { name: 'Counselling Centre', purpose: 'Confidential counselling and wellbeing', category: 'counselling', verified: false, order: 20 },
    { name: 'Hostel Office', purpose: 'Hostel safety and warden contact', category: 'hostel', verified: false, order: 21 },
  ];
  for (const c of contacts) await Contact.findOneAndUpdate({ name: c.name }, { $setOnInsert: c }, { upsert: true });

  const channels = [
    { kind: 'community', name: 'Campus General', slug: 'general', description: 'General questions about campus life. Be kind — moderated.', published: true, order: 0 },
    { kind: 'community', name: 'Safety Tips', slug: 'safety-tips', description: 'Share safety information and awareness resources.', published: true, order: 1 },
    { kind: 'community', name: 'Official Updates', slug: 'official', description: 'Read-only updates from the university.', published: true, readOnly: true, order: 2 },
    { kind: 'support_service', name: 'Talk to a Counsellor', slug: 'counsellor-chat', description: 'Private chat with the counselling team.', published: true, serviceRole: 'counsellor', order: 0 },
    { kind: 'support_service', name: 'Campus Security Desk', slug: 'security-desk', description: 'Non-emergency questions for campus security. In an emergency use SOS or call 112.', published: true, serviceRole: 'security_officer', order: 1 },
  ];
  for (const ch of channels) await ChatChannel.findOneAndUpdate({ slug: ch.slug }, { $setOnInsert: ch }, { upsert: true });

  const modules = [
    {
      title: 'Understanding ragging', category: 'Anti-ragging', summary: 'What ragging is, why it is prohibited and how to get help.', durationMinutes: 8, published: true,
      sections: [
        { heading: 'What counts as ragging', body: 'Any act that teases, harasses, intimidates or humiliates a student, or forces them to do something against their will — in person or online.' },
        { heading: 'Getting help', body: 'Report it in CampusCare or call the National Anti-Ragging Helpline on 1800-180-5522. You can report anonymously where university policy allows.' },
      ],
      quiz: [
        { question: 'Which of these can be ragging?', options: ['Forcing a junior to perform in a corridor', 'Helping a junior find a classroom'], correctIndex: 0 },
        { question: 'The National Anti-Ragging Helpline is…', options: ['1800-180-5522', '100', '1098'], correctIndex: 0 },
      ],
    },
    {
      title: 'Consent and respectful conduct', category: 'Gender sensitivity', summary: 'Recognising consent, boundaries and respectful behaviour.', durationMinutes: 10, published: true,
      sections: [{ heading: 'Consent', body: 'Consent is clear, freely given and can be withdrawn at any time. Silence or pressure is not consent.' }],
      quiz: [{ question: 'Can consent be withdrawn after it is given?', options: ['Yes, at any time', 'No'], correctIndex: 0 }],
    },
    {
      title: 'Staying safe online', category: 'Cyber safety', summary: 'Protect your accounts and respond to cyber abuse.', durationMinutes: 7, published: true,
      sections: [{ heading: 'Protect your accounts', body: 'Use unique passwords, turn on two-step verification, and never share one-time passwords.' }],
      quiz: [{ question: 'Someone claiming to be IT support asks for your OTP. You should…', options: ['Refuse and report it', 'Share it'], correctIndex: 0 }],
    },
  ];
  for (const m of modules) await TrainingModule.findOneAndUpdate({ title: m.title }, { $setOnInsert: m }, { upsert: true });
  return committees;
}

async function seedDemo(committees: Record<string, { _id: unknown }>) {
  if (env.NODE_ENV === 'production') throw new Error('Demo users are never seeded in production.');
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set SEED_DEMO_PASSWORD (12+ characters) — there are no default passwords.');
  const hash = await hashPassword(password);
  await EmailDomain.findOneAndUpdate({ domain: 'srmap.edu.in' }, { $setOnInsert: { domain: 'srmap.edu.in', purpose: 'both', status: 'active', verifiedAt: new Date(), verificationToken: randomToken(18), note: 'SRM University-AP (seeded)' } }, { upsert: true });

  const demo = [
    { fullName: 'Asha Demo', email: 'cc-demo-student@srmap.edu.in', role: 'student', studentId: 'DEMO-0001', department: 'Computer Science & Engineering', academicYear: 3 },
    { fullName: 'Rohan Demo', email: 'cc-demo-student2@srmap.edu.in', role: 'student', studentId: 'DEMO-0002', department: 'Mechanical Engineering', academicYear: 1 },
    { fullName: 'Dr. Meera Demo', email: 'cc-demo-counsellor@srmap.edu.in', role: 'counsellor' },
    { fullName: 'Kiran Demo', email: 'cc-demo-committee@srmap.edu.in', role: 'committee_member', memberships: [{ committeeId: committees.anti_ragging._id, position: 'chair' }, { committeeId: committees.grievance._id, position: 'member' }] },
    { fullName: 'Priya Demo', email: 'cc-demo-icc@srmap.edu.in', role: 'committee_member', memberships: [{ committeeId: committees.gender_sensitivity._id, position: 'chair' }] },
    { fullName: 'Officer Demo', email: 'cc-demo-security@srmap.edu.in', role: 'security_officer', memberships: [{ committeeId: committees.security._id, position: 'member' }] },
    { fullName: 'Admin Demo', email: 'cc-demo-admin@srmap.edu.in', role: 'admin' },
  ];
  const users: Record<string, InstanceType<typeof User>> = {};
  for (const d of demo) {
    const { memberships, ...rest } = d as typeof d & { memberships?: unknown[] };
    const u = await User.findOneAndUpdate(
      { email: d.email },
      { $setOnInsert: { ...rest, passwordHash: hash, emailVerified: true, emailVerifiedAt: new Date(), accountStatus: 'active', committeeMemberships: memberships ?? [] } },
      { upsert: true, new: true },
    );
    users[d.email] = u!;
  }
  await Availability.findOneAndUpdate(
    { counsellorId: users['cc-demo-counsellor@srmap.edu.in']._id },
    { $setOnInsert: { weekly: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '10:00', end: '16:00' })), slotMinutes: 50, timezone: 'Asia/Kolkata', acceptingRequests: true, title: 'Senior Counsellor (demo)', bio: 'Fictional demo counsellor.' } },
    { upsert: true },
  );
  const student = users['cc-demo-student@srmap.edu.in'];
  const samples = [
    { category: 'ragging' as const, title: 'Seniors forcing juniors to perform at night (demo)', description: 'Fictional demo case: a group of seniors made first-year students perform in the hostel corridor after 11pm.', location: 'Hostel Block B, 2nd floor', anonymous: false },
    { category: 'infrastructure' as const, title: 'Broken lights on the library path (demo)', description: 'Fictional demo case: the lights along the path from the library to the hostels have been off for a week.', location: 'Library walkway', anonymous: true },
  ];
  for (const s of samples) {
    await createIncident(student, { ...s, incidentDate: new Date(Date.now() - 86400_000), severity: 'medium', urgent: false, preferredContact: 'in_app', idempotencyKey: randomUUID() }).catch(() => undefined);
  }
  await Announcement.findOneAndUpdate({ title: 'Welcome to CampusCare (demo)' }, { $setOnInsert: { title: 'Welcome to CampusCare (demo)', body: 'This is fictional demo content. Official announcements from your university will appear here.', pinned: true, published: true, authorId: users['cc-demo-admin@srmap.edu.in']._id } }, { upsert: true });
  console.log('Demo accounts (fictional):', demo.map((d) => d.email).join(', '));
}

(async () => {
  await connectDatabase();
  const committees = await seedReference();
  console.log('Reference data seeded.');
  if (process.env.SEED_DEMO_USERS === 'true') await seedDemo(committees);
  await disconnectDatabase();
})().catch(async (err) => {
  console.error(err.message);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
