// src/modules/screenshot/index.ts
export * from './screenshot.controller';
export * from './screenshot.service';
export * from './screenshot.routes';
export * from './screenshot.validators';

// src/modules/screenshot/screenshot.controller.ts
import { Request, Response } from 'express';
import { ScreenshotService } from './screenshot.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class ScreenshotController {
  private screenshotService: ScreenshotService;

  constructor() {
    this.screenshotService = new ScreenshotService();
  }

  requestScreenshot = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.body;
      const result = await this.screenshotService.requestScreenshot({
        deviceId,
        adminId: req.admin!.id,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Request screenshot error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  saveScreenshot = async (req: Request, res: Response) => {
    try {
      const { requestId, imageData } = req.body;
      const screenshot = await this.screenshotService.saveScreenshot({
        requestId,
        imageData,
      });
      res.json(screenshot);
    } catch (error: any) {
      logger.error('Save screenshot error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const history = await this.screenshotService.getHistory({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(history);
    } catch (error: any) {
      logger.error('Get screenshot history error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getScreenshot = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const screenshot = await this.screenshotService.getScreenshot(id);
      res.json(screenshot);
    } catch (error: any) {
      logger.error('Get screenshot error:', error);
      res.status(404).json({ error: error.message });
    }
  };
}

// src/modules/screenshot/screenshot.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { generateToken } from '../../utils/helpers';

export class ScreenshotService {
  async requestScreenshot(data: {
    deviceId: string;
    adminId: string;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const requestId = generateToken(16);

    // Store request in Redis
    await redis.setex(
      `screenshot:request:${requestId}`,
      60,
      JSON.stringify({
        deviceId: device.deviceId,
        adminId: data.adminId,
        timestamp: new Date().toISOString(),
      })
    );

    // Notify device
    await redis.publish(
      'screenshot:request',
      JSON.stringify({
        requestId,
        deviceId: device.deviceId,
        adminId: data.adminId,
        timestamp: new Date().toISOString(),
      })
    );

    logger.info(`Screenshot requested: ${requestId} for device ${device.deviceId}`);
    return {
      requestId,
      deviceId: device.deviceId,
      status: 'PENDING',
    };
  }

  async saveScreenshot(data: {
    requestId: string;
    imageData: string;
  }) {
    const request = await redis.get(`screenshot:request:${data.requestId}`);
    if (!request) {
      throw new Error('Invalid or expired request');
    }

    const parsed = JSON.parse(request);
    const device = await prisma.device.findUnique({
      where: { deviceId: parsed.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // Save screenshot to database
    const screenshot = await prisma.screenshot.create({
      data: {
        filePath: `/storage/screenshots/${data.requestId}.jpg`,
        fileSize: Buffer.byteLength(data.imageData, 'base64'),
        adminId: parsed.adminId,
        deviceId: device.id,
      },
    });

    // Remove request from Redis
    await redis.del(`screenshot:request:${data.requestId}`);

    logger.info(`Screenshot saved: ${screenshot.id}`);
    return screenshot;
  }

  async getHistory(params: {
    deviceId?: string;
    page: number;
    limit: number;
  }) {
    const { deviceId, page, limit } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (deviceId) {
      const device = await prisma.device.findUnique({
        where: { deviceId },
      });
      if (device) {
        where.deviceId = device.id;
      }
    }

    const [screenshots, total] = await Promise.all([
      prisma.screenshot.findMany({
        where,
        skip,
        take: limit,
        orderBy: { capturedAt: 'desc' },
        include: {
          device: {
            select: {
              deviceId: true,
              deviceName: true,
            },
          },
          admin: {
            select: {
              username: true,
              fullName: true,
            },
          },
        },
      }),
      prisma.screenshot.count({ where }),
    ]);

    return {
      data: screenshots,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getScreenshot(id: string) {
    const screenshot = await prisma.screenshot.findUnique({
      where: { id },
      include: {
        device: {
          select: {
            deviceId: true,
            deviceName: true,
          },
        },
        admin: {
          select: {
            username: true,
            fullName: true,
          },
        },
      },
    });

    if (!screenshot) {
      throw new Error('Screenshot not found');
    }

    return screenshot;
  }
}

// src/modules/screenshot/screenshot.routes.ts
import { Router } from 'express';
import { ScreenshotController } from './screenshot.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import {
  requestScreenshotSchema,
  saveScreenshotSchema,
} from './screenshot.validators';

const router = Router();
const controller = new ScreenshotController();

router.post('/request', authenticate, validate(requestScreenshotSchema), controller.requestScreenshot);
router.post('/save', validate(saveScreenshotSchema), controller.saveScreenshot);
router.get('/history', authenticate, controller.getHistory);
router.get('/:id', authenticate, controller.getScreenshot);

export { router as screenshotRoutes };

// src/modules/screenshot/screenshot.validators.ts
import { z } from 'zod';

export const requestScreenshotSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
  }),
});

export const saveScreenshotSchema = z.object({
  body: z.object({
    requestId: z.string().min(1),
    imageData: z.string().min(1),
  }),
});
