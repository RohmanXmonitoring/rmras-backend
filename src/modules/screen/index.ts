// src/modules/screen/index.ts
export * from './screen.controller';
export * from './screen.service';
export * from './screen.routes';
export * from './screen.validators';

// src/modules/screen/screen.controller.ts
import { Request, Response } from 'express';
import { ScreenService } from './screen.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class ScreenController {
  private screenService: ScreenService;

  constructor() {
    this.screenService = new ScreenService();
  }

  startSession = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, sessionId } = req.body;
      const session = await this.screenService.startSession({
        deviceId,
        sessionId,
        adminId: req.admin!.id,
      });
      res.json(session);
    } catch (error: any) {
      logger.error('Start screen session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  stopSession = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.body;
      const session = await this.screenService.stopSession(sessionId);
      res.json(session);
    } catch (error: any) {
      logger.error('Stop screen session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  approveSession = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.body;
      const session = await this.screenService.approveSession(sessionId);
      res.json(session);
    } catch (error: any) {
      logger.error('Approve screen session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getToken = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const token = await this.screenService.getToken(sessionId);
      res.json({ token });
    } catch (error: any) {
      logger.error('Get screen token error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getLogs = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const logs = await this.screenService.getLogs({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(logs);
    } catch (error: any) {
      logger.error('Get screen logs error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}

// src/modules/screen/screen.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { generateToken } from '../../utils/helpers';

export class ScreenService {
  async startSession(data: {
    deviceId: string;
    sessionId: string;
    adminId: string;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const session = await prisma.screenSession.create({
      data: {
        sessionToken: data.sessionId,
        status: 'ACTIVE',
        adminId: data.adminId,
        deviceId: device.id,
      },
    });

    // Store in Redis
    await redis.setex(
      `screen:session:${data.sessionId}`,
      3600,
      JSON.stringify({
        id: session.id,
        deviceId: device.deviceId,
        adminId: data.adminId,
        status: 'ACTIVE',
      })
    );

    logger.info(`Screen session started: ${data.sessionId} for device ${device.deviceId}`);
    return session;
  }

  async stopSession(sessionId: string) {
    const session = await prisma.screenSession.update({
      where: { sessionToken: sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
      include: {
        device: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Remove from Redis
    await redis.del(`screen:session:${sessionId}`);

    logger.info(`Screen session stopped: ${sessionId}`);
    return session;
  }

  async approveSession(sessionId: string) {
    const session = await prisma.screenSession.update({
      where: { id: sessionId },
      data: {
        status: 'ACCEPTED',
        startedAt: new Date(),
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }

  async getToken(sessionId: string) {
    const session = await prisma.screenSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Generate WebRTC token
    const token = generateToken(64);
    await redis.setex(`webrtc:token:${token}`, 300, sessionId);

    return token;
  }

  async getLogs(params: {
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

    const [logs, total] = await Promise.all([
      prisma.screenSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
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
      prisma.screenSession.count({ where }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

// src/modules/screen/screen.routes.ts
import { Router } from 'express';
import { ScreenController } from './screen.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import {
  startScreenSchema,
  stopScreenSchema,
  approveScreenSchema,
} from './screen.validators';

const router = Router();
const controller = new ScreenController();

router.post('/start', authenticate, validate(startScreenSchema), controller.startSession);
router.post('/stop', authenticate, validate(stopScreenSchema), controller.stopSession);
router.post('/approve', authenticate, validate(approveScreenSchema), controller.approveSession);
router.get('/token/:sessionId', authenticate, controller.getToken);
router.get('/logs', authenticate, controller.getLogs);

export { router as screenRoutes };

// src/modules/screen/screen.validators.ts
import { z } from 'zod';

export const startScreenSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
});

export const stopScreenSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1),
  }),
});

export const approveScreenSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1),
  }),
});
