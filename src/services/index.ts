// src/services/index.ts
export * from './email.service';
export * from './notification.service';
export * from './storage.service';
export * from './webrtc.service';

// src/services/notification.service.ts
import { prisma, redis } from '../config';
import { logger } from '../utils/logger';

export class NotificationService {
  async sendPushNotification(deviceId: string, notification: {
    title: string;
    message: string;
    type: string;
    data?: any;
  }) {
    // Send push notification via Firebase or other push service
    // This is a placeholder - implement actual push notification logic
    logger.info(`Sending push notification to device ${deviceId}:`, notification);
    
    // Store in Redis for offline devices
    await redis.lpush(
      `push:notifications:${deviceId}`,
      JSON.stringify({
        ...notification,
        timestamp: new Date().toISOString(),
      })
    );
    await redis.expire(`push:notifications:${deviceId}`, 86400); // 24 hours
  }

  async getOfflineNotifications(deviceId: string) {
    const notifications = await redis.lrange(`push:notifications:${deviceId}`, 0, -1);
    return notifications.map(n => JSON.parse(n));
  }

  async clearOfflineNotifications(deviceId: string) {
    await redis.del(`push:notifications:${deviceId}`);
  }
}

// src/services/storage.service.ts
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export class StorageService {
  private storagePath: string;

  constructor() {
    this.storagePath = process.env.STORAGE_PATH || './storage';
    this.ensureDirectories();
  }

  private ensureDirectories() {
    const dirs = [
      this.storagePath,
      path.join(this.storagePath, 'uploads'),
      path.join(this.storagePath, 'screenshots'),
      path.join(this.storagePath, 'recordings'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async saveFile(buffer: Buffer, filename: string, subdir: string = 'uploads'): Promise<string> {
    const dir = path.join(this.storagePath, subdir);
    const filepath = path.join(dir, filename);
    
    await fs.promises.writeFile(filepath, buffer);
    logger.info(`File saved: ${filepath}`);
    
    return `/storage/${subdir}/${filename}`;
  }

  async getFile(filepath: string): Promise<Buffer> {
    const fullPath = path.join(this.storagePath, filepath.replace('/storage/', ''));
    return fs.promises.readFile(fullPath);
  }

  async deleteFile(filepath: string): Promise<void> {
    const fullPath = path.join(this.storagePath, filepath.replace('/storage/', ''));
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
      logger.info(`File deleted: ${fullPath}`);
    }
  }

  async getFileStats(filepath: string) {
    const fullPath = path.join(this.storagePath, filepath.replace('/storage/', ''));
    const stats = await fs.promises.stat(fullPath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    };
  }

  async listFiles(subdir: string = 'uploads'): Promise<string[]> {
    const dir = path.join(this.storagePath, subdir);
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs.promises.readdir(dir);
  }

  async cleanOldFiles(days: number = 30, subdir: string = 'uploads') {
    const dir = path.join(this.storagePath, subdir);
    if (!fs.existsSync(dir)) {
      return;
    }

    const files = await fs.promises.readdir(dir);
    const now = Date.now();
    const threshold = days * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filepath = path.join(dir, file);
      const stats = await fs.promises.stat(filepath);
      if (now - stats.mtimeMs > threshold) {
        await fs.promises.unlink(filepath);
        logger.info(`Deleted old file: ${filepath}`);
      }
    }
  }
}

// src/services/webrtc.service.ts
import { prisma, redis } from '../config';
import { logger } from '../utils/logger';
import { generateToken } from '../utils/helpers';

export class WebRTCService {
  private stunServers: string[];
  private turnServers: any[];

  constructor() {
    this.stunServers = (process.env.WEBRTC_STUN_SERVERS || 'stun:stun.l.google.com:19302').split(',');
    this.turnServers = [];
    
    if (process.env.WEBRTC_TURN_SERVERS) {
      this.turnServers = process.env.WEBRTC_TURN_SERVERS.split(',').map(server => ({
        urls: server,
        username: process.env.WEBRTC_TURN_USERNAME,
        credential: process.env.WEBRTC_TURN_PASSWORD,
      }));
    }
  }

  getICEServers() {
    return {
      iceServers: [
        ...this.stunServers.map(url => ({ urls: url })),
        ...this.turnServers,
      ],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 10,
    };
  }

  async generateToken(sessionId: string, userId: string, role: 'admin' | 'device') {
    const token = generateToken(64);
    const expiresIn = 300; // 5 minutes

    await redis.setex(
      `webrtc:token:${token}`,
      expiresIn,
      JSON.stringify({
        sessionId,
        userId,
        role,
        timestamp: new Date().toISOString(),
      })
    );

    return token;
  }

  async verifyToken(token: string) {
    const data = await redis.get(`webrtc:token:${token}`);
    if (!data) {
      throw new Error('Invalid or expired token');
    }
    return JSON.parse(data);
  }

  async createOffer(sessionId: string, sdp: string) {
    const key = `webrtc:offer:${sessionId}`;
    await redis.setex(key, 60, sdp);
    return key;
  }

  async getOffer(sessionId: string) {
    const sdp = await redis.get(`webrtc:offer:${sessionId}`);
    if (!sdp) {
      throw new Error('Offer not found');
    }
    return sdp;
  }

  async createAnswer(sessionId: string, sdp: string) {
    const key = `webrtc:answer:${sessionId}`;
    await redis.setex(key, 60, sdp);
    return key;
  }

  async getAnswer(sessionId: string) {
    const sdp = await redis.get(`webrtc:answer:${sessionId}`);
    if (!sdp) {
      throw new Error('Answer not found');
    }
    return sdp;
  }

  async exchangeIceCandidates(sessionId: string, candidate: any) {
    const key = `webrtc:ice:${sessionId}`;
    await redis.rpush(key, JSON.stringify(candidate));
    await redis.expire(key, 60);
    return key;
  }

  async getIceCandidates(sessionId: string) {
    const key = `webrtc:ice:${sessionId}`;
    const candidates = await redis.lrange(key, 0, -1);
    return candidates.map(c => JSON.parse(c));
  }
}
