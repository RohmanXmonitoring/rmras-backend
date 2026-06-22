// src/app.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { rateLimiter } from './middlewares/rateLimiter';
import { logger } from './utils/logger';
import { prisma, redis } from './config';
import { setupWebSocket } from './websocket';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './swagger';
import { authRoutes } from './modules/auth/auth.routes';
import { deviceRoutes } from './modules/devices/device.routes';
import { monitoringRoutes } from './modules/monitoring/monitoring.routes';
import { enrollmentRoutes } from './modules/enrollments/enrollment.routes';
import { locationRoutes } from './modules/location/location.routes';
import { geofenceRoutes } from './modules/geofences/geofence.routes';
import { remoteRoutes } from './modules/remote/remote.routes';
import { screenRoutes } from './modules/screen/screen.routes';
import { recordingRoutes } from './modules/recording/recording.routes';
import { screenshotRoutes } from './modules/screenshot/screenshot.routes';
import { fileRoutes } from './modules/files/file.routes';
import { notificationRoutes } from './modules/notifications/notification.routes';
import { securityRoutes } from './modules/security/security.routes';

// Create Express app
const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.SOCKET_CORS_ORIGIN?.split(',') || '*',
  credentials: true,
}));

// Request parsing
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim()),
  },
}));

// Rate limiting
if (process.env.ENABLE_RATE_LIMIT === 'true') {
  app.use(rateLimiter);
}

// Static files
app.use('/storage', express.static(process.env.STORAGE_PATH || './storage'));

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/devices', deviceRoutes);
app.use('/api/v1/monitoring', monitoringRoutes);
app.use('/api/v1/enrollments', enrollmentRoutes);
app.use('/api/v1/location', locationRoutes);
app.use('/api/v1/geofences', geofenceRoutes);
app.use('/api/v1/remote', remoteRoutes);
app.use('/api/v1/screen', screenRoutes);
app.use('/api/v1/recording', recordingRoutes);
app.use('/api/v1/screenshot', screenshotRoutes);
app.use('/api/v1/files', fileRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/security', securityRoutes);

// Swagger documentation
if (process.env.ENABLE_SWAGGER === 'true') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
}

// Health check
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      database: false,
      redis: false,
    },
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.services.database = true;
  } catch (error) {
    health.services.database = false;
    health.status = 'unhealthy';
  }

  try {
    await redis.ping();
    health.services.redis = true;
  } catch (error) {
    health.services.redis = false;
    health.status = 'unhealthy';
  }

  res.json(health);
});

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  logger.error('Unhandled error:', err);
  
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';
  
  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Create HTTP server
const server = createServer(app);

// Create Socket.IO server
const io = new SocketServer(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGIN?.split(',') || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Setup WebSocket
setupWebSocket(io);

export { app, server, io };
