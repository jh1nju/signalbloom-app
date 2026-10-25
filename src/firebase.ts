import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const currentProjectId = firebaseConfig.projectId;

export interface AuthUserProfile {
  id: string;
  organisationId: string;
  firebaseUid: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  emailAlerts?: boolean;
}

let inMemoryAuthToken: string | null = null;

export function setAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

/**
 * Gets a fresh ID token directly from Firebase Auth currentUser so that
 * Firebase refreshes it automatically, without storing tokens in localStorage or cookies.
 */
export async function getAuthToken(): Promise<string | null> {
  if (auth.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      inMemoryAuthToken = idToken;
      return idToken;
    } catch {
      // Fallback to latest in-memory token if refresh fails temporarily
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

  // Explicitly set browserLocalPersistence before signing in
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.warn('Could not set browserLocalPersistence:', err);
  }

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
    // Proceed to backend /api/auth/sign-in which links/provisions the Firebase user if needed
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

  // Ensure persistence before signing into Firebase client with newly provisioned credentials
  try {
    await setPersistence(auth, browserLocalPersistence);
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
