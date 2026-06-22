// src/modules/admins/admin.controller.ts
import { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = new AdminService();
  }

  getAll = async (req: AuthRequest, res: Response) => {
    try {
      const { page = 1, limit = 20, search, role } = req.query;
      const result = await this.adminService.getAll({
        page: Number(page),
        limit: Number(limit),
        search: search as string,
        role: role as string,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Get all admins error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  getById = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const admin = await this.adminService.getById(id);
      res.json(admin);
    } catch (error: any) {
      logger.error('Get admin by id error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  create = async (req: AuthRequest, res: Response) => {
    try {
      const admin = await this.adminService.create(req.body);
      res.status(201).json(admin);
    } catch (error: any) {
      logger.error('Create admin error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  update = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const admin = await this.adminService.update(id, req.body);
      res.json(admin);
    } catch (error: any) {
      logger.error('Update admin error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  delete = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await this.adminService.delete(id);
      res.json({ message: 'Admin deleted successfully' });
    } catch (error: any) {
      logger.error('Delete admin error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  toggleActive = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const admin = await this.adminService.toggleActive(id);
      res.json(admin);
    } catch (error: any) {
      logger.error('Toggle admin active error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/admins/admin.service.ts
import { Prisma, Admin } from '@prisma/client';
import { prisma } from '../../config';
import bcrypt from 'bcrypt';
import { logger } from '../../utils/logger';

export class AdminService {
  async getAll(params: {
    page: number;
    limit: number;
    search?: string;
    role?: string;
  }) {
    const { page, limit, search, role } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.AdminWhereInput = {};
    
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role as any;
    }

    const [admins, total] = await Promise.all([
      prisma.admin.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              sessions: true,
              auditLogs: true,
            },
          },
        },
      }),
      prisma.admin.count({ where }),
    ]);

    return {
      data: admins,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getById(id: string) {
    const admin = await prisma.admin.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        sessions: {
          where: { isRevoked: false },
          select: {
            id: true,
            deviceInfo: true,
            ipAddress: true,
            createdAt: true,
            expiresAt: true,
          },
        },
        _count: {
          select: {
            auditLogs: true,
            activityLogs: true,
            notifications: true,
          },
        },
      },
    });

    if (!admin) {
      throw new Error('Admin not found');
    }

    return admin;
  }

  async create(data: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    role?: string;
  }) {
    // Check if username or email exists
    const existing = await prisma.admin.findFirst({
      where: {
        OR: [
          { username: data.username },
          { email: data.email },
        ],
      },
    });

    if (existing) {
      throw new Error('Username or email already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const admin = await prisma.admin.create({
      data: {
        username: data.username,
        email: data.email,
        password: hashedPassword,
        fullName: data.fullName,
        role: data.role as any || 'ADMIN',
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    logger.info(`Admin created: ${admin.username} (${admin.id})`);
    return admin;
  }

  async update(id: string, data: {
    username?: string;
    email?: string;
    fullName?: string;
    role?: string;
    isActive?: boolean;
  }) {
    const admin = await prisma.admin.update({
      where: { id },
      data: {
        username: data.username,
        email: data.email,
        fullName: data.fullName,
        role: data.role as any,
        isActive: data.isActive,
      },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    logger.info(`Admin updated: ${admin.username} (${admin.id})`);
    return admin;
  }

  async delete(id: string) {
    // Check if admin exists
    const admin = await prisma.admin.findUnique({
      where: { id },
    });

    if (!admin) {
      throw new Error('Admin not found');
    }

    // Cannot delete super admin
    if (admin.role === 'SUPER_ADMIN') {
      throw new Error('Cannot delete super admin');
    }

    await prisma.admin.delete({
      where: { id },
    });

    logger.info(`Admin deleted: ${admin.username} (${admin.id})`);
    return { success: true };
  }

  async toggleActive(id: string) {
    const admin = await prisma.admin.findUnique({
      where: { id },
    });

    if (!admin) {
      throw new Error('Admin not found');
    }

    // Cannot deactivate super admin
    if (admin.role === 'SUPER_ADMIN') {
      throw new Error('Cannot deactivate super admin');
    }

    const updated = await prisma.admin.update({
      where: { id },
      data: { isActive: !admin.isActive },
      select: {
        id: true,
        username: true,
        isActive: true,
      },
    });

    logger.info(`Admin ${updated.isActive ? 'activated' : 'deactivated'}: ${updated.username}`);
    return updated;
  }
}

// src/modules/admins/admin.routes.ts
import { Router } from 'express';
import { AdminController } from './admin.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { createAdminSchema, updateAdminSchema } from './admin.validators';

const router = Router();
const controller = new AdminController();

router.get('/', authenticate, authorize('SUPER_ADMIN'), controller.getAll);
router.get('/:id', authenticate, authorize('SUPER_ADMIN', 'ADMIN'), controller.getById);
router.post('/', authenticate, authorize('SUPER_ADMIN'), validate(createAdminSchema), controller.create);
router.put('/:id', authenticate, authorize('SUPER_ADMIN'), validate(updateAdminSchema), controller.update);
router.delete('/:id', authenticate, authorize('SUPER_ADMIN'), controller.delete);
router.patch('/:id/toggle-active', authenticate, authorize('SUPER_ADMIN'), controller.toggleActive);

export { router as adminRoutes };

// src/modules/admins/admin.validators.ts
import { z } from 'zod';

export const createAdminSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(50),
    email: z.string().email(),
    password: z.string().min(8).max(100),
    fullName: z.string().min(2).max(100),
    role: z.enum(['ADMIN', 'VIEWER']).optional(),
  }),
});

export const updateAdminSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(50).optional(),
    email: z.string().email().optional(),
    fullName: z.string().min(2).max(100).optional(),
    role: z.enum(['ADMIN', 'VIEWER']).optional(),
    isActive: z.boolean().optional(),
  }),
});
