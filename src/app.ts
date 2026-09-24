import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './lib/errors';
import { requestLog } from './middleware/requestLog';
import authRouter from './routes/auth.routes';
import { addressRouter, publicRouter } from './routes/public.routes';
import { notificationRouter, uploadRouter } from './routes/common.routes';
import { adminCustomRequestRouter, customRequestRouter } from './routes/customRequest.routes';
import { orderRouter } from './routes/order.routes';
import { adminRouter } from './routes/admin.routes';
import { livreurRouter } from './routes/livreur.routes';

export function createApp() {
  const app = express();

  app.use(requestLog);
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'habichou-api', time: new Date().toISOString() });
  });

  // Auth
  app.use('/auth', authRouter);

  // Client / public
  app.use('/', publicRouter);
  app.use('/addresses', addressRouter);
  app.use('/custom-requests', customRequestRouter);
  app.use('/orders', orderRouter);
  app.use('/notifications', notificationRouter);
  app.use('/uploads', uploadRouter);

  // Admin
  app.use('/admin', adminRouter);
  app.use('/admin/custom-requests', adminCustomRequestRouter);

  // Livreur
  app.use('/livreur', livreurRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
