// src/modules/monitoring/monitoring.controller.ts
import { Request, Response } from 'express';
import { MonitoringService } from './monitoring.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class MonitoringController {
  private monitoringService: MonitoringService;

  constructor() {
    this.monitoringService = new MonitoringService();
  }

  getStatus = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const status = await this.monitoringService.getStatus(deviceId);
      res.json(status);
    } catch (error: any) {
      logger.error('Get status error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getBattery = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const battery = await this.monitoringService.getBattery(deviceId);
      res.json(battery);
    } catch (error: any) {
      logger.error('Get battery error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getStorage = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const storage = await this.monitoringService.getStorage(deviceId);
      res.json(storage);
    } catch (error: any) {
      logger.error('Get storage error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getNetwork = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const network = await this.monitoringService.getNetwork(deviceId);
      res.json(network);
    } catch (error: any) {
      logger.error('Get network error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getHealth = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const health = await this.monitoringService.getHealth(deviceId);
      res.json(health);
    } catch (error: any) {
      logger.error('Get health error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getDashboard = async (req: AuthRequest, res: Response) => {
    try {
      const dashboard = await this.monitoringService.getDashboard();
      res.json(dashboard);
    } catch (error: any) {
      logger.error('Get dashboard error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}

// src/modules/monitoring/monitoring.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';

export class MonitoringService {
  async getStatus(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        battery: true,
        network: true,
        location: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return {
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      isActive: device.isActive,
      isLost: device.isLost,
      isLocked: device.isLocked,
      battery: device.battery,
      network: device.network,
      location: device.location?.[0],
      timestamp: new Date().toISOString(),
    };
  }

  async getBattery(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        battery: true,
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device.battery || { level: 0, isCharging: false };
  }

  async getStorage(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        storage: true,
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device.storage || {
      total: 0,
      used: 0,
      free: 0,
      usagePercentage: 0,
    };
  }

  async getNetwork(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        network: true,
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device.network || {
      type: 'unknown',
      isConnected: false,
    };
  }

  async getHealth(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        health: true,
        battery: true,
        storage: true,
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const issues = [];
    if (device.battery && device.battery.level < 15) {
      issues.push('Low battery');
    }
    if (device.storage && device.storage.usagePercentage > 90) {
      issues.push('Storage almost full');
    }
    if (device.status === 'OFFLINE') {
      issues.push('Device offline');
    }

    return {
      overallHealth: issues.length === 0 ? 'GOOD' : 'WARNING',
      issues,
      battery: device.battery,
      storage: device.storage,
      timestamp: new Date().toISOString(),
    };
  }

  async getDashboard() {
    const cacheKey = 'dashboard:stats';
    const cached = await redis.get(cacheKey);
    if (cached && process.env.ENABLE_REDIS_CACHE === 'true') {
      return JSON.parse(cached);
    }

    const [
      totalDevices,
      onlineDevices,
      offlineDevices,
      lostDevices,
      lockedDevices,
      totalAlerts,
      criticalAlerts,
      recentLocations,
    ] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count({ where: { status: 'OFFLINE' } }),
      prisma.device.count({ where: { isLost: true } }),
      prisma.device.count({ where: { isLocked: true } }),
      prisma.securityAlert.count(),
      prisma.securityAlert.count({
        where: {
          severity: 'CRITICAL',
          isResolved: false,
        },
      }),
      prisma.deviceLocation.findMany({
        take: 10,
        orderBy: { timestamp: 'desc' },
        include: {
          device: {
            select: {
              deviceId: true,
              deviceName: true,
            },
          },
        },
      }),
    ]);

    const result = {
      devices: {
        total: totalDevices,
        online: onlineDevices,
        offline: offlineDevices,
        lost: lostDevices,
        locked: lockedDevices,
      },
      alerts: {
        total: totalAlerts,
        critical: criticalAlerts,
      },
      recentLocations: recentLocations.map(loc => ({
        deviceId: loc.device.deviceId,
        deviceName: loc.device.deviceName,
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp,
      })),
      timestamp: new Date().toISOString(),
    };

    await redis.setex(cacheKey, 300, JSON.stringify(result));
    return result;
  }
}

// src/modules/monitoring/monitoring.routes.ts
import { Router } from 'express';
import { MonitoringController } from './monitoring.controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();
const controller = new MonitoringController();

router.get('/dashboard', authenticate, controller.getDashboard);
router.get('/status/:deviceId', authenticate, controller.getStatus);
router.get('/battery/:deviceId', authenticate, controller.getBattery);
router.get('/storage/:deviceId', authenticate, controller.getStorage);
router.get('/network/:deviceId', authenticate, controller.getNetwork);
router.get('/health/:deviceId', authenticate, controller.getHealth);

export { router as monitoringRoutes };
