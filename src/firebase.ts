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

  let credential;
  try {
    credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
  } catch {
    throw new Error('Incorrect email or password.');
  }

  const idToken = await credential.user.getIdToken();
  inMemoryAuthToken = idToken;

  const meRes = await fetch('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  const meData = await meRes.json().catch(() => null);
  if (!meRes.ok || !meData?.user) {
    inMemoryAuthToken = null;
    await signOut(auth).catch(() => {});
    throw new Error(
      meData?.error?.message || 'This account is not linked to a SignalBloom user.'
    );
  }

  return { user: meData.user, token: idToken };
}

export async function signOutUser(): Promise<void> {
  inMemoryAuthToken = null;
  await signOut(auth).catch(() => {});
}
