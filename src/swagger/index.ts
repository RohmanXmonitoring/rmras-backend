// src/swagger/index.ts
import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'RMRAS API Documentation',
      version: '1.0.0',
      description: 'Rayan Monitoring & Remote Assistance System API',
      contact: {
        name: 'RMRAS Support',
        email: 'support@rmras.com',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: process.env.BASE_URL || 'http://localhost:3000',
        description: 'API Server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        LoginRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: {
              type: 'string',
              example: 'admin',
            },
            password: {
              type: 'string',
              example: 'password123',
            },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            refreshToken: {
              type: 'string',
              example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            },
            admin: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                email: { type: 'string' },
                fullName: { type: 'string' },
                role: { type: 'string' },
              },
            },
          },
        },
        Device: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            deviceId: { type: 'string' },
            deviceName: { type: 'string' },
            model: { type: 'string' },
            manufacturer: { type: 'string' },
            androidVersion: { type: 'string' },
            appVersion: { type: 'string' },
            status: {
              type: 'string',
              enum: ['ONLINE', 'OFFLINE', 'MAINTENANCE', 'LOST', 'LOCKED'],
            },
            lastSeenAt: { type: 'string', format: 'date-time' },
            registeredAt: { type: 'string', format: 'date-time' },
            isActive: { type: 'boolean' },
            isLost: { type: 'boolean' },
            isLocked: { type: 'boolean' },
          },
        },
        Location: {
          type: 'object',
          properties: {
            latitude: { type: 'number', format: 'float' },
            longitude: { type: 'number', format: 'float' },
            altitude: { type: 'number', format: 'float' },
            accuracy: { type: 'number', format: 'float' },
            speed: { type: 'number', format: 'float' },
            heading: { type: 'number', format: 'float' },
            provider: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            message: { type: 'string' },
            type: {
              type: 'string',
              enum: ['INFO', 'WARNING', 'SUCCESS', 'ERROR', 'ALERT'],
            },
            data: { type: 'object' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
  },
  apis: ['./src/modules/**/*.routes.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
