import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const currentProjectId = firebaseConfig.projectId;
export const currentDatabaseId = firebaseConfig.firestoreDatabaseId;

export interface AuthUserProfile {
  id: string;
  organisationId: string;
  firebaseUid: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
}

let inMemoryAuthToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export async function getAuthToken(): Promise<string | null> {
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      inMemoryAuthToken = idToken;
      return idToken;
    } catch {
      // Fallback to in-memory token
    }
  }
  return inMemoryAuthToken;
}

export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, {
    ...init,
    headers,
  });
}

export async function signInWithEmail(
  email: string,
  password: string
): Promise<{ user: AuthUserProfile; token: string }> {
  const cleanEmail = email.trim().toLowerCase();

  // 1. Try client-side Firebase Auth signInWithEmailAndPassword first
  try {
    const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const idToken = await credential.user.getIdToken();
    inMemoryAuthToken = idToken;

    const meRes = await fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData?.user) {
        return { user: meData.user, token: idToken };
      }
    }
  } catch {
    // Proceed to backend /api/auth/sign-in which links/provisions the Firebase user
  }

  // 2. Call backend /api/auth/sign-in
  const res = await fetch('/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail, password }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.token || !data?.user) {
    throw new Error(data?.error?.message || 'Incorrect email or password.');
  }

  // If Firebase Email/Password was provisioned during /api/auth/sign-in, sync client auth state
  try {
    const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
    const firebaseIdToken = await credential.user.getIdToken();
    inMemoryAuthToken = firebaseIdToken;
    return { user: data.user, token: firebaseIdToken };
  } catch {
    inMemoryAuthToken = String(data.token);
    return { user: data.user, token: String(data.token) };
  }
}

export async function signOutUser(): Promise<void> {
  inMemoryAuthToken = null;
  await signOut(auth).catch(() => {});
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true, message: `Connected to Cloud Project: ${firebaseConfig.projectId}` };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or initializing.');
      return { ok: false, message: 'Client offline or initializing' };
    }
    return { ok: true, message: `Connected to Cloud Project: ${firebaseConfig.projectId}` };
  }
}
