// src/modules/security/index.ts
export * from './security.controller';
export * from './security.service';
export * from './security.routes';
export * from './security.validators';

// src/modules/security/security.controller.ts
import { Request, Response } from 'express';
import { SecurityService } from './security.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class SecurityController {
  private securityService: SecurityService;

  constructor() {
    this.securityService = new SecurityService();
  }

  getAlerts = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20, resolved } = req.query;
      const alerts = await this.securityService.getAlerts({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
        resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      });
      res.json(alerts);
    } catch (error: any) {
      logger.error('Get security alerts error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  resolveAlert = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const alert = await this.securityService.resolveAlert(id);
      res.json(alert);
    } catch (error: any) {
      logger.error('Resolve security alert error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getLogs = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const logs = await this.securityService.getLogs({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(logs);
    } catch (error: any) {
      logger.error('Get security logs error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  reportAlert = async (req: Request, res: Response) => {
    try {
      const { deviceId, type, severity, message, data } = req.body;
      const alert = await this.securityService.reportAlert({
        deviceId,
        type,
        severity,
        message,
        data,
      });
      res.status(201).json(alert);
    } catch (error: any) {
      logger.error('Report security alert error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/security/security.service.ts
import { prisma } from '../../config';
import { logger } from '../../utils/logger';
import { EmailService } from '../../services/email.service';

export class SecurityService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async getAlerts(params: {
    deviceId?: string;
    page: number;
    limit: number;
    resolved?: boolean;
  }) {
    const { deviceId, page, limit, resolved } = params;
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
    if (resolved !== undefined) {
      where.isResolved = resolved;
    }

    const [alerts, total] = await Promise.all([
      prisma.securityAlert.findMany({
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
      prisma.securityAlert.count({ where }),
    ]);

    return {
      data: alerts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async resolveAlert(id: string) {
    const alert = await prisma.securityAlert.update({
      where: { id },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
      },
    });

    if (!alert) {
      throw new Error('Alert not found');
    }

    logger.info(`Security alert resolved: ${alert.id}`);
    return alert;
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
      prisma.securityLog.findMany({
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
          admin: {
            select: {
              username: true,
              fullName: true,
            },
          },
        },
      }),
      prisma.securityLog.count({ where }),
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

  async reportAlert(data: {
    deviceId: string;
    type: string;
    severity: string;
    message: string;
    data?: any;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const alert = await prisma.securityAlert.create({
      data: {
        type: data.type as any,
        severity: data.severity as any,
        message: data.message,
        data: data.data,
        deviceId: device.id,
      },
    });

    // Send email for critical alerts
    if (data.severity === 'CRITICAL' || data.severity === 'HIGH') {
      const admins = await prisma.admin.findMany({
        where: { isActive: true },
        select: { email: true },
      });

      for (const admin of admins) {
        await this.emailService.sendSecurityAlert(
          admin.email,
          {
            type: data.type,
            severity: data.severity,
            message: data.message,
            deviceName: device.deviceName,
          }
        );
      }
    }

    // Send notification
    await prisma.notification.create({
      data: {
        title: `Security Alert: ${data.type}`,
        message: data.message,
        type: 'ALERT',
        data: {
          alertId: alert.id,
          severity: data.severity,
          deviceId: device.deviceId,
        },
        deviceId: device.id,
      },
    });

    logger.info(`Security alert reported: ${alert.type} for device ${device.deviceId}`);
    return alert;
  }
}

// src/modules/security/security.routes.ts
import { Router } from 'express';
import { SecurityController } from './security.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { reportAlertSchema } from './security.validators';

const router = Router();
const controller = new SecurityController();

router.get('/alerts', authenticate, controller.getAlerts);
router.patch('/alerts/:id/resolve', authenticate, controller.resolveAlert);
router.get('/logs', authenticate, controller.getLogs);
router.post('/alerts', validate(reportAlertSchema), controller.reportAlert);

export { router as securityRoutes };

// src/modules/security/security.validators.ts
import { z } from 'zod';

export const reportAlertSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
    type: z.enum(['UNAUTHORIZED_ACCESS', 'SUSPICIOUS_ACTIVITY', 'BRUTE_FORCE', 'MALWARE', 'ROOT_DETECTED', 'VPN_DETECTED', 'SCREEN_RECORDING']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    message: z.string().min(1).max(500),
    data: z.any().optional(),
  }),
});
