import express, { type Request } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { allowedOrigins, env } from './config/env';
import { logger } from './lib/logger';
import { databaseReady } from './db/connect';
import { loadSession } from './middleware/auth';
import { apiLimiter, csrfProtection, errorHandler, notFoundHandler } from './middleware/security';
import { authRouter } from './routes/auth.routes';
import { incidentsRouter } from './routes/incidents.routes';
import { counsellingRouter } from './routes/counselling.routes';
import { chatRouter } from './routes/chat.routes';
import { safetyRouter } from './routes/safety.routes';
import { contentRouter } from './routes/content.routes';
import { adminRouter } from './routes/admin.routes';
import { superAdminRouter } from './routes/superadmin.routes';
import { webhooksRouter } from './routes/webhooks.routes';
import { mobileRouter } from './routes/mobile.routes';
import { meRouter } from './routes/me.routes';
import { communityRouter } from './routes/community.routes';
import { getSettings } from './services/settings.service';
import { AppError } from './lib/http';
// Side-effect imports register background jobs and socket room authorisers.
import './services/safety.service';
import './services/email/email.service';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' }, customProps: () => ({}) }));
  app.use(express.json({
    limit: '200kb',
    verify: (req, _res, buf) => {
      if ((req as Request).url?.startsWith('/api/v1/webhooks/')) (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));
  app.use(cookieParser());

  // Health/readiness for load balancers and Render.
  app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
  app.get('/api/v1/ready', (_req, res) => {
    const ready = databaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', database: ready ? 'connected' : 'disconnected' });
  });

  // Webhooks authenticate with signatures, not cookies, so they sit before CSRF.
  app.use('/api/v1/webhooks', webhooksRouter);

  app.use('/api/v1', apiLimiter, loadSession, csrfProtection);

  // Maintenance mode: blocks student write actions (reports, chat, bookings). Sign-in, reading,
  // SOS / Safe Walk / location sharing and all staff actions keep working — safety is never paused.
  app.use('/api/v1', async (req, _res, next) => {
    try {
      const exempt = req.path.startsWith('/auth/') || req.path.startsWith('/safety/') || req.path.startsWith('/mobile/') || req.method === 'GET' || req.method === 'HEAD';
      if (exempt || (req.user && req.user.role !== 'student')) return next();
      const s = await getSettings();
      if (s.platform.maintenanceMode) return next(new AppError(503, 'maintenance', 'CampusCare is under maintenance. In an emergency call 112 or campus security.'));
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/mobile', mobileRouter);
  app.use('/api/v1/me', meRouter);
  app.use('/api/v1/community', communityRouter);
  app.use('/api/v1/incidents', incidentsRouter);
  app.use('/api/v1/counselling', counsellingRouter);
  app.use('/api/v1/chat', chatRouter);
  app.use('/api/v1/safety', safetyRouter);
  app.use('/api/v1', contentRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/super-admin', superAdminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
