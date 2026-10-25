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
