// src/modules/geofences/geofence.controller.ts
import { Request, Response } from 'express';
import { GeofenceService } from './geofence.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class GeofenceController {
  private geofenceService: GeofenceService;

  constructor() {
    this.geofenceService = new GeofenceService();
  }

  create = async (req: AuthRequest, res: Response) => {
    try {
      const geofence = await this.geofenceService.create({
        ...req.body,
        adminId: req.admin!.id,
      });
      res.status(201).json(geofence);
    } catch (error: any) {
      logger.error('Create geofence error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getAll = async (req: AuthRequest, res: Response) => {
    try {
      const { page = 1, limit = 20 } = req.query;
      const result = await this.geofenceService.getAll({
        page: Number(page),
        limit: Number(limit),
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Get geofences error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getById = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const geofence = await this.geofenceService.getById(id);
      res.json(geofence);
    } catch (error: any) {
      logger.error('Get geofence error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  update = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const geofence = await this.geofenceService.update(id, req.body);
      res.json(geofence);
    } catch (error: any) {
      logger.error('Update geofence error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  delete = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await this.geofenceService.delete(id);
      res.json({ message: 'Geofence deleted successfully' });
    } catch (error: any) {
      logger.error('Delete geofence error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  toggleActive = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const geofence = await this.geofenceService.toggleActive(id);
      res.json(geofence);
    } catch (error: any) {
      logger.error('Toggle geofence active error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/geofences/geofence.service.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../../config';
import { logger } from '../../utils/logger';

export class GeofenceService {
  async create(data: {
    name: string;
    description?: string;
    latitude: number;
    longitude: number;
    radius: number;
    triggerOnEnter: boolean;
    triggerOnExit: boolean;
    adminId: string;
  }) {
    const geofence = await prisma.geofence.create({
      data,
    });

    logger.info(`Geofence created: ${geofence.name} (${geofence.id})`);
    return geofence;
  }

  async getAll(params: { page: number; limit: number }) {
    const { page, limit } = params;
    const skip = (page - 1) * limit;

    const [geofences, total] = await Promise.all([
      prisma.geofence.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              fullName: true,
            },
          },
        },
      }),
      prisma.geofence.count(),
    ]);

    return {
      data: geofences,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const geofence = await prisma.geofence.findUnique({
      where: { id },
      include: {
        admin: {
          select: {
            id: true,
            username: true,
            fullName: true,
          },
        },
      },
    });

    if (!geofence) {
      throw new Error('Geofence not found');
    }

    return geofence;
  }

  async update(id: string, data: any) {
    const geofence = await prisma.geofence.update({
      where: { id },
      data,
    });

    logger.info(`Geofence updated: ${geofence.name} (${geofence.id})`);
    return geofence;
  }

  async delete(id: string) {
    const geofence = await prisma.geofence.findUnique({
      where: { id },
    });

    if (!geofence) {
      throw new Error('Geofence not found');
    }

    await prisma.geofence.delete({
      where: { id },
    });

    logger.info(`Geofence deleted: ${geofence.name} (${geofence.id})`);
    return { success: true };
  }

  async toggleActive(id: string) {
    const geofence = await prisma.geofence.findUnique({
      where: { id },
    });

    if (!geofence) {
      throw new Error('Geofence not found');
    }

    const updated = await prisma.geofence.update({
      where: { id },
      data: { isActive: !geofence.isActive },
    });

    logger.info(`Geofence ${updated.isActive ? 'activated' : 'deactivated'}: ${updated.name}`);
    return updated;
  }
}

// src/modules/geofences/geofence.routes.ts
import { Router } from 'express';
import { GeofenceController } from './geofence.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { createGeofenceSchema, updateGeofenceSchema } from './geofence.validators';

const router = Router();
const controller = new GeofenceController();

router.post('/', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), validate(createGeofenceSchema), controller.create);
router.get('/', authenticate, controller.getAll);
router.get('/:id', authenticate, controller.getById);
router.put('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), validate(updateGeofenceSchema), controller.update);
router.delete('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), controller.delete);
router.patch('/:id/toggle', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), controller.toggleActive);

export { router as geofenceRoutes };

// src/modules/geofences/geofence.validators.ts
import { z } from 'zod';

export const createGeofenceSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(100),
    description: z.string().max(500).optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radius: z.number().positive().max(10000),
    triggerOnEnter: z.boolean().default(true),
    triggerOnExit: z.boolean().default(true),
  }),
});

export const updateGeofenceSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(100).optional(),
    description: z.string().max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radius: z.number().positive().max(10000).optional(),
    triggerOnEnter: z.boolean().optional(),
    triggerOnExit: z.boolean().optional(),
  }),
});
