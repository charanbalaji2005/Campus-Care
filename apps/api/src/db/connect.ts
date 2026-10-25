import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

mongoose.set('strictQuery', true);
// Never let queries silently buffer forever when the database is unreachable.
mongoose.set('bufferTimeoutMS', 10000);

let memoryServer: any = null;

export async function connectDatabase(uri = env.MONGODB_URI) {
  let targetUri = uri;
  if (uri.includes('<cluster>') || process.env.USE_MEMORY_DB === 'true') {
    if (!memoryServer) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      memoryServer = await MongoMemoryServer.create();
    }
    targetUri = memoryServer.getUri();
    logger.info({ uri: targetUri }, 'Using in-memory MongoDB');
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
