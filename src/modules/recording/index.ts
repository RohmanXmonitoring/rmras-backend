// src/modules/recording/index.ts
export * from './recording.controller';
export * from './recording.service';
export * from './recording.routes';
export * from './recording.validators';

// src/modules/recording/recording.controller.ts
import { Request, Response } from 'express';
import { RecordingService } from './recording.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class RecordingController {
  private recordingService: RecordingService;

  constructor() {
    this.recordingService = new RecordingService();
  }

  startRecording = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, sessionId } = req.body;
      const recording = await this.recordingService.startRecording({
        deviceId,
        sessionId,
        adminId: req.admin!.id,
      });
      res.json(recording);
    } catch (error: any) {
      logger.error('Start recording error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  stopRecording = async (req: AuthRequest, res: Response) => {
    try {
      const { sessionId, filePath, fileSize } = req.body;
      const recording = await this.recordingService.stopRecording({
        sessionId,
        filePath,
        fileSize,
      });
      res.json(recording);
    } catch (error: any) {
      logger.error('Stop recording error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const history = await this.recordingService.getHistory({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(history);
    } catch (error: any) {
      logger.error('Get recording history error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getLogs = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const logs = await this.recordingService.getLogs({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(logs);
    } catch (error: any) {
      logger.error('Get recording logs error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}

// src/modules/recording/recording.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';

export class RecordingService {
  async startRecording(data: {
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

    const recording = await prisma.recordingSession.create({
      data: {
        sessionToken: data.sessionId,
        status: 'ACTIVE',
        adminId: data.adminId,
        deviceId: device.id,
      },
    });

    // Store in Redis
    await redis.setex(
      `recording:session:${data.sessionId}`,
      3600,
      JSON.stringify({
        id: recording.id,
        deviceId: device.deviceId,
        adminId: data.adminId,
        status: 'ACTIVE',
      })
    );

    logger.info(`Recording started: ${data.sessionId} for device ${device.deviceId}`);
    return recording;
  }

  async stopRecording(data: {
    sessionId: string;
    filePath: string;
    fileSize: number;
  }) {
    const recording = await prisma.recordingSession.update({
      where: { sessionToken: data.sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
        filePath: data.filePath,
        fileSize: data.fileSize,
        duration: Math.floor((Date.now() - new Date(recording.startedAt).getTime()) / 1000),
      },
      include: {
        device: true,
      },
    });

    if (!recording) {
      throw new Error('Recording not found');
    }

    // Remove from Redis
    await redis.del(`recording:session:${data.sessionId}`);

    logger.info(`Recording stopped: ${data.sessionId}`);
    return recording;
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

    const [recordings, total] = await Promise.all([
      prisma.recordingSession.findMany({
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
      prisma.recordingSession.count({ where }),
    ]);

    return {
      data: recordings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getLogs(params: {
    deviceId?: string;
    page: number;
    limit: number;
  }) {
    // Similar to getHistory but with different query
    return this.getHistory(params);
  }
}

// src/modules/recording/recording.routes.ts
import { Router } from 'express';
import { RecordingController } from './recording.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import {
  startRecordingSchema,
  stopRecordingSchema,
} from './recording.validators';

const router = Router();
const controller = new RecordingController();

router.post('/start', authenticate, validate(startRecordingSchema), controller.startRecording);
router.post('/stop', authenticate, validate(stopRecordingSchema), controller.stopRecording);
router.get('/history', authenticate, controller.getHistory);
router.get('/logs', authenticate, controller.getLogs);

export { router as recordingRoutes };

// src/modules/recording/recording.validators.ts
import { z } from 'zod';

export const startRecordingSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
});

export const stopRecordingSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1),
    filePath: z.string().min(1),
    fileSize: z.number().positive(),
  }),
});
