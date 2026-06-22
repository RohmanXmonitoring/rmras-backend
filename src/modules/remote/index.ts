// src/modules/remote/index.ts
export * from './remote.controller';
export * from './remote.service';
export * from './remote.routes';
export * from './remote.validators';

// src/modules/remote/remote.controller.ts
import { Request, Response } from 'express';
import { RemoteService } from './remote.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class RemoteController {
  private remoteService: RemoteService;

  constructor() {
    this.remoteService = new RemoteService();
  }

  createSession = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, sessionType } = req.body;
      const session = await this.remoteService.createSession({
        deviceId,
        adminId: req.admin!.id,
        sessionType,
      });
      res.status(201).json(session);
    } catch (error: any) {
      logger.error('Create remote session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  acceptSession = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.body;
      const session = await this.remoteService.acceptSession(sessionId);
      res.json(session);
    } catch (error: any) {
      logger.error('Accept remote session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  rejectSession = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.body;
      const session = await this.remoteService.rejectSession(sessionId);
      res.json(session);
    } catch (error: any) {
      logger.error('Reject remote session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  endSession = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.body;
      const session = await this.remoteService.endSession(sessionId);
      res.json(session);
    } catch (error: any) {
      logger.error('End remote session error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getLogs = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const logs = await this.remoteService.getLogs({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(logs);
    } catch (error: any) {
      logger.error('Get remote logs error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getStatus = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const status = await this.remoteService.getStatus(sessionId);
      res.json(status);
    } catch (error: any) {
      logger.error('Get remote status error:', error);
      res.status(404).json({ error: error.message });
    }
  };
}

// src/modules/remote/remote.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { generateToken } from '../../utils/helpers';
import { EmailService } from '../../services/email.service';

export class RemoteService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async createSession(data: {
    deviceId: string;
    adminId: string;
    sessionType: string;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    if (device.status !== 'ONLINE') {
      throw new Error('Device is not online');
    }

    // Check if there's already an active session
    const existingSession = await prisma.screenSession.findFirst({
      where: {
        deviceId: device.id,
        status: 'ACTIVE',
      },
    });

    if (existingSession) {
      throw new Error('Device already has an active session');
    }

    const sessionToken = generateToken(32);
    const session = await prisma.screenSession.create({
      data: {
        sessionToken,
        status: 'REQUESTED',
        adminId: data.adminId,
        deviceId: device.id,
      },
    });

    // Store session in Redis for fast access
    await redis.setex(
      `remote:session:${sessionToken}`,
      3600,
      JSON.stringify({
        id: session.id,
        deviceId: device.deviceId,
        adminId: data.adminId,
        status: 'REQUESTED',
        sessionType: data.sessionType,
      })
    );

    // Send notification to device
    await redis.publish(
      'remote:request',
      JSON.stringify({
        sessionId: session.id,
        sessionToken,
        deviceId: device.deviceId,
        adminId: data.adminId,
        sessionType: data.sessionType,
        timestamp: new Date().toISOString(),
      })
    );

    // Create session log
    await prisma.sessionLog.create({
      data: {
        event: 'REMOTE_REQUESTED',
        description: `Remote session requested for device ${device.deviceId}`,
        data: { sessionToken, adminId: data.adminId },
        deviceId: device.id,
      },
    });

    logger.info(`Remote session created: ${sessionToken} for device ${device.deviceId}`);
    return {
      sessionId: session.id,
      sessionToken,
      status: 'REQUESTED',
      deviceId: device.deviceId,
    };
  }

  async acceptSession(sessionId: string) {
    const session = await prisma.screenSession.update({
      where: { id: sessionId },
      data: {
        status: 'ACCEPTED',
        startedAt: new Date(),
      },
      include: {
        device: true,
        admin: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Update Redis
    const cached = await redis.get(`remote:session:${session.sessionToken}`);
    if (cached) {
      const data = JSON.parse(cached);
      data.status = 'ACCEPTED';
      await redis.setex(`remote:session:${session.sessionToken}`, 3600, JSON.stringify(data));
    }

    await redis.publish(
      'remote:accepted',
      JSON.stringify({
        sessionId: session.id,
        sessionToken: session.sessionToken,
        deviceId: session.device.deviceId,
        timestamp: new Date().toISOString(),
      })
    );

    // Create session log
    await prisma.sessionLog.create({
      data: {
        event: 'REMOTE_ACCEPTED',
        description: `Remote session accepted for device ${session.device.deviceId}`,
        data: { sessionToken: session.sessionToken },
        deviceId: session.deviceId,
      },
    });

    logger.info(`Remote session accepted: ${session.sessionToken}`);
    return session;
  }

  async rejectSession(sessionId: string) {
    const session = await prisma.screenSession.update({
      where: { id: sessionId },
      data: {
        status: 'REJECTED',
        endedAt: new Date(),
      },
      include: {
        device: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Update Redis
    const cached = await redis.get(`remote:session:${session.sessionToken}`);
    if (cached) {
      const data = JSON.parse(cached);
      data.status = 'REJECTED';
      await redis.setex(`remote:session:${session.sessionToken}`, 3600, JSON.stringify(data));
    }

    await redis.publish(
      'remote:rejected',
      JSON.stringify({
        sessionId: session.id,
        sessionToken: session.sessionToken,
        deviceId: session.device.deviceId,
        timestamp: new Date().toISOString(),
      })
    );

    // Create session log
    await prisma.sessionLog.create({
      data: {
        event: 'REMOTE_REJECTED',
        description: `Remote session rejected for device ${session.device.deviceId}`,
        data: { sessionToken: session.sessionToken },
        deviceId: session.deviceId,
      },
    });

    logger.info(`Remote session rejected: ${session.sessionToken}`);
    return session;
  }

  async endSession(sessionId: string) {
    const session = await prisma.screenSession.update({
      where: { id: sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        duration: Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000),
      },
      include: {
        device: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Update Redis
    const cached = await redis.get(`remote:session:${session.sessionToken}`);
    if (cached) {
      const data = JSON.parse(cached);
      data.status = 'ENDED';
      await redis.setex(`remote:session:${session.sessionToken}`, 3600, JSON.stringify(data));
    }

    await redis.publish(
      'remote:ended',
      JSON.stringify({
        sessionId: session.id,
        sessionToken: session.sessionToken,
        deviceId: session.device.deviceId,
        duration: session.duration,
        timestamp: new Date().toISOString(),
      })
    );

    // Create session log
    await prisma.sessionLog.create({
      data: {
        event: 'REMOTE_ENDED',
        description: `Remote session ended for device ${session.device.deviceId}`,
        data: { 
          sessionToken: session.sessionToken,
          duration: session.duration,
        },
        deviceId: session.deviceId,
      },
    });

    logger.info(`Remote session ended: ${session.sessionToken}`);
    return session;
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
      prisma.sessionLog.findMany({
        where,
        skip,
        take: limit,
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
      prisma.sessionLog.count({ where }),
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

  async getStatus(sessionId: string) {
    const session = await prisma.screenSession.findUnique({
      where: { id: sessionId },
      include: {
        device: {
          select: {
            deviceId: true,
            deviceName: true,
            status: true,
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

    if (!session) {
      throw new Error('Session not found');
    }

    return session;
  }
}

// src/modules/remote/remote.routes.ts
import { Router } from 'express';
import { RemoteController } from './remote.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import {
  createSessionSchema,
  sessionActionSchema,
} from './remote.validators';

const router = Router();
const controller = new RemoteController();

router.post(
  '/session',
  authenticate,
  validate(createSessionSchema),
  controller.createSession
);
router.post(
  '/accept',
  authenticate,
  validate(sessionActionSchema),
  controller.acceptSession
);
router.post(
  '/reject',
  authenticate,
  validate(sessionActionSchema),
  controller.rejectSession
);
router.post(
  '/end',
  authenticate,
  validate(sessionActionSchema),
  controller.endSession
);
router.get('/logs', authenticate, controller.getLogs);
router.get('/status/:sessionId', authenticate, controller.getStatus);

export { router as remoteRoutes };

// src/modules/remote/remote.validators.ts
import { z } from 'zod';

export const createSessionSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
    sessionType: z.enum(['SCREEN_SHARE', 'SCREEN_RECORD', 'REMOTE_CONTROL']),
  }),
});

export const sessionActionSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1),
  }),
});
