import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import senderRoutes from './routes/sender.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(): Express {
  const app = express();

  // Security middlewares
  app.use(helmet());
  app.use(
    cors({
      origin: true,
      credentials: true,
    })
  );

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Routes
  app.use('/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/senders', senderRoutes);

  // Fallback 404
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp();
