import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

mongoose.set('strictQuery', true);
// Never let queries silently buffer forever when the database is unreachable.
mongoose.set('bufferTimeoutMS', 10000);

let memoryServer: any = null;

export async function connectDatabase(uri = env.MONGODB_URI) {
  let targetUri = uri.trim().replace(/^['"]|['"]$/g, '');
  if (targetUri.includes('mongodb.net') && !targetUri.startsWith('mongodb://') && !targetUri.startsWith('mongodb+srv://')) {
    targetUri = `mongodb+srv://${targetUri}`;
  }
  if (
    targetUri.includes('<cluster>') ||
    targetUri.includes('<YOUR_') ||
    targetUri.startsWith('<') ||
    !targetUri.startsWith('mongodb') ||
    process.env.USE_MEMORY_DB === 'true'
  ) {
    if (!memoryServer) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
    }
    targetUri = memoryServer.getUri();
    if (process.env.USE_MEMORY_DB === 'true') {
      logger.info({ uri: targetUri }, 'Using in-memory MongoDB fallback');
    } else {
      // Not requested: MONGODB_URI is a placeholder or malformed. Nothing written now (accounts,
      // password resets, cases) reaches the real database, and all of it is lost on restart.
      logger.warn({ uri: targetUri }, 'MONGODB_URI is not a usable connection string; using a TEMPORARY in-memory database. All data is lost on restart. Set the real Atlas URI in apps/api/.env.');
    }
  }

  await mongoose.connect(targetUri, {
    autoIndex: env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

export function databaseReady() {
  return mongoose.connection.readyState === 1;
}
