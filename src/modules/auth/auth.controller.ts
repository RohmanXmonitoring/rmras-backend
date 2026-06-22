// src/modules/auth/auth.controller.ts
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { logger } from '../../utils/logger';
import { AuthRequest } from '../../middlewares/auth';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  login = async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      const result = await this.authService.login(username, password, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        deviceInfo: req.headers['x-device-info'] as string,
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Login error:', error);
      res.status(401).json({ error: error.message });
    }
  };

  logout = async (req: AuthRequest, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      await this.authService.logout(token!);
      res.json({ message: 'Logged out successfully' });
    } catch (error: any) {
      logger.error('Logout error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  refresh = async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body;
      const result = await this.authService.refresh(refreshToken);
      res.json(result);
    } catch (error: any) {
      logger.error('Refresh error:', error);
      res.status(401).json({ error: error.message });
    }
  };

  me = async (req: AuthRequest, res: Response) => {
    try {
      const admin = await this.authService.getProfile(req.admin!.id);
      res.json(admin);
    } catch (error: any) {
      logger.error('Get profile error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  forgotPassword = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      await this.authService.forgotPassword(email);
      res.json({ message: 'Password reset link sent to your email' });
    } catch (error: any) {
      logger.error('Forgot password error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    try {
      const { token, newPassword } = req.body;
      await this.authService.resetPassword(token, newPassword);
      res.json({ message: 'Password reset successfully' });
    } catch (error: any) {
      logger.error('Reset password error:', error);
      res.status(500).json({ error: error.message });
    }
  };

  changePassword = async (req: AuthRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      await this.authService.changePassword(req.admin!.id, currentPassword, newPassword);
      res.json({ message: 'Password changed successfully' });
    } catch (error: any) {
      logger.error('Change password error:', error);
      res.status(400).json({ error: error.message });
    }
  };

  validate = async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      const valid = await this.authService.validateToken(token);
      res.json({ valid });
    } catch (error: any) {
      logger.error('Validate token error:', error);
      res.status(500).json({ error: error.message });
    }
  };
}

// src/modules/auth/auth.service.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { prisma, redis } from '../../config';
import { logger } from '../../utils/logger';
import { EmailService } from '../../services/email.service';

export class AuthService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async login(username: string, password: string, metadata: any) {
    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      throw new Error('Invalid credentials');
    }

    if (!admin.isActive) {
      throw new Error('Account is disabled');
    }

    // Check if account is locked
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new Error('Account is locked. Please try again later.');
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      await this.handleFailedLogin(admin.id);
      throw new Error('Invalid credentials');
    }

    // Reset login attempts on successful login
    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    });

    // Generate tokens
    const token = this.generateToken(admin);
    const refreshToken = this.generateRefreshToken(admin);

    // Save session
    const session = await prisma.session.create({
      data: {
        token,
        refreshToken,
        deviceInfo: metadata.deviceInfo,
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        adminId: admin.id,
      },
    });

    // Save refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        adminId: admin.id,
      },
    });

    // Log activity
    await this.logActivity(admin.id, 'LOGIN', 'User logged in', {
      ip: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    return {
      token,
      refreshToken,
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
      },
    };
  }

  async logout(token: string) {
    const session = await prisma.session.update({
      where: { token },
      data: { isRevoked: true },
    });

    await prisma.refreshToken.updateMany({
      where: { adminId: session.adminId },
      data: { isRevoked: true },
    });

    await this.logActivity(session.adminId, 'LOGOUT', 'User logged out');
  }

  async refresh(refreshToken: string) {
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { admin: true },
    });

    if (!storedToken || storedToken.isRevoked || storedToken.expiresAt < new Date()) {
      throw new Error('Invalid or expired refresh token');
    }

    // Revoke old refresh token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true },
    });

    // Generate new tokens
    const newToken = this.generateToken(storedToken.admin);
    const newRefreshToken = this.generateRefreshToken(storedToken.admin);

    // Save new refresh token
    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        adminId: storedToken.admin.id,
      },
    });

    // Update session
    await prisma.session.updateMany({
      where: { adminId: storedToken.admin.id, isRevoked: false },
      data: { token: newToken },
    });

    return {
      token: newToken,
      refreshToken: newRefreshToken,
    };
  }

  async getProfile(adminId: string) {
    return prisma.admin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  async forgotPassword(email: string) {
    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      throw new Error('Email not found');
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    await redis.setex(`reset:${token}`, 3600, admin.id);

    await this.emailService.sendPasswordReset(admin.email, token);
  }

  async resetPassword(token: string, newPassword: string) {
    const adminId = await redis.get(`reset:${token}`);
    if (!adminId) {
      throw new Error('Invalid or expired reset token');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.admin.update({
      where: { id: adminId },
      data: { password: hashedPassword },
    });

    await redis.del(`reset:${token}`);
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new Error('User not found');
    }

    const isValid = await bcrypt.compare(currentPassword, admin.password);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.admin.update({
      where: { id: adminId },
      data: { password: hashedPassword },
    });
  }

  async validateToken(token: string) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!);
      const session = await prisma.session.findUnique({
        where: { token },
        include: { admin: true },
      });

      return !!(session && !session.isRevoked && session.expiresAt > new Date());
    } catch {
      return false;
    }
  }

  private generateToken(admin: any) {
    return jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
      },
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES || '15m' }
    );
  }

  private generateRefreshToken(admin: any) {
    return jwt.sign(
      {
        id: admin.id,
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES || '30d' }
    );
  }

  private async handleFailedLogin(adminId: string) {
    const admin = await prisma.admin.update({
      where: { id: adminId },
      data: {
        loginAttempts: {
          increment: 1,
        },
      },
    });

    if (admin.loginAttempts >= 5) {
      await prisma.admin.update({
        where: { id: adminId },
        data: {
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Lock for 30 minutes
        },
      });
    }
  }

  private async logActivity(adminId: string, activity: string, description: string, data?: any) {
    await prisma.activityLog.create({
      data: {
        activity,
        description,
        data,
        adminId,
      },
    });
  }
}

// src/modules/auth/auth.routes.ts
import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validation';
import { loginSchema, resetPasswordSchema } from './auth.validators';
import { authLimiter } from '../../middlewares/rateLimiter';

const router = Router();
const controller = new AuthController();

router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/logout', authenticate, controller.logout);
router.post('/refresh', controller.refresh);
router.get('/me', authenticate, controller.me);
router.post('/forgot-password', controller.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword);
router.post('/change-password', authenticate, controller.changePassword);
router.post('/validate', controller.validate);

export { router as authRoutes };

// src/modules/auth/auth.validators.ts
import { z } from 'zod';

export const loginSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(6),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string(),
    newPassword: z.string().min(6),
  }),
});
