import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { allowedOrigins } from '../config/env';
import { RealtimeTicket } from '../models/platform';
import { Session, User, type UserDoc } from '../models/user';
import { sha256 } from '../lib/crypto';
import { logger } from '../lib/logger';

let io: Server | null = null;

/**
 * Room access checks are injected by the services that own the data, so the socket layer
 * never decides on its own who may read a case or a private chat.
 */
type RoomAuthoriser = (user: UserDoc, id: string) => Promise<boolean>;
const authorisers: Record<string, RoomAuthoriser> = {};
export function registerRoomAuthoriser(prefix: 'case' | 'chat' | 'responders' | 'sos', fn: RoomAuthoriser) {
  authorisers[prefix] = fn;
}

interface SocketData {
  userId: string;
  sessionId: string;
}

export function initRealtime(server: HttpServer) {
  io = new Server(server, {
    path: '/realtime',
    cors: { origin: allowedOrigins, credentials: true },
    maxHttpBufferSize: 64 * 1024, // messages are sent over HTTP; sockets only carry small events
  });

  // Authenticate the handshake with a single-use, 60-second ticket from POST /api/v1/realtime/ticket.
  io.use(async (socket, next) => {
    try {
      const ticket = String(socket.handshake.auth?.ticket ?? '');
      if (!ticket) return next(new Error('unauthorized'));
      const doc = await RealtimeTicket.findOneAndDelete({ tokenHash: sha256(ticket), expiresAt: { $gt: new Date() } });
      if (!doc) return next(new Error('unauthorized'));
      const session = await Session.findOne({ _id: doc.sessionId, revokedAt: null, expiresAt: { $gt: new Date() } });
      if (!session) return next(new Error('unauthorized'));
      (socket.data as SocketData) = { userId: String(doc.userId), sessionId: String(doc.sessionId) };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = socket.data as SocketData;
    socket.join(`user:${data.userId}`);

    socket.on('subscribe', async (payload: { room?: string }, ack?: (r: { ok: boolean }) => void) => {
      const room = String(payload?.room ?? '');
      const [prefix, id] = room.split(':');
      const authorise = authorisers[prefix];
      try {
        const session = await Session.findOne({ _id: data.sessionId, revokedAt: null, expiresAt: { $gt: new Date() } });
        const user = session ? await User.findById(data.userId) : null;
        if (!authorise || !user || user.accountStatus !== 'active' || !(await authorise(user, id ?? ''))) {
          ack?.({ ok: false });
          return;
        }
        await socket.join(room);
        ack?.({ ok: true });
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'socket subscribe failed');
        ack?.({ ok: false });
      }
    });

    socket.on('unsubscribe', (payload: { room?: string }) => {
      if (payload?.room) socket.leave(String(payload.room));
    });
  });

  return io;
}

export function emitToRoom(room: string, event: string, payload: unknown) {
  io?.to(room).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Immediately disconnect a user's sockets (suspension, logout everywhere, permission change). */
export async function disconnectUser(userId: string) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  sockets.forEach((s) => s.disconnect(true));
}

/** Remove a user from a room after losing access (e.g. case reassigned away). */
export async function evictFromRoom(userId: string, room: string) {
  if (!io) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  sockets.forEach((s) => s.leave(room));
}

export function closeRealtime() {
  io?.close();
  io = null;
}
