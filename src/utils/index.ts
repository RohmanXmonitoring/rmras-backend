// src/utils/index.ts
export * from './logger';
export * from './helpers';
export * from './encryption';
export * from './validator';
export * from './constants';

// src/utils/encryption.ts
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.JWT_SECRET || 'default-secret-key-32-characters', 'utf-8').slice(0, 32);

export const encrypt = (text: string): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${tag}`;
};

export const decrypt = (encrypted: string): string => {
  const [ivHex, encryptedText, tagHex] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

export const hash = (text: string): string => {
  return crypto.createHash('sha256').update(text).digest('hex');
};

export const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// src/utils/validator.ts
import { z } from 'zod';

export const validateEmail = (email: string): boolean => {
  const emailSchema = z.string().email();
  try {
    emailSchema.parse(email);
    return true;
  } catch {
    return false;
  }
};

export const validatePassword = (password: string): boolean => {
  const passwordSchema = z.string().min(8).max(100);
  try {
    passwordSchema.parse(password);
    return true;
  } catch {
    return false;
  }
};

export const validatePhone = (phone: string): boolean => {
  const phoneSchema = z.string().regex(/^\+?[\d\s-]{10,15}$/);
  try {
    phoneSchema.parse(phone);
    return true;
  } catch {
    return false;
  }
};

export const validateURL = (url: string): boolean => {
  const urlSchema = z.string().url();
  try {
    urlSchema.parse(url);
    return true;
  } catch {
    return false;
  }
};

// src/utils/constants.ts
export const constants = {
  STATUS: {
    ONLINE: 'ONLINE',
    OFFLINE: 'OFFLINE',
    MAINTENANCE: 'MAINTENANCE',
    LOST: 'LOST',
    LOCKED: 'LOCKED',
  },
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ADMIN: 'ADMIN',
    VIEWER: 'VIEWER',
  },
  NOTIFICATION_TYPES: {
    INFO: 'INFO',
    WARNING: 'WARNING',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR',
    ALERT: 'ALERT',
  },
  SECURITY_ALERT_TYPES: {
    UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
    SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
    BRUTE_FORCE: 'BRUTE_FORCE',
    MALWARE: 'MALWARE',
    ROOT_DETECTED: 'ROOT_DETECTED',
    VPN_DETECTED: 'VPN_DETECTED',
    SCREEN_RECORDING: 'SCREEN_RECORDING',
  },
  SECURITY_ALERT_SEVERITY: {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  },
  SESSION_STATUS: {
    REQUESTED: 'REQUESTED',
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    ACTIVE: 'ACTIVE',
    ENDED: 'ENDED',
    TIMEOUT: 'TIMEOUT',
  },
};
