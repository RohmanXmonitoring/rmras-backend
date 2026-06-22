// src/websocket/index.ts
import { Server as SocketServer, Socket } from 'socket.io';
import { prisma, redis } from '../config';
import { logger } from '../utils/logger';
import jwt from 'jsonwebtoken';

interface SocketData {
  adminId?: string;
  deviceId?: string;
}

export const setupWebSocket = (io: SocketServer) => {
  // Admin namespace
  const adminNamespace = io.of('/admin');
  // Device namespace
  const deviceNamespace = io.of('/device');

  // Admin authentication middleware
  adminNamespace.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      const session = await prisma.session.findUnique({
        where: { token },
        include: { admin: true },
      });

      if (!session || session.isRevoked || session.expiresAt < new Date()) {
        return next(new Error('Invalid or expired session'));
      }

      (socket.data as SocketData).adminId = session.admin.id;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  // Device authentication middleware
  deviceNamespace.use(async (socket: Socket, next) => {
    try {
      const deviceId = socket.handshake.auth.deviceId;
      const token = socket.handshake.auth.token;

      if (!deviceId || !token) {
        return next(new Error('Authentication required'));
      }

      // Validate device token
      const device = await prisma.device.findUnique({
        where: { deviceId },
      });

      if (!device || !device.isActive) {
        return next(new Error('Device not found or inactive'));
      }

      // Verify token (you can implement device-specific token validation)
      const isValid = await verifyDeviceToken(deviceId, token);
      if (!isValid) {
        return next(new Error('Invalid device token'));
      }

      (socket.data as SocketData).deviceId = deviceId;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  // Admin socket handlers
  adminNamespace.on('connection', (socket: Socket) => {
    const adminId = (socket.data as SocketData).adminId!;
    logger.info(`Admin connected: ${adminId}`);

    // Join admin room
    socket.join(`admin:${adminId}`);

    // Emit connection event
    socket.emit('admin:connected', { adminId });

    // Handle device monitoring
    socket.on('device:subscribe', async (deviceId: string) => {
      socket.join(`device:${deviceId}`);
      logger.info(`Admin ${adminId} subscribed to device ${deviceId}`);
    });

    socket.on('device:unsubscribe', async (deviceId: string) => {
      socket.leave(`device:${deviceId}`);
      logger.info(`Admin ${adminId} unsubscribed from device ${deviceId}`);
    });

    // Handle remote assistance
    socket.on('remote:request', async (data) => {
      const { deviceId, sessionType } = data;
      logger.info(`Remote assistance requested for device ${deviceId} by admin ${adminId}`);

      // Store session in Redis for device to poll
      await redis.setex(
        `remote:request:${deviceId}`,
        60,
        JSON.stringify({
          adminId,
          sessionType,
          timestamp: new Date().toISOString(),
        })
      );

      // Notify device
      deviceNamespace.to(`device:${deviceId}`).emit('remote:request', {
        adminId,
        sessionType,
        requestId: generateRequestId(),
      });

      // Notify admin
      socket.emit('remote:requested', { deviceId, status: 'pending' });
    });

    // Handle screen sharing
    socket.on('screen:start', async (data) => {
      const { deviceId, sessionId } = data;
      logger.info(`Screen sharing started for device ${deviceId}`);

      // Create screen session in database
      const session = await prisma.screenSession.create({
        data: {
          sessionToken: sessionId,
          status: 'ACTIVE',
          adminId,
          deviceId,
        },
      });

      // Notify device
      deviceNamespace.to(`device:${deviceId}`).emit('screen:start', {
        sessionId,
        adminId,
      });

      socket.emit('screen:started', { deviceId, sessionId });
    });

    socket.on('screen:stop', async (data) => {
      const { deviceId, sessionId } = data;
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
      deviceNamespace.to(`device:${deviceId}`).emit('screen:stop', {
        sessionId,
      });

      socket.emit('screen:stopped', { deviceId, sessionId });
    });

    // Handle device actions
    socket.on('action:notification', async (data) => {
      const { deviceId, title, message, data: extraData } = data;
      logger.info(`Sending notification to device ${deviceId}`);

      // Store notification
      await prisma.notification.create({
        data: {
          title,
          message,
          type: 'INFO',
          data: extraData,
          adminId,
          deviceId,
        },
      });

      // Send to device
      deviceNamespace.to(`device:${deviceId}`).emit('notification:push', {
        title,
        message,
        data: extraData,
        timestamp: new Date().toISOString(),
      });

      socket.emit('notification:sent', { deviceId, success: true });
    });

    socket.on('action:lost-mode', async (data) => {
      const { deviceId, enable } = data;
      logger.info(`${enable ? 'Enabling' : 'Disabling'} lost mode for device ${deviceId}`);

      await prisma.device.update({
        where: { deviceId },
        data: { isLost: enable },
      });

      deviceNamespace.to(`device:${deviceId}`).emit('action:lost-mode', { enable });
      socket.emit('lost-mode:updated', { deviceId, enable });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`Admin disconnected: ${adminId}`);
      socket.emit('admin:disconnected', { adminId });
    });
  });

  // Device socket handlers
  deviceNamespace.on('connection', (socket: Socket) => {
    const deviceId = (socket.data as SocketData).deviceId!;
    logger.info(`Device connected: ${deviceId}`);

    // Join device room
    socket.join(`device:${deviceId}`);

    // Update device status to online
    prisma.device.update({
      where: { deviceId },
      data: { 
        status: 'ONLINE',
        lastSeenAt: new Date(),
      },
    }).catch(error => {
      logger.error('Failed to update device status:', error);
    });

    // Emit connection event
    socket.emit('device:connected', { deviceId });

    // Handle device status updates
    socket.on('device:status', async (data) => {
      logger.info(`Device ${deviceId} status update:`, data);

      // Update device in database
      await prisma.device.update({
        where: { deviceId },
        data: {
          status: data.status,
          lastSeenAt: new Date(),
        },
      });

      // Notify subscribed admins
      adminNamespace.to(`device:${deviceId}`).emit('device:status', {
        deviceId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle device information updates
    socket.on('device:info', async (data) => {
      logger.info(`Device ${deviceId} info update:`, data);

      // Update device basic info
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

      adminNamespace.to(`device:${deviceId}`).emit('device:info', {
        deviceId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle battery updates
    socket.on('device:battery', async (data) => {
      logger.info(`Device ${deviceId} battery update:`, data);

      await prisma.deviceBattery.upsert({
        where: { deviceId },
        update: {
          level: data.level,
          isCharging: data.isCharging,
          temperature: data.temperature,
          voltage: data.voltage,
          timestamp: new Date(),
        },
        create: {
          level: data.level,
          isCharging: data.isCharging,
          temperature: data.temperature,
          voltage: data.voltage,
          deviceId,
        },
      });

      adminNamespace.to(`device:${deviceId}`).emit('device:battery', {
        deviceId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle location updates
    socket.on('device:location', async (data) => {
      logger.info(`Device ${deviceId} location update:`, data);

      await prisma.deviceLocation.create({
        data: {
          latitude: data.latitude,
          longitude: data.longitude,
          altitude: data.altitude,
          accuracy: data.accuracy,
          speed: data.speed,
          heading: data.heading,
          provider: data.provider,
          isGpsEnabled: data.isGpsEnabled,
          isNetworkEnabled: data.isNetworkEnabled,
          deviceId,
        },
      });

      adminNamespace.to(`device:${deviceId}`).emit('device:location', {
        deviceId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle network updates
    socket.on('device:network', async (data) => {
      logger.info(`Device ${deviceId} network update:`, data);

      await prisma.deviceNetwork.upsert({
        where: { deviceId },
        update: {
          type: data.type,
          ssid: data.ssid,
          signalStrength: data.signalStrength,
          linkSpeed: data.linkSpeed,
          ipAddress: data.ipAddress,
          macAddress: data.macAddress,
          isConnected: data.isConnected,
          timestamp: new Date(),
        },
        create: {
          type: data.type,
          ssid: data.ssid,
          signalStrength: data.signalStrength,
          linkSpeed: data.linkSpeed,
          ipAddress: data.ipAddress,
          macAddress: data.macAddress,
          isConnected: data.isConnected,
          deviceId,
        },
      });

      adminNamespace.to(`device:${deviceId}`).emit('device:network', {
        deviceId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle installed apps update
    socket.on('device:apps', async (data) => {
      logger.info(`Device ${deviceId} apps update:`, data);

      // Delete old apps
      await prisma.deviceApp.deleteMany({
        where: { deviceId },
      });

      // Insert new apps
      await prisma.deviceApp.createMany({
        data: data.apps.map((app: any) => ({
          ...app,
          deviceId,
          timestamp: new Date(),
        })),
      });

      adminNamespace.to(`device:${deviceId}`).emit('device:apps', {
        deviceId,
        apps: data.apps,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle remote assistance response
    socket.on('remote:response', async (data) => {
      const { requestId, accepted } = data;
      logger.info(`Device ${deviceId} remote assistance response: ${accepted}`);

      // Get admin from Redis
      const requestData = await redis.get(`remote:request:${deviceId}`);
      if (requestData) {
        const parsed = JSON.parse(requestData);
        adminNamespace.to(`admin:${parsed.adminId}`).emit('remote:response', {
          deviceId,
          accepted,
          requestId,
        });
        await redis.del(`remote:request:${deviceId}`);
      }
    });

    // Handle screenshot response
    socket.on('screenshot:response', async (data) => {
      const { requestId, imageData } = data;
      logger.info(`Device ${deviceId} screenshot response`);

      // Store screenshot
      const screenshot = await prisma.screenshot.create({
        data: {
          filePath: `/storage/screenshots/${requestId}.jpg`,
          fileSize: Buffer.byteLength(imageData, 'base64'),
          adminId: data.adminId,
          deviceId,
        },
      });

      // Notify admin
      adminNamespace.to(`admin:${data.adminId}`).emit('screenshot:received', {
        requestId,
        deviceId,
        screenshotId: screenshot.id,
        imageData,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle file transfer
    socket.on('file:upload', async (data) => {
      const { fileId, chunk, chunkIndex, totalChunks } = data;
      logger.info(`Device ${deviceId} file upload chunk ${chunkIndex}/${totalChunks}`);

      // Store chunk in Redis
      await redis.setex(
        `file:chunk:${fileId}:${chunkIndex}`,
        3600,
        chunk
      );

      if (chunkIndex === totalChunks - 1) {
        // All chunks received, assemble file
        await assembleFile(fileId, totalChunks, deviceId);
        adminNamespace.to(`device:${deviceId}`).emit('file:complete', {
          fileId,
          deviceId,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Handle file download
    socket.on('file:download', async (data) => {
      const { fileId, chunkIndex } = data;
      logger.info(`Device ${deviceId} file download chunk ${chunkIndex}`);

      // Get chunk from Redis
      const chunk = await redis.get(`file:chunk:${fileId}:${chunkIndex}`);
      if (chunk) {
        socket.emit('file:chunk', {
          fileId,
          chunkIndex,
          chunk,
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      logger.info(`Device disconnected: ${deviceId}`);

      // Update device status to offline
      prisma.device.update({
        where: { deviceId },
        data: { 
          status: 'OFFLINE',
          lastSeenAt: new Date(),
        },
      }).catch(error => {
        logger.error('Failed to update device status:', error);
      });

      // Notify subscribed admins
      adminNamespace.to(`device:${deviceId}`).emit('device:disconnected', {
        deviceId,
        timestamp: new Date().toISOString(),
      });
    });
  });

  // Helper functions
  function generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async function verifyDeviceToken(deviceId: string, token: string): Promise<boolean> {
    // Implement device token validation
    // You can use a simple token stored in database or JWT
    return true;
  }

  async function assembleFile(fileId: string, totalChunks: number, deviceId: string) {
    // Implement file assembly from Redis chunks
    // Store file in filesystem and create database record
    logger.info(`Assembling file ${fileId} with ${totalChunks} chunks`);
  }

  // Error handling
  io.on('error', (error) => {
    logger.error('Socket.IO error:', error);
  });

  io.on('connection_error', (error) => {
    logger.error('Socket.IO connection error:', error);
  });
};
