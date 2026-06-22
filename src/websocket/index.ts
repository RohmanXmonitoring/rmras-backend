// src/websocket/index.ts
export * from './admin.handlers';
export * from './device.handlers';
export * from './events';

// src/websocket/admin.handlers.ts
import { Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { prisma, redis } from '../config';

export class AdminHandlers {
  constructor(private socket: Socket) {}

  async handleConnection() {
    const adminId = (this.socket.data as any).adminId;
    logger.info(`Admin connected: ${adminId}`);
    
    // Join admin room
    this.socket.join(`admin:${adminId}`);
    
    // Emit connection event
    this.socket.emit('admin:connected', { adminId });
  }

  async handleDisconnection() {
    const adminId = (this.socket.data as any).adminId;
    logger.info(`Admin disconnected: ${adminId}`);
    
    this.socket.emit('admin:disconnected', { adminId });
  }

  async handleDeviceSubscribe(deviceId: string) {
    const adminId = (this.socket.data as any).adminId;
    this.socket.join(`device:${deviceId}`);
    logger.info(`Admin ${adminId} subscribed to device ${deviceId}`);
  }

  async handleDeviceUnsubscribe(deviceId: string) {
    const adminId = (this.socket.data as any).adminId;
    this.socket.leave(`device:${deviceId}`);
    logger.info(`Admin ${adminId} unsubscribed from device ${deviceId}`);
  }

  async handleRemoteRequest(data: any) {
    const { deviceId, sessionType } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Remote assistance requested for device ${deviceId} by admin ${adminId}`);

    // Store session in Redis
    const sessionId = `remote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await redis.setex(
      `remote:request:${deviceId}`,
      60,
      JSON.stringify({
        sessionId,
        adminId,
        sessionType,
        timestamp: new Date().toISOString(),
      })
    );

    // Notify device
    this.socket.to(`device:${deviceId}`).emit('remote:request', {
      sessionId,
      adminId,
      sessionType,
      timestamp: new Date().toISOString(),
    });

    // Notify admin
    this.socket.emit('remote:requested', { 
      deviceId, 
      sessionId,
      status: 'pending' 
    });
  }

  async handleRemoteResponse(data: any) {
    const { sessionId, accepted } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Remote response from device: ${accepted ? 'accepted' : 'rejected'}`);

    // Get admin from Redis
    const requestData = await redis.get(`remote:request:${sessionId}`);
    if (requestData) {
      const parsed = JSON.parse(requestData);
      this.socket.to(`admin:${parsed.adminId}`).emit('remote:response', {
        sessionId,
        accepted,
        timestamp: new Date().toISOString(),
      });
      await redis.del(`remote:request:${sessionId}`);
    }
  }

  async handleScreenStart(data: any) {
    const { deviceId, sessionId } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Screen sharing started for device ${deviceId}`);

    // Create screen session in database
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.screenSession.create({
        data: {
          sessionToken: sessionId,
          status: 'ACTIVE',
          adminId,
          deviceId: device.id,
        },
      });
    }

    // Notify device
    this.socket.to(`device:${deviceId}`).emit('screen:start', {
      sessionId,
      adminId,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('screen:started', { 
      deviceId, 
      sessionId,
      status: 'active' 
    });
  }

  async handleScreenStop(data: any) {
    const { deviceId, sessionId } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Screen sharing stopped for device ${deviceId}`);

    // Update session
    await prisma.screenSession.update({
      where: { sessionToken: sessionId },
      data: {
        status: 'ENDED',
        endedAt: new Date(),
      },
    });

    // Notify device
    this.socket.to(`device:${deviceId}`).emit('screen:stop', {
      sessionId,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('screen:stopped', { 
      deviceId, 
      sessionId,
      status: 'ended' 
    });
  }

  async handleActionNotification(data: any) {
    const { deviceId, title, message, type, extraData } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Sending notification to device ${deviceId}`);

    // Store notification
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.notification.create({
        data: {
          title,
          message,
          type: type || 'INFO',
          data: extraData,
          adminId,
          deviceId: device.id,
        },
      });
    }

    // Send to device
    this.socket.to(`device:${deviceId}`).emit('notification:push', {
      title,
      message,
      type: type || 'INFO',
      data: extraData,
      timestamp: new Date().toISOString(),
    });

    this.socket.emit('notification:sent', { 
      deviceId, 
      success: true 
    });
  }

  async handleActionLostMode(data: any) {
    const { deviceId, enable } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`${enable ? 'Enabling' : 'Disabling'} lost mode for device ${deviceId}`);

    await prisma.device.update({
      where: { deviceId },
      data: { isLost: enable },
    });

    this.socket.to(`device:${deviceId}`).emit('action:lost-mode', { 
      enable,
      timestamp: new Date().toISOString(),
    });
    
    this.socket.emit('lost-mode:updated', { 
      deviceId, 
      enable,
      status: 'success' 
    });
  }

  async handleActionLock(data: any) {
    const { deviceId, lock } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`${lock ? 'Locking' : 'Unlocking'} device ${deviceId}`);

    await prisma.device.update({
      where: { deviceId },
      data: { isLocked: lock },
    });

    this.socket.to(`device:${deviceId}`).emit('action:lock', { 
      lock,
      timestamp: new Date().toISOString(),
    });
    
    this.socket.emit('lock:updated', { 
      deviceId, 
      lock,
      status: 'success' 
    });
  }

  async handleActionRing(data: any) {
    const { deviceId } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Ringing device ${deviceId}`);

    this.socket.to(`device:${deviceId}`).emit('action:ring', {
      timestamp: new Date().toISOString(),
    });
    
    this.socket.emit('ring:sent', { 
      deviceId, 
      status: 'success' 
    });
  }

  async handleActionMessage(data: any) {
    const { deviceId, message } = data;
    const adminId = (this.socket.data as any).adminId;
    
    logger.info(`Sending message to device ${deviceId}`);

    this.socket.to(`device:${deviceId}`).emit('action:message', {
      message,
      adminId,
      timestamp: new Date().toISOString(),
    });
    
    this.socket.emit('message:sent', { 
      deviceId, 
      status: 'success' 
    });
  }
}

// src/websocket/device.handlers.ts
import { Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { prisma, redis } from '../config';

export class DeviceHandlers {
  constructor(private socket: Socket) {}

  async handleConnection() {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device connected: ${deviceId}`);

    // Join device room
    this.socket.join(`device:${deviceId}`);

    // Update device status to online
    await prisma.device.update({
      where: { deviceId },
      data: {
        status: 'ONLINE',
        lastSeenAt: new Date(),
      },
    });

    // Emit connection event
    this.socket.emit('device:connected', { deviceId });
  }

  async handleDisconnection() {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device disconnected: ${deviceId}`);

    // Update device status to offline
    await prisma.device.update({
      where: { deviceId },
      data: {
        status: 'OFFLINE',
        lastSeenAt: new Date(),
      },
    });

    // Notify subscribed admins
    this.socket.to(`device:${deviceId}`).emit('device:disconnected', {
      deviceId,
      timestamp: new Date().toISOString(),
    });
  }

  async handleStatus(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} status update:`, data);

    await prisma.device.update({
      where: { deviceId },
      data: {
        status: data.status,
        lastSeenAt: new Date(),
      },
    });

    // Notify subscribed admins
    this.socket.to(`device:${deviceId}`).emit('device:status', {
      deviceId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async handleInfo(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} info update:`, data);

    await prisma.device.update({
      where: { deviceId },
      data: {
        deviceName: data.deviceName,
        model: data.model,
        manufacturer: data.manufacturer,
        androidVersion: data.androidVersion,
        appVersion: data.appVersion,
      },
    });

    this.socket.to(`device:${deviceId}`).emit('device:info', {
      deviceId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async handleBattery(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} battery update:`, data);

    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.deviceBattery.upsert({
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

      // Check low battery
      if (data.level < 15 && !data.isCharging) {
        await this.sendLowBatteryAlert(deviceId, data.level);
      }
    }

    this.socket.to(`device:${deviceId}`).emit('device:battery', {
      deviceId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async handleLocation(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} location update:`, data);

    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.deviceLocation.create({
        data: {
          ...data,
          deviceId: device.id,
        },
      });

      // Update Redis cache
      await redis.setex(
        `device:location:${deviceId}`,
        3600,
        JSON.stringify({
          ...data,
          timestamp: new Date().toISOString(),
        })
      );

      // Check geofences
      await this.checkGeofences(device.id, data.latitude, data.longitude);
    }

    this.socket.to(`device:${deviceId}`).emit('device:location', {
      deviceId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async handleNetwork(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} network update:`, data);

    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.deviceNetwork.upsert({
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
    }

    this.socket.to(`device:${deviceId}`).emit('device:network', {
      deviceId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  async handleApps(data: any) {
    const deviceId = (this.socket.data as any).deviceId;
    logger.info(`Device ${deviceId} apps update:`, data);

    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      // Delete old apps
      await prisma.deviceApp.deleteMany({
        where: { deviceId: device.id },
      });

      // Insert new apps
      if (data.apps && data.apps.length > 0) {
        await prisma.deviceApp.createMany({
          data: data.apps.map((app: any) => ({
            ...app,
            deviceId: device.id,
            timestamp: new Date(),
          })),
        });
      }
    }

    this.socket.to(`device:${deviceId}`).emit('device:apps', {
      deviceId,
      apps: data.apps,
      timestamp: new Date().toISOString(),
    });
  }

  async handleRemoteResponse(data: any) {
    const { sessionId, accepted } = data;
    const deviceId = (this.socket.data as any).deviceId;
    
    logger.info(`Device ${deviceId} remote assistance response: ${accepted}`);

    // Get admin from Redis
    const requestData = await redis.get(`remote:request:${deviceId}`);
    if (requestData) {
      const parsed = JSON.parse(requestData);
      this.socket.to(`admin:${parsed.adminId}`).emit('remote:response', {
        deviceId,
        accepted,
        sessionId,
        timestamp: new Date().toISOString(),
      });
      await redis.del(`remote:request:${deviceId}`);
    }
  }

  async handleScreenshotResponse(data: any) {
    const { requestId, imageData } = data;
    const deviceId = (this.socket.data as any).deviceId;
    
    logger.info(`Device ${deviceId} screenshot response`);

    // Get request info from Redis
    const request = await redis.get(`screenshot:request:${requestId}`);
    if (request) {
      const parsed = JSON.parse(request);
      
      // Store screenshot
      const device = await prisma.device.findUnique({
        where: { deviceId },
      });

      if (device) {
        const screenshot = await prisma.screenshot.create({
          data: {
            filePath: `/storage/screenshots/${requestId}.jpg`,
            fileSize: Buffer.byteLength(imageData, 'base64'),
            adminId: parsed.adminId,
            deviceId: device.id,
          },
        });

        // Notify admin
        this.socket.to(`admin:${parsed.adminId}`).emit('screenshot:received', {
          requestId,
          deviceId,
          screenshotId: screenshot.id,
          imageData,
          timestamp: new Date().toISOString(),
        });
      }

      await redis.del(`screenshot:request:${requestId}`);
    }
  }

  async handleFileUpload(data: any) {
    const { fileId, chunk, chunkIndex, totalChunks } = data;
    const deviceId = (this.socket.data as any).deviceId;
    
    logger.info(`Device ${deviceId} file upload chunk ${chunkIndex}/${totalChunks}`);

    // Store chunk in Redis
    await redis.setex(
      `file:chunk:${fileId}:${chunkIndex}`,
      3600,
      chunk
    );

    if (chunkIndex === totalChunks - 1) {
      // All chunks received, assemble file
      await this.assembleFile(fileId, totalChunks, deviceId);
      this.socket.to(`device:${deviceId}`).emit('file:complete', {
        fileId,
        deviceId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async handleFileDownload(data: any) {
    const { fileId, chunkIndex } = data;
    const deviceId = (this.socket.data as any).deviceId;
    
    logger.info(`Device ${deviceId} file download chunk ${chunkIndex}`);

    // Get chunk from Redis
    const chunk = await redis.get(`file:chunk:${fileId}:${chunkIndex}`);
    if (chunk) {
      this.socket.emit('file:chunk', {
        fileId,
        chunkIndex,
        chunk,
      });
    }
  }

  async handleSecurityReport(data: any) {
    const { type, severity, message, data: extraData } = data;
    const deviceId = (this.socket.data as any).deviceId;
    
    logger.info(`Device ${deviceId} security report: ${type}`);

    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.securityAlert.create({
        data: {
          type,
          severity,
          message,
          data: extraData,
          deviceId: device.id,
        },
      });

      // Notify admins for critical alerts
      if (severity === 'CRITICAL' || severity === 'HIGH') {
        this.socket.to(`device:${deviceId}`).emit('security:alert', {
          deviceId,
          type,
          severity,
          message,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private async sendLowBatteryAlert(deviceId: string, level: number) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (device) {
      await prisma.notification.create({
        data: {
          title: 'Low Battery Alert',
          message: `Device ${device.deviceName} has low battery (${level}%)`,
          type: 'WARNING',
          data: { level },
          deviceId: device.id,
        },
      });
    }

    this.socket.to(`device:${deviceId}`).emit('notification:push', {
      title: 'Low Battery Alert',
      message: `Device battery is at ${level}%`,
      type: 'WARNING',
      timestamp: new Date().toISOString(),
    });
  }

  private async checkGeofences(deviceId: string, latitude: number, longitude: number) {
    const geofences = await prisma.geofence.findMany({
      where: { isActive: true },
    });

    for (const geofence of geofences) {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        geofence.latitude,
        geofence.longitude
      );

      const isInside = distance <= geofence.radius;
      const key = `geofence:${geofence.id}:${deviceId}`;
      const wasInside = await redis.get(key);

      if (isInside && wasInside === 'false' && geofence.triggerOnEnter) {
        await this.triggerGeofenceAlert(geofence, deviceId, 'ENTER');
        await redis.setex(key, 3600, 'true');
      } else if (!isInside && wasInside === 'true' && geofence.triggerOnExit) {
        await this.triggerGeofenceAlert(geofence, deviceId, 'EXIT');
        await redis.setex(key, 3600, 'false');
      }
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  private async triggerGeofenceAlert(geofence: any, deviceId: string, type: string) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (device) {
      await prisma.notification.create({
        data: {
          title: `Geofence ${type === 'ENTER' ? 'Entry' : 'Exit'}`,
          message: `Device ${device.deviceName} ${type === 'ENTER' ? 'entered' : 'exited'} geofence ${geofence.name}`,
          type: 'ALERT',
          data: {
            geofenceId: geofence.id,
            geofenceName: geofence.name,
            type,
            deviceId: device.deviceId,
          },
          deviceId: device.id,
        },
      });
    }

    this.socket.to(`device:${deviceId}`).emit('geofence:alert', {
      geofenceId: geofence.id,
      geofenceName: geofence.name,
      type,
      deviceId,
      timestamp: new Date().toISOString(),
    });
  }

  private async assembleFile(fileId: string, totalChunks: number, deviceId: string) {
    // Implement file assembly from Redis chunks
    // Store file in filesystem and create database record
    logger.info(`Assembling file ${fileId} with ${totalChunks} chunks from device ${deviceId}`);
  }
}

// src/websocket/events.ts
export const EVENTS = {
  // Admin events
  ADMIN_CONNECTED: 'admin:connected',
  ADMIN_DISCONNECTED: 'admin:disconnected',
  
  // Device events
  DEVICE_CONNECTED: 'device:connected',
  DEVICE_DISCONNECTED: 'device:disconnected',
  
  // Device status events
  DEVICE_STATUS: 'device:status',
  DEVICE_BATTERY: 'device:battery',
  DEVICE_NETWORK: 'device:network',
  DEVICE_LOCATION: 'device:location',
  DEVICE_HEALTH: 'device:health',
  DEVICE_INFO: 'device:info',
  DEVICE_APPS: 'device:apps',
  
  // Remote assistance events
  REMOTE_REQUEST: 'remote:request',
  REMOTE_RESPONSE: 'remote:response',
  REMOTE_ACCEPTED: 'remote:accepted',
  REMOTE_REJECTED: 'remote:rejected',
  REMOTE_ENDED: 'remote:ended',
  
  // Screen sharing events
  SCREEN_START: 'screen:start',
  SCREEN_STOP: 'screen:stop',
  SCREEN_STARTED: 'screen:started',
  SCREEN_STOPPED: 'screen:stopped',
  
  // Recording events
  RECORDING_START: 'recording:start',
  RECORDING_STOP: 'recording:stop',
  
  // Screenshot events
  SCREENSHOT_REQUEST: 'screenshot:request',
  SCREENSHOT_RESPONSE: 'screenshot:response',
  SCREENSHOT_RECEIVED: 'screenshot:received',
  
  // Notification events
  NOTIFICATION_PUSH: 'notification:push',
  NOTIFICATION_SENT: 'notification:sent',
  
  // Security events
  SECURITY_ALERT: 'security:alert',
  
  // Geofence events
  GEOFENCE_ALERT: 'geofence:alert',
  
  // File events
  FILE_UPLOAD: 'file:upload',
  FILE_DOWNLOAD: 'file:download',
  FILE_COMPLETE: 'file:complete',
  FILE_CHUNK: 'file:chunk',
  
  // Action events
  ACTION_NOTIFICATION: 'action:notification',
  ACTION_RING: 'action:ring',
  ACTION_LOST_MODE: 'action:lost-mode',
  ACTION_LOCK: 'action:lock',
  ACTION_MESSAGE: 'action:message',
};
