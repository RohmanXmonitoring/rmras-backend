// src/repositories/index.ts
export * from './base.repository';
export * from './admin.repository';
export * from './device.repository';
export * from './audit.repository';

// src/repositories/base.repository.ts
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config';

export abstract class BaseRepository<T> {
  protected model: any;

  constructor(model: any) {
    this.model = model;
  }

  async findById(id: string): Promise<T | null> {
    return this.model.findUnique({
      where: { id },
    });
  }

  async findAll(params?: any): Promise<T[]> {
    return this.model.findMany(params);
  }

  async create(data: any): Promise<T> {
    return this.model.create({
      data,
    });
  }

  async update(id: string, data: any): Promise<T> {
    return this.model.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<T> {
    return this.model.delete({
      where: { id },
    });
  }

  async count(where?: any): Promise<number> {
    return this.model.count({ where });
  }
}

// src/repositories/admin.repository.ts
import { prisma } from '../config';
import { BaseRepository } from './base.repository';

export class AdminRepository extends BaseRepository<any> {
  constructor() {
    super(prisma.admin);
  }

  async findByUsername(username: string) {
    return prisma.admin.findUnique({
      where: { username },
    });
  }

  async findByEmail(email: string) {
    return prisma.admin.findUnique({
      where: { email },
    });
  }

  async findWithSessions(id: string) {
    return prisma.admin.findUnique({
      where: { id },
      include: {
        sessions: {
          where: { isRevoked: false },
        },
      },
    });
  }
}

// src/repositories/device.repository.ts
import { prisma } from '../config';
import { BaseRepository } from './base.repository';

export class DeviceRepository extends BaseRepository<any> {
  constructor() {
    super(prisma.device);
  }

  async findByDeviceId(deviceId: string) {
    return prisma.device.findUnique({
      where: { deviceId },
    });
  }

  async findOnline() {
    return prisma.device.findMany({
      where: { status: 'ONLINE' },
    });
  }

  async findWithBattery(deviceId: string) {
    return prisma.device.findUnique({
      where: { deviceId },
      include: {
        battery: true,
      },
    });
  }

  async findWithLocation(deviceId: string) {
    return prisma.device.findUnique({
      where: { deviceId },
      include: {
        location: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });
  }

  async getStatistics() {
    const [total, online, offline, lost, locked] = await Promise.all([
      prisma.device.count(),
      prisma.device.count({ where: { status: 'ONLINE' } }),
      prisma.device.count({ where: { status: 'OFFLINE' } }),
      prisma.device.count({ where: { isLost: true } }),
      prisma.device.count({ where: { isLocked: true } }),
    ]);

    return { total, online, offline, lost, locked };
  }
}

// src/repositories/audit.repository.ts
import { prisma } from '../config';
import { BaseRepository } from './base.repository';

export class AuditRepository extends BaseRepository<any> {
  constructor() {
    super(prisma.auditLog);
  }

  async findByAdminId(adminId: string, params?: any) {
    return prisma.auditLog.findMany({
      where: { adminId },
      ...params,
    });
  }

  async findByResource(resource: string, resourceId?: string) {
    return prisma.auditLog.findMany({
      where: {
        resource,
        ...(resourceId && { resourceId }),
      },
    });
  }

  async getActionsByAdmin(adminId: string) {
    return prisma.auditLog.groupBy({
      by: ['action'],
      where: { adminId },
      _count: true,
    });
  }
}
