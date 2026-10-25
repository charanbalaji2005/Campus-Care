/**
 * One-time, server-side Super Admin provisioning. There is no default password:
 *   SUPER_ADMIN_EMAIL=you@university.edu SUPER_ADMIN_NAME="Your Name" npm run bootstrap:super-admin
 * Prints a single-use activation link (valid 24h). The account must set a password and then enrol MFA.
 * Refuses to run if an active Super Admin already exists (use --force-additional to add another).
 */
import { ACCOUNT_EMAIL_DOMAIN, isAllowedAccountEmail } from '@campuscare/shared';
import { connectDatabase, disconnectDatabase } from '../db/connect';
import { randomToken, sha256 } from '../lib/crypto';
import { InviteToken, User } from '../models/user';
import { EmailDomain } from '../models/platform';
import { env } from '../config/env';
import { audit } from '../services/audit.service';

(async () => {
  const email = (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const name = (process.env.SUPER_ADMIN_NAME ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) throw new Error('Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_NAME.');
  if (!isAllowedAccountEmail(email)) throw new Error(`The Super Admin must use an @${ACCOUNT_EMAIL_DOMAIN} address.`);
  await connectDatabase();
  const existing = await User.countDocuments({ role: 'super_admin', accountStatus: { $in: ['active', 'invited'] } });
  if (existing > 0 && !process.argv.includes('--force-additional')) throw new Error('A Super Admin already exists. Use the Super Admin console, or pass --force-additional.');
  if (await User.exists({ email })) throw new Error('An account with that email already exists.');

  const user = await User.create({ fullName: name, email, role: 'super_admin', accountStatus: 'invited' });
  const token = randomToken(32);
  await InviteToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 24 * 3600_000) });

  // Make sure the Super Admin's own domain can be used for staff accounts.
  const domain = email.split('@')[1];
  await EmailDomain.findOneAndUpdate({ domain }, { $setOnInsert: { domain, purpose: 'staff', status: 'active', verifiedAt: new Date(), verificationToken: randomToken(18), note: 'Added during Super Admin bootstrap — verify ownership in the console.' } }, { upsert: true });
  await audit({ action: 'super_admin.bootstrapped', actorId: null, targetType: 'user', targetId: String(user._id), meta: { method: 'cli' } });

  const link = new URL(`/accept-invite?token=${encodeURIComponent(token)}`, env.WEB_ORIGIN).toString();
  console.log('\nSuper Admin created in "invited" state.');
  console.log('Open this single-use link within 24 hours to set the password (it is shown only once):\n');
  console.log(link + '\n');
  await disconnectDatabase();
})().catch(async (err) => {
  console.error(err.message);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
