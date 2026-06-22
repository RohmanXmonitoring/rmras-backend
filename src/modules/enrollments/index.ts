// src/modules/enrollments/index.ts
export * from './enrollment.controller';
export * from './enrollment.service';
export * from './enrollment.routes';
export * from './enrollment.validators';

// src/modules/enrollments/enrollment.controller.ts
import { Request, Response } from 'express';
import { EnrollmentService } from './enrollment.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class EnrollmentController {
  private enrollmentService: EnrollmentService;

  constructor() {
    this.enrollmentService = new EnrollmentService();
  }

  generate = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceName, email } = req.body;
      const result = await this.enrollmentService.generate({
        deviceName,
        email,
        adminId: req.admin!.id,
      });
      res.status(201).json(result);
    } catch (error: any) {
      logger.error('Generate enrollment error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  verify = async (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      const result = await this.enrollmentService.verify(pin);
      res.json(result);
    } catch (error: any) {
      logger.error('Verify enrollment error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  register = async (req: Request, res: Response) => {
    try {
      const { pin, deviceId, deviceName, model, manufacturer, androidVersion, appVersion } = req.body;
      const result = await this.enrollmentService.register({
        pin,
        deviceId,
        deviceName,
        model,
        manufacturer,
        androidVersion,
        appVersion,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Register enrollment error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getHistory = async (req: AuthRequest, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await this.enrollmentService.getHistory({
        page: Number(page),
        limit: Number(limit),
        adminId: req.admin!.id,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Get enrollment history error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  revoke = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await this.enrollmentService.revoke(id);
      res.json({ message: 'Enrollment revoked successfully' });
    } catch (error: any) {
      logger.error('Revoke enrollment error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/enrollments/enrollment.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { generatePIN } from '../../utils/helpers';
import { EmailService } from '../../services/email.service';

export class EnrollmentService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async generate(data: {
    deviceName?: string;
    email?: string;
    adminId: string;
  }) {
    const pin = generatePIN(8);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const enrollment = await prisma.enrollment.create({
      data: {
        pin,
        deviceName: data.deviceName,
        expiresAt,
        adminId: data.adminId,
      },
    });

    // Store in Redis for faster verification
    await redis.setex(
      `enrollment:${pin}`,
      86400, // 24 hours
      JSON.stringify(enrollment)
    );

    // Send email if provided
    if (data.email) {
      await this.emailService.sendEnrollmentInvitation(
        data.email,
        pin,
        data.deviceName
      );
    }

    logger.info(`Enrollment generated: ${pin} by admin ${data.adminId}`);
    return {
      pin,
      expiresAt,
      deviceName: data.deviceName,
    };
  }

  async verify(pin: string) {
    // Check Redis first
    const cached = await redis.get(`enrollment:${pin}`);
    if (cached) {
      const enrollment = JSON.parse(cached);
      if (enrollment.expiresAt && new Date(enrollment.expiresAt) < new Date()) {
        throw new Error('Enrollment PIN has expired');
      }
      if (enrollment.status !== 'PENDING') {
        throw new Error('Enrollment is not active');
      }
      return {
        valid: true,
        enrollment: {
          id: enrollment.id,
          deviceName: enrollment.deviceName,
          expiresAt: enrollment.expiresAt,
        },
      };
    }

    // Check database
    const enrollment = await prisma.enrollment.findUnique({
      where: { pin },
    });

    if (!enrollment) {
      throw new Error('Invalid enrollment PIN');
    }

    if (enrollment.expiresAt < new Date()) {
      throw new Error('Enrollment PIN has expired');
    }

    if (enrollment.status !== 'PENDING') {
      throw new Error('Enrollment is not active');
    }

    return {
      valid: true,
      enrollment: {
        id: enrollment.id,
        deviceName: enrollment.deviceName,
        expiresAt: enrollment.expiresAt,
      },
    };
  }

  async register(data: {
    pin: string;
    deviceId: string;
    deviceName: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    appVersion: string;
  }) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { pin },
    });

    if (!enrollment) {
      throw new Error('Invalid enrollment PIN');
    }

    if (enrollment.expiresAt < new Date()) {
      throw new Error('Enrollment PIN has expired');
    }

    if (enrollment.status !== 'PENDING') {
      throw new Error('Enrollment is not active');
    }

    // Check if device already exists
    const existingDevice = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    let device;
    if (existingDevice) {
      // Update existing device
      device = await prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          deviceName: data.deviceName || existingDevice.deviceName,
          model: data.model || existingDevice.model,
          manufacturer: data.manufacturer || existingDevice.manufacturer,
          androidVersion: data.androidVersion || existingDevice.androidVersion,
          appVersion: data.appVersion || existingDevice.appVersion,
          isActive: true,
          status: 'ONLINE',
          lastSeenAt: new Date(),
        },
      });
    } else {
      // Create new device
      device = await prisma.device.create({
        data: {
          deviceId: data.deviceId,
          deviceName: data.deviceName,
          model: data.model,
          manufacturer: data.manufacturer,
          androidVersion: data.androidVersion,
          appVersion: data.appVersion,
          status: 'ONLINE',
          lastSeenAt: new Date(),
        },
      });
    }

    // Update enrollment
    await prisma.enrollment.update({
      where: { id: enrollment.id },
      data: {
        status: 'COMPLETED',
        deviceIdFinal: device.id,
      },
    });

    // Remove from Redis
    await redis.del(`enrollment:${pin}`);

    logger.info(`Device enrolled: ${device.deviceId} with PIN ${pin}`);
    return {
      success: true,
      device: {
        id: device.id,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      },
    };
  }

  async getHistory(params: {
    page: number;
    limit: number;
    adminId: string;
  }) {
    const { page, limit, adminId } = params;
    const skip = (page - 1) * limit;

    const [enrollments, total] = await Promise.all([
      prisma.enrollment.findMany({
        where: { adminId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              username: true,
              fullName: true,
            },
          },
          device: {
            select: {
              deviceId: true,
              deviceName: true,
              status: true,
            },
          },
        },
      }),
      prisma.enrollment.count({ where: { adminId } }),
    ]);

    return {
      data: enrollments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async revoke(id: string) {
    const enrollment = await prisma.enrollment.findUnique({
      where: { id },
    });

    if (!enrollment) {
      throw new Error('Enrollment not found');
    }

    if (enrollment.status === 'COMPLETED') {
      throw new Error('Cannot revoke completed enrollment');
    }

    await prisma.enrollment.update({
      where: { id },
      data: { status: 'REVOKED' },
    });

    // Remove from Redis
    await redis.del(`enrollment:${enrollment.pin}`);

    logger.info(`Enrollment revoked: ${enrollment.pin}`);
    return { success: true };
  }
}

// src/modules/enrollments/enrollment.routes.ts
import { Router } from 'express';
import { EnrollmentController } from './enrollment.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import {
  generateEnrollmentSchema,
  verifyEnrollmentSchema,
  registerEnrollmentSchema,
} from './enrollment.validators';

const router = Router();
const controller = new EnrollmentController();

router.post(
  '/generate',
  authenticate,
  authorize('SUPER_ADMIN', 'ADMIN'),
  validate(generateEnrollmentSchema),
  controller.generate
);
router.post('/verify', validate(verifyEnrollmentSchema), controller.verify);
router.post('/register', validate(registerEnrollmentSchema), controller.register);
router.get('/history', authenticate, controller.getHistory);
router.delete('/:id/revoke', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), controller.revoke);

export { router as enrollmentRoutes };

// src/modules/enrollments/enrollment.validators.ts
import { z } from 'zod';

export const generateEnrollmentSchema = z.object({
  body: z.object({
    deviceName: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
  }),
});

export const verifyEnrollmentSchema = z.object({
  body: z.object({
    pin: z.string().length(8),
  }),
});

export const registerEnrollmentSchema = z.object({
  body: z.object({
    pin: z.string().length(8),
    deviceId: z.string().min(1),
    deviceName: z.string().min(1),
    model: z.string().min(1),
    manufacturer: z.string().min(1),
    androidVersion: z.string().min(1),
    appVersion: z.string().min(1),
  }),
});
