// src/middlewares/index.ts
export * from './auth';
export * from './rateLimiter';
export * from './validation';
export * from './errorHandler';
export * from './cors';
export * from './helmet';
export * from './compression';
export * from './logging';
export * from './fileUpload';

// src/middlewares/fileUpload.ts
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(process.env.STORAGE_PATH || './storage/uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedTypes = (process.env.FILE_ALLOWED_TYPES || 'image/*,video/*,application/*').split(',');
  const isAllowed = allowedTypes.some(type => {
    if (type.endsWith('/*')) {
      const category = type.replace('/*', '');
      return file.mimetype.startsWith(category);
    }
    return file.mimetype === type;
  });

  if (isAllowed) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed'));
  }
};

const maxSize = parseInt(process.env.UPLOAD_MAX_SIZE || '104857600'); // 100MB

export const fileUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: maxSize,
  },
});

// src/middlewares/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
    }),
  });
};

// src/middlewares/cors.ts
import cors from 'cors';
import { logger } from '../utils/logger';

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = (process.env.SOCKET_CORS_ORIGIN || '*').split(',');
    
    if (allowedOrigins.includes('*') || !origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 86400,
};

export const corsMiddleware = cors(corsOptions);

// src/middlewares/helmet.ts
import helmet from 'helmet';

export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  xssFilter: true,
});

// src/middlewares/compression.ts
import compression from 'compression';

export const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
});

// src/middlewares/logging.ts
import morgan from 'morgan';
import { logger } from '../utils/logger';

const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export const loggingMiddleware = morgan('combined', { stream });

// src/middlewares/validation.ts
export * from './validation';
