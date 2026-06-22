// src/modules/files/index.ts
export * from './file.controller';
export * from './file.service';
export * from './file.routes';
export * from './file.validators';

// src/modules/files/file.controller.ts
import { Request, Response } from 'express';
import { FileService } from './file.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class FileController {
  private fileService: FileService;

  constructor() {
    this.fileService = new FileService();
  }

  uploadFile = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const file = req.file;
      
      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const result = await this.fileService.uploadFile({
        deviceId,
        adminId: req.admin!.id,
        file,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Upload file error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  downloadFile = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.fileService.downloadFile(id);
      res.download(result.filePath, result.fileName);
    } catch (error: any) {
      logger.error('Download file error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getHistory = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, page = 1, limit = 20 } = req.query;
      const history = await this.fileService.getHistory({
        deviceId: deviceId as string,
        page: Number(page),
        limit: Number(limit),
      });
      res.json(history);
    } catch (error: any) {
      logger.error('Get file history error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  deleteFile = async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      await this.fileService.deleteFile(id);
      res.json({ message: 'File deleted successfully' });
    } catch (error: any) {
      logger.error('Delete file error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/files/file.service.ts
import { prisma } from '../../config';
import { logger } from '../../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export class FileService {
  async uploadFile(data: {
    deviceId: string;
    adminId: string;
    file: Express.Multer.File;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId: data.deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    // Generate unique filename
    const ext = path.extname(data.file.originalname);
    const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${ext}`;
    const filePath = path.join(process.env.STORAGE_PATH || './storage/uploads', filename);

    // Move file to storage
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, data.file.buffer);

    const fileTransfer = await prisma.fileTransfer.create({
      data: {
        fileName: data.file.originalname,
        filePath: `/storage/uploads/${filename}`,
        fileSize: data.file.size,
        mimeType: data.file.mimetype,
        direction: 'UPLOAD',
        status: 'COMPLETED',
        adminId: data.adminId,
        deviceId: device.id,
      },
    });

    logger.info(`File uploaded: ${fileTransfer.fileName} for device ${device.deviceId}`);
    return fileTransfer;
  }

  async downloadFile(id: string) {
    const fileTransfer = await prisma.fileTransfer.findUnique({
      where: { id },
    });

    if (!fileTransfer) {
      throw new Error('File not found');
    }

    const filePath = path.join(process.env.STORAGE_PATH || './storage', fileTransfer.filePath);
    
    if (!fs.existsSync(filePath)) {
      throw new Error('File not found on disk');
    }

    return {
      filePath,
      fileName: fileTransfer.fileName,
    };
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

    const [files, total] = await Promise.all([
      prisma.fileTransfer.findMany({
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
      prisma.fileTransfer.count({ where }),
    ]);

    return {
      data: files,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async deleteFile(id: string) {
    const fileTransfer = await prisma.fileTransfer.findUnique({
      where: { id },
    });

    if (!fileTransfer) {
      throw new Error('File not found');
    }

    const filePath = path.join(process.env.STORAGE_PATH || './storage', fileTransfer.filePath);
    
    // Delete file from disk
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }

    await prisma.fileTransfer.delete({
      where: { id },
    });

    logger.info(`File deleted: ${fileTransfer.fileName}`);
    return { success: true };
  }
}

// src/modules/files/file.routes.ts
import { Router } from 'express';
import { FileController } from './file.controller';
import { authenticate } from '../../middlewares/auth';
import { fileUpload } from '../../middlewares/fileUpload';
import { validate } from '../../middlewares/validation';
import { deleteFileSchema } from './file.validators';

const router = Router();
const controller = new FileController();

router.post(
  '/upload/:deviceId',
  authenticate,
  fileUpload.single('file'),
  controller.uploadFile
);
router.get('/download/:id', authenticate, controller.downloadFile);
router.get('/history', authenticate, controller.getHistory);
router.delete(
  '/:id',
  authenticate,
  validate(deleteFileSchema),
  controller.deleteFile
);

export { router as fileRoutes };

// src/modules/files/file.validators.ts
import { z } from 'zod';

export const deleteFileSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});
