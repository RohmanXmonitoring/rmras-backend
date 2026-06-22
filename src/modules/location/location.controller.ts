// src/modules/location/location.controller.ts
import { Request, Response } from 'express';
import { LocationService } from './location.service';
import { AuthRequest } from '../../middlewares/auth';
import { logger } from '../../utils/logger';

export class LocationController {
  private locationService: LocationService;

  constructor() {
    this.locationService = new LocationService();
  }

  updateLocation = async (req: Request, res: Response) => {
    try {
      const { deviceId } = req.params;
      const location = await this.locationService.updateLocation(deviceId, req.body);
      res.json(location);
    } catch (error: any) {
      logger.error('Update location error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getLiveLocation = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const location = await this.locationService.getLiveLocation(deviceId);
      res.json(location);
    } catch (error: any) {
      logger.error('Get live location error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  getHistory = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.params;
      const { from, to, limit = 100 } = req.query;
      const history = await this.locationService.getHistory(
        deviceId,
        from as string,
        to as string,
        Number(limit)
      );
      res.json(history);
    } catch (error: any) {
      logger.error('Get location history error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  findDevice = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId } = req.body;
      const location = await this.locationService.findDevice(deviceId);
      res.json(location);
    } catch (error: any) {
      logger.error('Find device error:', error);
      res.status(404).json({ error: error.message });
    }
  };

  lostMode = async (req: AuthRequest, res: Response) => {
    try {
      const { deviceId, enable } = req.body;
      const result = await this.locationService.lostMode(deviceId, enable);
      res.json(result);
    } catch (error: any) {
      logger.error('Lost mode error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  getNearby = async (req: AuthRequest, res: Response) => {
    try {
      const { latitude, longitude, radius = 1000 } = req.query;
      const devices = await this.locationService.getNearby(
        Number(latitude),
        Number(longitude),
        Number(radius)
      );
      res.json(devices);
    } catch (error: any) {
      logger.error('Get nearby devices error:', error);
      res.status(400).json({ error: error.message });
    }
  };
}

// src/modules/location/location.service.ts
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';

export class LocationService {
  async updateLocation(deviceId: string, data: {
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    provider?: string;
    isGpsEnabled?: boolean;
    isNetworkEnabled?: boolean;
  }) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const location = await prisma.deviceLocation.create({
      data: {
        ...data,
        deviceId: device.id,
      },
    });

    // Update device last location in Redis for fast access
    await redis.setex(
      `device:location:${deviceId}`,
      3600,
      JSON.stringify(location)
    );

    // Check geofences
    await this.checkGeofences(device.id, data.latitude, data.longitude);

    logger.info(`Location updated for device ${deviceId}`);
    return location;
  }

  async getLiveLocation(deviceId: string) {
    // Try to get from Redis first
    const cached = await redis.get(`device:location:${deviceId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get from database
    const location = await prisma.deviceLocation.findFirst({
      where: {
        device: {
          deviceId,
        },
      },
      orderBy: { timestamp: 'desc' },
      include: {
        device: {
          select: {
            deviceId: true,
            deviceName: true,
            status: true,
          },
        },
      },
    });

    if (!location) {
      throw new Error('No location data available');
    }

    return location;
  }

  async getHistory(deviceId: string, from?: string, to?: string, limit: number = 100) {
    const device = await prisma.device.findUnique({
      where: { deviceId },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const where: any = {
      deviceId: device.id,
    };

    if (from) {
      where.timestamp = { ...where.timestamp, gte: new Date(from) };
    }
    if (to) {
      where.timestamp = { ...where.timestamp, lte: new Date(to) };
    }

    const locations = await prisma.deviceLocation.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return locations;
  }

  async findDevice(deviceId: string) {
    const location = await this.getLiveLocation(deviceId);
    return {
      deviceId,
      location,
      found: true,
      timestamp: new Date().toISOString(),
    };
  }

  async lostMode(deviceId: string, enable: boolean) {
    const device = await prisma.device.update({
      where: { deviceId },
      data: { isLost: enable },
    });

    if (enable) {
      // Send notification
      await this.notifyLostMode(deviceId);
    }

    return {
      deviceId,
      isLost: device.isLost,
      enabled: enable,
      timestamp: new Date().toISOString(),
    };
  }

  async getNearby(latitude: number, longitude: number, radius: number) {
    // Using PostGIS would be better, but for now we'll use a simple calculation
    const devices = await prisma.deviceLocation.findMany({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
        },
      },
      include: {
        device: true,
      },
      orderBy: { timestamp: 'desc' },
      distinct: ['deviceId'],
    });

    // Filter by distance
    const nearby = devices.filter(loc => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude
      );
      return distance <= radius;
    });

    return nearby.map(loc => ({
      deviceId: loc.device.deviceId,
      deviceName: loc.device.deviceName,
      distance: this.calculateDistance(
        latitude,
        longitude,
        loc.latitude,
        loc.longitude
      ),
      location: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        timestamp: loc.timestamp,
      },
    }));
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
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

  private async triggerGeofenceAlert(geofence: any, deviceId: string, type: string) {
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });

    await prisma.notification.create({
      data: {
        title: `Geofence ${type === 'ENTER' ? 'Entry' : 'Exit'}`,
        message: `Device ${device?.deviceName || deviceId} ${type === 'ENTER' ? 'entered' : 'exited'} geofence ${geofence.name}`,
        type: 'ALERT',
        data: {
          geofenceId: geofence.id,
          geofenceName: geofence.name,
          type,
          deviceId,
        },
        deviceId,
      },
    });

    logger.info(`Geofence alert: ${type} - ${geofence.name} for device ${deviceId}`);
  }

  private async notifyLostMode(deviceId: string) {
    await prisma.notification.create({
      data: {
        title: 'Lost Mode Activated',
        message: `Device ${deviceId} has been put in lost mode`,
        type: 'ALERT',
        data: { deviceId, action: 'lost_mode_activated' },
        deviceId,
      },
    });
  }
}

// src/modules/location/location.routes.ts
import { Router } from 'express';
import { LocationController } from './location.controller';
import { authenticate } from '../../middlewares/auth';

const router = Router();
const controller = new LocationController();

router.post('/:deviceId/update', controller.updateLocation);
router.get('/live/:deviceId', authenticate, controller.getLiveLocation);
router.get('/history/:deviceId', authenticate, controller.getHistory);
router.post('/find-device', authenticate, controller.findDevice);
router.post('/lost-mode', authenticate, controller.lostMode);
router.get('/nearby', authenticate, controller.getNearby);

export { router as locationRoutes };
