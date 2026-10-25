import { Router, Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { eq } from 'drizzle-orm';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

export const adminAuth = getAuth();

export interface AuthenticatedUser {
  id: string;
  organisationId: string;
  firebaseUid: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  emailAlerts: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthenticatedUser;
}

async function resolveAndLinkUser(
  firebaseUid: string,
  email?: string | null
): Promise<AuthenticatedUser | null> {
  // 1. Lookup by firebase_uid first
  const [byUid] = await db
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (byUid) {
    return {
      id: byUid.id,
      organisationId: byUid.organisationId,
      firebaseUid: byUid.firebaseUid,
      email: byUid.email,
      name: byUid.name,
      role: byUid.role,
      emailAlerts: byUid.emailAlerts,
    };
  }

  // 2. If not linked by firebase_uid yet, link by matching email in users table
  if (email) {
    const cleanEmail = email.trim().toLowerCase();
    const [byEmail] = await db
      .select()
      .from(users)
      .where(eq(users.email, cleanEmail))
      .limit(1);

    if (byEmail) {
      const [updated] = await db
        .update(users)
        .set({ firebaseUid })
        .where(eq(users.id, byEmail.id))
        .returning();

      const resolved = updated || byEmail;
      return {
        id: resolved.id,
        organisationId: resolved.organisationId,
        firebaseUid: resolved.firebaseUid,
        email: resolved.email,
        name: resolved.name,
        role: resolved.role,
        emailAlerts: resolved.emailAlerts,
      };
    }
  }

  return null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        code: 'unauthenticated',
        message: 'Sign in is required.',
      },
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({
      error: {
        code: 'unauthenticated',
        message: 'Sign in is required.',
      },
    });
  }

  try {
    let decoded;
    try {
      decoded = await adminAuth.verifyIdToken(token);
    } catch {
      return res.status(401).json({
        error: {
          code: 'invalid_token',
          message: 'Your session is invalid or has expired. Please sign in again.',
        },
      });
    }

    const userRecord = await resolveAndLinkUser(decoded.uid, decoded.email ?? null);
    if (!userRecord) {
      return res.status(403).json({
        error: {
          code: 'user_not_registered',
          message: 'This account is not linked to a SignalBloom user.',
        },
      });
    }

    req.authUser = userRecord;
    next();
  } catch (err) {
    console.error('Authentication error:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not verify authentication right now. Please try again.',
      },
    });
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    return res.status(401).json({
      error: {
        code: 'unauthenticated',
        message: 'Sign in is required.',
      },
    });
  }

  if (req.authUser.role !== 'admin') {
    return res.status(403).json({
      error: {
        code: 'forbidden',
        message: 'Only admins can perform this action.',
      },
    });
  }

  next();
}

export const authRouter = Router();

// GET /api/auth/me
authRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    user: req.authUser,
  });
});
