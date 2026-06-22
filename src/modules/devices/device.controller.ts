// src/modules/devices/device.controller.ts
import { Request, Response } from 'express';
import { DeviceService } from './device.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class DeviceController {
  private deviceService: DeviceService;

  constructor() {
    this.deviceService = new DeviceService();
  }

  register = async (req: AuthRequest, res: Response) => {
    try {
      const device = await this.deviceService.register(req.body);
      res.status(201).json(device);
    } catch (error: any) {
      logger.error('Register device error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getAll = async (req: AuthRequest, res: Response) => {
    try {
      const { page = 1, limit = 20, status, search, group } = req.query;
      const result = await this.deviceService.getAll({
        page: Number(page),
        limit: Number(limit),
        status: status as string,
        search: search as string,
        group: group as string,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Get devices error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getById = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const device = await this.deviceService.getById(id);
      res.json(device);
    } catch (error: any) {
      logger.error('Get device error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  update = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const device = await this.deviceService.update(id, req.body);
      res.json(device);
    } catch (error: any) {
      logger.error('Update device error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  delete = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await this.deviceService.delete(id);
      res.json({ message: 'Device deleted successfully' });
    } catch (error: any) {
      logger.error('Delete device error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getStatistics = async (req: AuthRequest, res: Response) => {
    try {
      const stats = await this.deviceService.getStatistics();
      res.json(stats);
    } catch (error: any) {
      logger.error('Get device statistics error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  search = async (req: AuthRequest, res: Response) => {
    try {
      const { q } = req.query;
      const devices = await this.deviceService.search(q as string);
      res.json(devices);
    } catch (error: any) {
      logger.error('Search devices error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  // Device Information endpoints
  updateInfo = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const info = await this.deviceService.updateInfo(deviceId, req.body);
      res.json(info);
    } catch (error: any) {
      logger.error('Update device info error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateHardware = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const hardware = await this.deviceService.updateHardware(deviceId, req.body);
      res.json(hardware);
    } catch (error: any) {
      logger.error('Update device hardware error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateBattery = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const battery = await this.deviceService.updateBattery(deviceId, req.body);
      res.json(battery);
    } catch (error: any) {
      logger.error('Update device battery error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateRam = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const ram = await this.deviceService.updateRam(deviceId, req.body);
      res.json(ram);
    } catch (error: any) {
      logger.error('Update device RAM error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateCpu = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const cpu = await this.deviceService.updateCpu(deviceId, req.body);
      res.json(cpu);
    } catch (error: any) {
      logger.error('Update device CPU error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateStorage = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const storage = await this.deviceService.updateStorage(deviceId, req.body);
      res.json(storage);
    } catch (error: any) {
      logger.error('Update device storage error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updateNetwork = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const network = await this.deviceService.updateNetwork(deviceId, req.body);
      res.json(network);
    } catch (error: any) {
      logger.error('Update device network error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  updatePermissions = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const permissions = await this.deviceService.updatePermissions(deviceId, req.body);
      res.json(permissions);
    } catch (error: any) {
      logger.error('Update device permissions error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/devices/device.service.ts
import { Prisma } from '@prisma/client';
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class DeviceService {
  async register(data: {
    deviceId: string;
    deviceName: string;
    model: string;
    manufacturer: string;
    androidVersion: string;
    appVersion: string;
    packageName?: string;
  }) {
    // Check if device already exists
    const existing = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (existing) {
      // Update existing device
      return this.update(existing.id, data);
    }

    const device = await prisma.device.create({
      data: {
        ...data,
        packageName: data.packageName || 'com.rayan.client',
        status: 'OFFLINE',
      },
    });

    logger.info(`Device registered: ${device.deviceId} (${device.id})`);
    return device;
  }

  async getAll(params: {
    page: number;
    limit: number;
    status?: string;
    search?: string;
    group?: string;
  }) {
    const { page, limit, status, search, group } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.DeviceWhereInput = {};

    if (status) {
      where.status = status as any;
    }

    if (search) {
      where.OR = [
        { deviceId: { contains: search, mode: 'insensitive' } },
        { deviceName: { contains: search, mode: 'insensitive' } },
        { model: { contains: search, mode: 'insensitive' } },
        { manufacturer: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Get cached result if available
    const cacheKey = `devices:${JSON.stringify(params)}`;
    const cached = await redis.get(cacheKey);
    if (cached && process.env.ENABLE_REDIS_CACHE === 'true') {
      return JSON.parse(cached);
    }

    const [devices, total] = await Promise.all([
      prisma.device.findMany({
        where,
        skip,
        take: limit,
        orderBy: { lastSeenAt: 'desc' },
        include: {
          battery: true,
          network: true,
          location: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              securityAlerts: true,
              screenSessions: true,
            },
          },
        },
      }),
      prisma.device.count({ where }),
    ]);

    const result = {
      data: devices,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };

    // Cache result
    await redis.setex(cacheKey, 60, JSON.stringify(result));

    return result;
  }

  async getById(id: string) {
    const device = await prisma.device.findUnique({
      where: { id },
      include: {
        battery: true,
        cpu: true,
        ram: true,
        storage: true,
        network: true,
        health: true,
        location: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
        apps: {
          where: { isInstalled: true },
          take: 50,
        },
        logs: {
          orderBy: { timestamp: 'desc' },
          take: 20,
        },
        securityAlerts: {
          orderBy: { timestamp: 'desc' },
          take: 10,
          where: { isResolved: false },
        },
        statistics: true,
        _count: {
          select: {
            screenSessions: true,
            recordingSessions: true,
            screenshots: true,
            fileTransfers: true,
          },
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    return device;
  }

  async update(id: string, data: any) {
    const device = await prisma.device.update({
      where: { id },
      data: {
        deviceName: data.deviceName,
        model: data.model,
        manufacturer: data.manufacturer,
        androidVersion: data.androidVersion,
        appVersion: data.appVersion,
        status: data.status,
        isActive: data.isActive,
        isLost: data.isLost,
        isLocked: data.isLocked,
        lastSeenAt: data.lastSeenAt ? new Date(data.lastSeenAt) : undefined,
      },
    });

    // Clear cache
    await redis.del(`devices:*`);
    await redis.del(`device:${id}`);

    logger.info(`Device updated: ${device.deviceId} (${device.id})`);
    return device;
  }

  async delete(id: string) {
    const device = await prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    await prisma.device.delete({
      where: { id },
    });

    // Clear cache
    await redis.del(`devices:*`);
    await redis.del(`device:${id}`);

    logger.info(`Device deleted: ${device.deviceId} (${device.id})`);
    return { success: true };
  }

  async getStatistics() {
    const [total, online, offline, lost, locked, byAndroidVersion] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count({ where: { status: 'OFFLINE' } }),
      prisma.device.count({ where: { isLost: true } }),
      prisma.device.count({ where: { isLocked: true } }),
      prisma.device.groupBy({
        by: ['androidVersion'],
        _count: true,
      }),
    ]);

    return {
      total,
      online,
      offline,
      lost,
      locked,
      byAndroidVersion: byAndroidVersion.map(v => ({
        version: v.androidVersion || 'Unknown',
        count: v._count,
      })),
      timestamp: new Date().toISOString(),
    };
  }

  async search(query: string) {
    const devices = await prisma.device.findMany({
      where: {
        OR: [
          { deviceId: { contains: query, mode: 'insensitive' } },
          { deviceName: { contains: query, mode: 'insensitive' } },
          { model: { contains: query, mode: 'insensitive' } },
          { manufacturer: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
      include: {
        battery: true,
        location: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    return devices;
  }

  // Device Information Methods
  async updateInfo(deviceId: string, data: any) {
    return this.update(deviceId, data);
  }

  async updateHardware(deviceId: string, data: any) {
    // Implementation
    return { success: true };
  }

  async updateBattery(deviceId: string, data: any) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const battery = await prisma.deviceBattery.upsert({
      where: { deviceId: device.id },
      update: {
        ...data,
        timestamp: new Date(),
      },
      create: {
        ...data,
        deviceId: device.id,
      },
    });

    return battery;
  }

  async updateRam(deviceId: string, data: any) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const ram = await prisma.deviceRam.upsert({
      where: { deviceId: device.id },
      update: {
        ...data,
        timestamp: new Date(),
      },
      create: {
        ...data,
        deviceId: device.id,
      },
    });

    return ram;
  }

  async updateCpu(deviceId: string, data: any) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const cpu = await prisma.deviceCpu.upsert({
      where: { deviceId: device.id },
      update: {
        ...data,
        timestamp: new Date(),
      },
      create: {
        ...data,
        deviceId: device.id,
      },
    });

    return cpu;
  }

  async updateStorage(deviceId: string, data: any) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const storage = await prisma.deviceStorage.upsert({
      where: { deviceId: device.id },
      update: {
        ...data,
        timestamp: new Date(),
      },
      create: {
        ...data,
        deviceId: device.id,
      },
    });

    return storage;
  }

  async updateNetwork(deviceId: string, data: any) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const network = await prisma.deviceNetwork.upsert({
      where: { deviceId: device.id },
      update: {
        ...data,
        timestamp: new Date(),
      },
      create: {
        ...data,
        deviceId: device.id,
      },
    });

    return network;
  }

  async updatePermissions(deviceId: string, data: any) {
    // Implementation
    return { success: true };
  }
}

// src/modules/devices/device.routes.ts
import { Router } from 'express';
import { DeviceController } from './device.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { registerDeviceSchema, updateDeviceSchema } from './device.validators';

const router = Router();
const controller = new DeviceController();

// Device Management
router.post('/', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), validate(registerDeviceSchema), controller.register);
router.get('/', authenticate, controller.getAll);
router.get('/statistics', authenticate, controller.getStatistics);
router.get('/search', authenticate, controller.search);
router.get('/:id', authenticate, controller.getById);
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), validate(updateDeviceSchema), controller.update);
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), controller.delete);

// Device Information
router.post('/:deviceId/info', controller.updateInfo);
router.post('/:deviceId/hardware', controller.updateHardware);
router.post('/:deviceId/battery', controller.updateBattery);
router.post('/:deviceId/ram', controller.updateRam);
router.post('/:deviceId/cpu', controller.updateCpu);
router.post('/:deviceId/storage', controller.updateStorage);
router.post('/:deviceId/network', controller.updateNetwork);
router.post('/:deviceId/permissions', controller.updatePermissions);

export { router as deviceRoutes };

// src/modules/devices/device.validators.ts
import { z } from 'zod';

export const registerDeviceSchema = z.object({
  body: z.object({
    deviceId: z.string().min(1),
    deviceName: z.string().min(1),
    model: z.string().min(1),
    manufacturer: z.string().min(1),
    androidVersion: z.string().min(1),
    appVersion: z.string().min(1),
    packageName: z.string().optional(),
  }),
});

export const updateDeviceSchema = z.object({
  body: z.object({
    deviceName: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    manufacturer: z.string().min(1).optional(),
    androidVersion: z.string().min(1).optional(),
    appVersion: z.string().min(1).optional(),
    status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE', 'LOST', 'LOCKED']).optional(),
    isActive: z.boolean().optional(),
    isLost: z.boolean().optional(),
    isLocked: z.boolean().optional(),
  }),
});
