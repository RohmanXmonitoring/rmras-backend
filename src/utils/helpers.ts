// src/utils/helpers.ts
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

export const generateUUID = (): string => uuidv4();

export const generatePIN = (length: number = 6): string => {
  return randomBytes(length).toString('hex').toUpperCase().slice(0, length);
};

export const generateToken = (length: number = 32): string => {
  return randomBytes(length).toString('base64url').slice(0, length);
};

export const formatDate = (date: Date): string => {
  return date.toISOString();
};

export const parseDate = (dateStr: string): Date => {
  return new Date(dateStr);
};

export const isDateValid = (dateStr: string): boolean => {
  return !isNaN(Date.parse(dateStr));
};

export const calculateAge = (birthdate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthdate.getFullYear();
  const m = today.getMonth() - birthdate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
};

export const getDeviceType = (userAgent: string): string => {
  const ua = userAgent.toLowerCase();
  if (ua.includes('mobile')) return 'mobile';
  if (ua.includes('tablet')) return 'tablet';
  if (ua.includes('desktop')) return 'desktop';
  return 'unknown';
};

export const getOS = (userAgent: string): string => {
  const ua = userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  if (ua.includes('android')) return 'android';
  if (ua.includes('ios')) return 'ios';
  return 'unknown';
};

export const getBrowser = (userAgent: string): string => {
  const ua = userAgent.toLowerCase();
  if (ua.includes('chrome')) return 'chrome';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('safari')) return 'safari';
  if (ua.includes('edge')) return 'edge';
  if (ua.includes('opera')) return 'opera';
  return 'unknown';
};

export const getIPAddress = (req: any): string => {
  return req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
         req.connection.socket?.remoteAddress || 'unknown';
};

export const getLocationFromIP = async (ip: string): Promise<any> => {
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();
    if (data.status === 'success') {
      return {
        country: data.country,
        region: data.regionName,
        city: data.city,
        latitude: data.lat,
        longitude: data.lon,
        timezone: data.timezone,
        isp: data.isp,
        org: data.org,
      };
    }
    return null;
  } catch (error) {
    logger.error('IP location lookup error:', error);
    return null;
  }
};

export const maskEmail = (email: string): string => {
  const [username, domain] = email.split('@');
  if (username.length <= 2) return email;
  return username.slice(0, 2) + '***' + '@' + domain;
};

export const maskPhone = (phone: string): string => {
  if (phone.length <= 4) return phone;
  return phone.slice(0, 2) + '****' + phone.slice(-2);
};

export const truncate = (str: string, length: number = 100): string => {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
};

export const sanitize = (str: string): string => {
  return str
    .replace(/[&<>"]/g, (match) => {
      const escapeMap: { [key: string]: string } = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
      };
      return escapeMap[match];
    });
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const retry = async <T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
};

export const generateRandomString = (length: number = 10): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const generateRandomNumber = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const isValidUUID = (uuid: string): boolean => {
  const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return pattern.test(uuid);
};

export const isValidEmail = (email: string): boolean => {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(email);
};

export const isValidPhone = (phone: string): boolean => {
  const pattern = /^\+?[\d\s-]{10,15}$/;
  return pattern.test(phone);
};

export const isValidURL = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

export const extractDomain = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return '';
  }
};

export const bytesToSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const bytesToMB = (bytes: number): number => {
  return bytes / (1024 * 1024);
};

export const MBToBytes = (mb: number): number => {
  return mb * 1024 * 1024;
};
