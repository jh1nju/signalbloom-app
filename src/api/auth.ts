import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { eq } from 'drizzle-orm';
import firebaseConfig from '../../firebase-applet-config.json';
import { db } from '../db/index.ts';
import { settings, users } from '../db/schema.ts';

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

interface StoredAccountEntry {
  passwordHash: string;
  role: 'admin' | 'staff';
}

interface StoredAuthConfig {
  tokenSecret: string;
  accounts: Record<string, StoredAccountEntry>;
}

function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derivedHex = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(derivedHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSignedFallbackToken(
  payload: { uid: string; email: string; exp: number },
  secret: string
): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'SB_FB_JWT' })).toString(
    'base64url'
  );
  const bodyB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  return `${headerB64}.${bodyB64}.${sig}`;
}

function verifySignedFallbackToken(
  token: string,
  secret: string
): { uid: string; email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sig] = parts;
  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    if (header?.typ !== 'SB_FB_JWT') return null;

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${bodyB64}`)
      .digest('base64url');

    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (!payload?.uid || typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return null;
    }

    return { uid: String(payload.uid), email: String(payload.email || '') };
  } catch {
    return null;
  }
}

async function getStoredAuthConfig(): Promise<StoredAuthConfig | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, 'auth_accounts_config'))
    .limit(1);

  if (!row || typeof row.value !== 'object' || row.value === null) {
    return null;
  }
  return row.value as StoredAuthConfig;
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
    let resolvedUid: string | null = null;
    let resolvedEmail: string | null = null;

    // 1. Try verifying as a standard Firebase ID token via firebase-admin
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      resolvedUid = decoded.uid;
      resolvedEmail = decoded.email ?? null;
    } catch {
      // 2. Check if it is a server-signed fallback token (used when Firebase Email/Password provider is not yet enabled in Console)
      const authCfg = await getStoredAuthConfig();
      if (authCfg?.tokenSecret) {
        const verifiedFallback = verifySignedFallbackToken(token, authCfg.tokenSecret);
        if (verifiedFallback) {
          resolvedUid = verifiedFallback.uid;
          resolvedEmail = verifiedFallback.email;
        }
      }
    }

    if (!resolvedUid) {
      return res.status(401).json({
        error: {
          code: 'invalid_token',
          message: 'Your session is invalid or has expired. Please sign in again.',
        },
      });
    }

    const userRecord = await resolveAndLinkUser(resolvedUid, resolvedEmail);
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
    return res.status(401).json({
      error: {
        code: 'invalid_token',
        message: 'Could not verify authentication token.',
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

// POST /api/auth/sign-in
// Verifies credentials against the database, provisions/signs in the Firebase Auth account if enabled,
// links firebase_uid in the users table, and returns the ID token + user profile.
authRouter.post('/auth/sign-in', async (req: Request, res: Response) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const rawPassword = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!rawEmail || !rawPassword) {
    return res.status(400).json({
      error: {
        code: 'invalid_credentials',
        message: 'Please enter your email address and password.',
      },
    });
  }

  try {
    // 1. Check if Firebase Identity Toolkit signInWithPassword succeeds directly
    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: rawEmail,
          password: rawPassword,
          returnSecureToken: true,
        }),
      }
    ).catch(() => null);

    if (signInRes && signInRes.ok) {
      const signInData = await signInRes.json();
      const firebaseUid = String(signInData.localId);
      const idToken = String(signInData.idToken);
      const userRecord = await resolveAndLinkUser(firebaseUid, rawEmail);

      if (!userRecord) {
        return res.status(403).json({
          error: {
            code: 'user_not_registered',
            message: 'This account is not linked to a SignalBloom user.',
          },
        });
      }

      return res.json({
        token: idToken,
        user: userRecord,
        provider: 'firebase',
      });
    }

    // 2. Verify against salted password hash stored in settings table
    const authCfg = await getStoredAuthConfig();
    const accountEntry = authCfg?.accounts?.[rawEmail];

    if (!authCfg || !accountEntry || !verifyPasswordHash(rawPassword, accountEntry.passwordHash)) {
      return res.status(401).json({
        error: {
          code: 'invalid_credentials',
          message: 'Incorrect email or password.',
        },
      });
    }

    // 3. Credentials match! Try creating the account in Firebase Auth in case Email/Password was just enabled
    const signUpRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: rawEmail,
          password: rawPassword,
          returnSecureToken: true,
        }),
      }
    ).catch(() => null);

    if (signUpRes && signUpRes.ok) {
      const signUpData = await signUpRes.json();
      const firebaseUid = String(signUpData.localId);
      const idToken = String(signUpData.idToken);
      const userRecord = await resolveAndLinkUser(firebaseUid, rawEmail);

      if (userRecord) {
        return res.json({
          token: idToken,
          user: userRecord,
          provider: 'firebase',
        });
      }
    }

    // 4. Lookup the user in the users table and issue a verified token linked to their firebase_uid
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, rawEmail))
      .limit(1);

    if (!dbUser) {
      return res.status(401).json({
        error: {
          code: 'invalid_credentials',
          message: 'Account not found.',
        },
      });
    }

    const token = createSignedFallbackToken(
      {
        uid: dbUser.firebaseUid,
        email: dbUser.email,
        exp: Date.now() + 24 * 60 * 60 * 1000,
      },
      authCfg.tokenSecret
    );

    return res.json({
      token,
      user: {
        id: dbUser.id,
        organisationId: dbUser.organisationId,
        firebaseUid: dbUser.firebaseUid,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role,
        emailAlerts: dbUser.emailAlerts,
      },
      provider: 'firebase',
    });
  } catch (err) {
    console.error('Sign-in failed:', err);
    return res.status(500).json({
      error: {
        code: 'server_error',
        message: 'Could not sign in right now. Please try again.',
      },
    });
  }
});

// GET /api/auth/me
authRouter.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    user: req.authUser,
  });
});
