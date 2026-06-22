// src/server.ts
import { app, server } from './app';
import { logger } from './utils/logger';
import { prisma } from './config';

const PORT = process.env.PORT || 3000;

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Shutting down gracefully...');
  
  server.close(async () => {
    await prisma.$disconnect();
    logger.info('Database disconnected');
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
server.listen(PORT, () => {
  logger.info(`🚀 RMRAS Backend is running on port ${PORT}`);
  logger.info(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🌐 Base URL: ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
  
  if (process.env.ENABLE_SWAGGER === 'true') {
    logger.info(`📚 Swagger UI: ${process.env.BASE_URL || `http://localhost:${PORT}`}/api/docs`);
  }
});
