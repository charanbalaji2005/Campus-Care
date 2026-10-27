import mongoose from 'mongoose';
import { logger } from '../lib/logger';
import { audit, isRecentMutation, redactSensitive } from './audit.service';

export interface DbWatcherHealth {
  status: 'active' | 'unsupported_standalone' | 'reconnecting' | 'stopped' | 'error';
  watchedCollections: string[];
  monitoredCollections: string[];
  correlatedEvents: number;
  uncorrelatedEvents: number;
  lastEventAt: Date | null;
  message: string;
}

const MONITORED_COLLECTIONS = [
  'users',
  'emergencyalerts',
  'incidents',
  'settings',
  'supporttickets',
  'counsellingappointments',
  'dutyshifts',
  'channels',
];

const health: DbWatcherHealth = {
  status: 'stopped',
  watchedCollections: MONITORED_COLLECTIONS,
  monitoredCollections: MONITORED_COLLECTIONS,
  correlatedEvents: 0,
  uncorrelatedEvents: 0,
  lastEventAt: null,
  message: 'Database watcher is currently stopped.',
};

let changeStream: any = null;
let isStopping = false;

/**
 * Starts the MongoDB change stream consumer.
 * In MongoDB Atlas or replica sets, this monitors all collection-level mutations.
 * If a mutation occurs outside the CampusCare API (e.g. direct mongo shell or script),
 * it is captured, audited, and flagged as an uncorrelated database mutation.
 */
export async function startDbWatcher(): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    logger.warn('Database watcher deferred: Mongoose not connected yet.');
    return;
  }

  isStopping = false;

  try {
    const db = mongoose.connection.db;
    if (!db) {
      health.status = 'error';
      health.message = 'No active database instance found on connection.';
      return;
    }

    // Try creating a deployment-level or collection-level change stream
    changeStream = db.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', async (change: any) => {
      try {
        const coll = change.ns?.coll;
        if (!coll || coll === 'auditlogs' || coll === 'sessions' || coll === 'realtimetickets') {
          return;
        }

        const docId = String(change.documentKey?._id);
        const correlated = isRecentMutation(coll, docId);

        health.lastEventAt = new Date();

        if (correlated) {
          health.correlatedEvents++;
        } else {
          // Direct database mutation observed!
          health.uncorrelatedEvents++;
          const op = change.operationType === 'insert'
            ? 'insert'
            : change.operationType === 'delete'
              ? 'delete'
              : 'update';

          await audit({
            action: `${coll}.${op}`,
            collectionName: coll,
            targetType: coll,
            targetId: docId,
            operation: op as any,
            actorType: 'database_direct',
            actorRole: 'direct_db_operator',
            actorName: 'Direct Database Operator (Change Stream)',
            source: 'change_stream',
            correlated: false,
            severity: 'warn',
            outcome: 'success',
            meta: {
              operationType: change.operationType,
              namespace: change.ns,
              updateDescription: change.updateDescription ? redactSensitive(change.updateDescription) : undefined,
              fullDocument: change.fullDocument ? redactSensitive(change.fullDocument) : undefined,
            },
            reason: 'Database mutation observed directly via MongoDB change stream without matching application audit event.',
          });

          logger.warn(
            { collection: coll, docId, operation: op },
            'Uncorrelated database mutation observed via MongoDB Change Stream',
          );
        }
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'Error handling change stream event');
      }
    });

    changeStream.on('error', (err: any) => {
      const msg = String(err?.message || err);
      if (msg.includes('replica set') || msg.includes('NotMaster') || msg.includes('change streams are only supported')) {
        health.status = 'unsupported_standalone';
        health.message = 'Change streams require a MongoDB replica set. In standalone mode, application-level audit logging provides primary tracking.';
        logger.info(health.message);
      } else {
        health.status = 'error';
        health.message = msg;
        logger.error({ err: msg }, 'Change stream error encountered');
      }
    });

    changeStream.on('close', () => {
      if (!isStopping) {
        health.status = 'reconnecting';
        health.message = 'Change stream closed unexpectedly. Attempting reconnection.';
      }
    });

    health.status = 'active';
    health.message = 'MongoDB Change Stream active. Monitoring direct database mutations.';
    logger.info('MongoDB Change Stream initialized successfully.');
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('replica set') || msg.includes('NotMaster') || msg.includes('change streams are only supported')) {
      health.status = 'unsupported_standalone';
      health.message = 'Change streams require a MongoDB replica set. In standalone mode, application-level audit logging provides primary tracking.';
      logger.info(health.message);
    } else {
      health.status = 'error';
      health.message = msg;
      logger.warn({ err: msg }, 'Could not initialize MongoDB Change Stream watcher');
    }
  }
}

export function stopDbWatcher(): void {
  isStopping = true;
  if (changeStream) {
    changeStream.close().catch(() => undefined);
    changeStream = null;
  }
  health.status = 'stopped';
  health.message = 'Database watcher stopped.';
}

export function getDbWatcherHealth(): DbWatcherHealth {
  return { ...health };
}
