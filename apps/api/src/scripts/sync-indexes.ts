/** Creates/updates all MongoDB indexes (production runs with autoIndex off). Run after each deploy. */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../db/connect';
import '../models/user';
import '../models/incident';
import '../models/counselling';
import '../models/chat';
import '../models/safety';
import '../models/content';
import '../models/platform';
import '../models/community';
import '../models/feed';
import '../models/mobile';
// Correctness depends on these: AlertAssignment's partial unique indexes prevent duplicate SOS assignments,
// RecoveryCode's unique hash index and TotpConfiguration's unique user index protect MFA.
import '../models/duty';
import '../models/mfa';
import '../models/wellness';
import '../models/chat-center';

(async () => {
  await connectDatabase();
  for (const name of mongoose.modelNames()) {
    const model = mongoose.model(name);
    await model.syncIndexes();
    console.log(`indexes synced: ${name}`);
  }
  await disconnectDatabase();
})().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
