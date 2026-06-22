// src/modules/applications/index.ts
export * from './application.controller';
export * from './application.service';
export * from './application.routes';
export * from './application.validators';

// src/modules/applications/application.controller.ts
import { Request, Response } from 'express';
import { ApplicationService } from './application.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class ApplicationController {
  private applicationService: ApplicationService;

  constructor() {
    this.applicationService = new ApplicationService();
  }

  getInstalledApps = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const apps = await this.applicationService.getInstalledApps(deviceId);
      res.json(apps);
    } catch (error: any) {
      logger.error('Get installed apps error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getRunningApps = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const apps = await this.applicationService.getRunningApps(deviceId);
      res.json(apps);
    } catch (error: any) {
      logger.error('Get running apps error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  updateApps = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const { apps } = req.body;
      const result = await this.applicationService.updateApps(deviceId, apps);
      res.json(result);
    } catch (error: any) {
      logger.error('Update apps error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getStatistics = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const stats = await this.applicationService.getStatistics(deviceId);
      res.json(stats);
    } catch (error: any) {
      logger.error('Get application statistics error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getMonitoring = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const monitoring = await this.applicationService.getMonitoring(deviceId);
      res.json(monitoring);
    } catch (error: any) {
      logger.error('Get application monitoring error:', error);
      res.status(404).json({ error: error.message });
    }
  };
}

// src/modules/applications/application.service.ts
import { prisma } from '../../config';
import { logger } from '../../utils/logger';

export class ApplicationService {
  async getInstalledApps(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        apps: {
          where: { isInstalled: true },
          orderBy: { appName: 'asc' },
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device.apps;
  }

  async getRunningApps(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        apps: {
          where: { isRunning: true },
          orderBy: { appName: 'asc' },
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device.apps;
  }

  async updateApps(deviceId: string, apps: any[]) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // Delete old apps
    await prisma.deviceApp.deleteMany({
      where: { deviceId: device.id },
    });

    // Insert new apps
    if (apps.length > 0) {
      await prisma.deviceApp.createMany({
        data: apps.map(app => ({
          ...app,
          deviceId: device.id,
          timestamp: new Date(),
        })),
      });
    }

    logger.info(`Updated apps for device ${deviceId}: ${apps.length} apps`);
    return {
      success: true,
      count: apps.length,
      deviceId,
    };
  }

  async getStatistics(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        apps: {
          where: { isInstalled: true },
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const totalApps = device.apps.length;
    const systemApps = device.apps.filter(app => app.isSystem).length;
    const userApps = totalApps - systemApps;
    const runningApps = device.apps.filter(app => app.isRunning).length;

    return {
      total: totalApps,
      system: systemApps,
      user: userApps,
      running: runningApps,
      deviceId,
      timestamp: new Date().toISOString(),
    };
  }

  async getMonitoring(deviceId: string) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
      include: {
        apps: {
          where: { isRunning: true },
          select: {
            appName: true,
            packageName: true,
            isSystem: true,
            lastUsed: true,
          },
        },
        cpu: true,
        ram: true,
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return {
      runningApps: device.apps,
      cpu: device.cpu,
      ram: device.ram,
      timestamp: new Date().toISOString(),
    };
  }
}

// src/modules/applications/application.routes.ts
import { Router } from 'express';
import { ApplicationController } from './application.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { updateAppsSchema } from './application.validators';

const router = Router();
const controller = new ApplicationController();

router.get('/:deviceId/installed', authenticate, controller.getInstalledApps);
router.get('/:deviceId/running', authenticate, controller.getRunningApps);
router.post('/:deviceId/update', validate(updateAppsSchema), controller.updateApps);
router.get('/:deviceId/statistics', authenticate, controller.getStatistics);
router.get('/:deviceId/monitoring', authenticate, controller.getMonitoring);

export { router as applicationRoutes };

// src/modules/applications/application.validators.ts
import { z } from 'zod';

export const updateAppsSchema = z.object({
  body: z.object({
    apps: z.array(z.object({
      packageName: z.string().min(1),
      appName: z.string().min(1),
      version: z.string().optional(),
      isSystem: z.boolean().default(false),
      isRunning: z.boolean().default(false),
      isInstalled: z.boolean().default(true),
      installTime: z.string().optional(),
      updateTime: z.string().optional(),
      lastUsed: z.string().optional(),
    })),
  }),
});
