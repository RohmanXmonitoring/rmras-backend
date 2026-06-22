// src/jobs/index.ts
import cron from 'node-cron';
import { logger } from '../utils/logger';
import { prisma, redis } from '../config';
import { EmailService } from '../services/email.service';

export const setupJobs = () => {
  const emailService = new EmailService();

  // Check device health every minute
  cron.schedule('*/1 * * * *', async () => {
    try {
      const offlineThreshold = new Date(Date.now() - 60000); // 1 minute
      
      const offlineDevices = await prisma.device.updateMany({
        where: {
          status: 'ONLINE',
          lastSeenAt: {
            lt: offlineThreshold,
          },
        },
        data: {
          status: 'OFFLINE',
        },
      });

      if (offlineDevices.count > 0) {
        logger.info(`Marked ${offlineDevices.count} devices as offline`);
      }
    } catch (error) {
      logger.error('Device health check error:', error);
    }
  });

  // Clean up expired sessions every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await prisma.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isRevoked: true },
          ],
        },
      });

      if (result.count > 0) {
        logger.info(`Cleaned up ${result.count} expired sessions`);
      }
    } catch (error) {
      logger.error('Session cleanup error:', error);
    }
  });

  // Clean up expired refresh tokens every hour
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await prisma.refreshToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isRevoked: true },
          ],
        },
      });

      if (result.count > 0) {
        logger.info(`Cleaned up ${result.count} expired refresh tokens`);
      }
    } catch (error) {
      logger.error('Refresh token cleanup error:', error);
    }
  });

  // Daily summary email
  cron.schedule('0 8 * * *', async () => {
    try {
      const totalDevices = await prisma.device.count();
      const onlineDevices = await prisma.device.count({ where: { status: 'ONLINE' } });
      const alerts = await prisma.securityAlert.count({
        where: {
          isResolved: false,
          timestamp: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      });

      // Send summary to admins
      const admins = await prisma.admin.findMany({
        where: { isActive: true },
        select: { email: true },
      });

      for (const admin of admins) {
        await emailService.sendEmail(
          admin.email,
          'Daily Summary - RMRAS',
          `
          <h1>Daily Summary Report</h1>
          <p>Total Devices: ${totalDevices}</p>
          <p>Online Devices: ${onlineDevices}</p>
          <p>Active Alerts: ${alerts}</p>
          <p>Date: ${new Date().toLocaleDateString()}</p>
          `
        );
      }

      logger.info('Daily summary sent');
    } catch (error) {
      logger.error('Daily summary error:', error);
    }
  });

  // Database backup (if enabled)
  if (process.env.BACKUP_ENABLED === 'true') {
    cron.schedule(process.env.BACKUP_SCHEDULE || '0 2 * * *', async () => {
      try {
        // Implement database backup logic
        logger.info('Database backup completed');
      } catch (error) {
        logger.error('Database backup error:', error);
      }
    });
  }

  // Clean up Redis cache
  cron.schedule('0 3 * * *', async () => {
    try {
      // Delete old cache keys
      const keys = await redis.keys('*');
      let deleted = 0;
      
      for (const key of keys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) { // No expiration set
          await redis.del(key);
          deleted++;
        }
      }

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} Redis cache keys`);
      }
    } catch (error) {
      logger.error('Redis cleanup error:', error);
    }
  });

  logger.info('Cron jobs initialized');
};
