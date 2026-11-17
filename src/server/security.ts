import crypto from 'crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';

dotenv.config();

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL = '7d';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const runtimeFallbackAccessSecret = crypto.randomBytes(64).toString('hex');
const runtimeFallbackRefreshSecret = crypto.randomBytes(64).toString('hex');

function getAccessSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : runtimeFallbackAccessSecret;
}

function getRefreshSecret(): string {
  const access = getAccessSecret();
  const refresh = process.env.JWT_REFRESH_SECRET?.trim();
  if (refresh && refresh.length >= 16 && refresh !== access) {
    return refresh;
  }
  // Guarantee separate signing secret even if misconfigured
  return refresh && refresh === access
    ? crypto.createHmac('sha256', runtimeFallbackRefreshSecret).update(refresh).digest('hex')
    : runtimeFallbackRefreshSecret;
}

export function getJwtEnvStatus() {
  const accessEnv = process.env.JWT_SECRET?.trim() || '';
  const refreshEnv = process.env.JWT_REFRESH_SECRET?.trim() || '';
  return {
    jwtSecretLoaded: accessEnv.length >= 16,
    jwtRefreshSecretLoaded: refreshEnv.length >= 16,
    secretsAreDistinct: accessEnv.length >= 16 && refreshEnv.length >= 16 && accessEnv !== refreshEnv,
    accessTtl: ACCESS_TOKEN_TTL,
    refreshTtl: REFRESH_TOKEN_TTL,
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface JwtUserPayload {
  sub: number;
  uid: string;
  username: string;
  role: 'OWNER' | 'AGENT';
  tokenType?: 'access' | 'refresh';
  jti?: string;
}

export function signAccessToken(payload: Omit<JwtUserPayload, 'tokenType' | 'jti'>): string {
  return jwt.sign(
    {
      ...payload,
      tokenType: 'access',
      jti: crypto.randomUUID(),
    },
    getAccessSecret(),
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL,
    }
  );
}

export function signRefreshToken(payload: Omit<JwtUserPayload, 'tokenType' | 'jti'>): string {
  return jwt.sign(
    {
      ...payload,
      tokenType: 'refresh',
      jti: crypto.randomUUID(),
    },
    getRefreshSecret(),
    {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_TTL,
    }
  );
}

export function verifyAccessToken(token: string): JwtUserPayload {
  const decoded = jwt.verify(token, getAccessSecret(), {
    algorithms: ['HS256'],
  }) as unknown as JwtUserPayload;
  if (decoded.tokenType !== 'access') {
    throw new Error('INVALID_TOKEN_TYPE');
  }
  return decoded;
}

export function verifyRefreshToken(token: string): JwtUserPayload {
  const decoded = jwt.verify(token, getRefreshSecret(), {
    algorithms: ['HS256'],
  }) as unknown as JwtUserPayload;
  if (decoded.tokenType !== 'refresh') {
    throw new Error('INVALID_TOKEN_TYPE');
  }
  return decoded;
}

export function isValidSafeDataUri(
  value: string | null | undefined,
  allowedMimeTypes: readonly string[]
): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;

  // Reject dangerous active content patterns upfront
  const lower = trimmed.toLowerCase();
  if (
    lower.includes('image/svg') ||
    lower.includes('text/html') ||
    lower.includes('javascript:') ||
    lower.includes('<script')
  ) {
    return false;
  }

  // Strictly validate base64 Data URI format against allowlisted MIME types
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,[a-z0-9+/=]+$/i.exec(trimmed);
  if (!match) {
    return false;
  }
  const mime = match[1].toLowerCase();
  return allowedMimeTypes.includes(mime);
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
}) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastPrune = Date.now();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (now - lastPrune > options.windowMs || hits.size > 1000) {
      for (const [k, entry] of hits.entries()) {
        if (entry.resetAt <= now) {
          hits.delete(k);
        }
      }
      lastPrune = now;
    }

    const record = hits.get(key);

    if (!record || record.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (record.count >= options.max) {
      return res.status(429).json({ error: options.message });
    }

    record.count += 1;
    return next();
  };
}
