// src/services/email.service.ts
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

export class EmailService {
  private transporter: nodemailer.Transporter;
  private from: string;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    this.from = process.env.SMTP_FROM || 'noreply@rmras.com';
  }

  async sendEmail(to: string, subject: string, html: string, text?: string) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });

      logger.info(`Email sent to ${to}: ${info.messageId}`);
      return info;
    } catch (error) {
      logger.error('Email send error:', error);
      throw error;
    }
  }

  async sendPasswordReset(email: string, token: string) {
    const resetUrl = `${process.env.ADMIN_URL}/reset-password?token=${token}`;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Reset Password</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>We received a request to reset your password for your RMRAS account.</p>
            <p>Click the button below to reset your password:</p>
            <p style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RMRAS. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(email, 'Reset Your Password - RMRAS', html);
  }

  async sendEnrollmentInvitation(email: string, pin: string, deviceName?: string) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .pin { font-size: 32px; font-weight: bold; color: #2563eb; text-align: center; padding: 20px; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Device Enrollment</h1>
          </div>
          <div class="content">
            <p>Hello,</p>
            <p>You have been invited to enroll a new device in RMRAS.</p>
            ${deviceName ? `<p><strong>Device:</strong> ${deviceName}</p>` : ''}
            <p>Use the following PIN to complete enrollment:</p>
            <div class="pin">${pin}</div>
            <p>This PIN will expire in 24 hours.</p>
            <p>Open the RMRAS Client app and enter this PIN to register your device.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RMRAS. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(email, 'Device Enrollment - RMRAS', html);
  }

  async sendSecurityAlert(email: string, alert: {
    type: string;
    severity: string;
    message: string;
    deviceName?: string;
  }) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .severity { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; }
          .severity-critical { background: #dc2626; color: white; }
          .severity-high { background: #f59e0b; color: white; }
          .severity-medium { background: #3b82f6; color: white; }
          .severity-low { background: #6b7280; color: white; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Security Alert</h1>
          </div>
          <div class="content">
            <p><strong>Type:</strong> ${alert.type}</p>
            <p><strong>Severity:</strong> <span class="severity severity-${alert.severity.toLowerCase()}">${alert.severity}</span></p>
            ${alert.deviceName ? `<p><strong>Device:</strong> ${alert.deviceName}</p>` : ''}
            <p><strong>Message:</strong> ${alert.message}</p>
            <p>Please take appropriate action immediately.</p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RMRAS. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(email, `Security Alert: ${alert.type} - RMRAS`, html);
  }

  async sendSessionAlert(email: string, session: {
    deviceName: string;
    type: string;
    startTime: Date;
    endTime?: Date;
  }) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Session Alert</h1>
          </div>
          <div class="content">
            <p><strong>Device:</strong> ${session.deviceName}</p>
            <p><strong>Type:</strong> ${session.type}</p>
            <p><strong>Started:</strong> ${session.startTime.toLocaleString()}</p>
            ${session.endTime ? `<p><strong>Ended:</strong> ${session.endTime.toLocaleString()}</p>` : ''}
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} RMRAS. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail(email, `Session Alert: ${session.type} - RMRAS`, html);
  }
}
