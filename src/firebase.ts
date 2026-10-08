import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { VALID_CATEGORIES, type CrimeCategory } from './constants/taxonomy';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

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
): never {
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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

// Defensive Payload Constraints synchronized with firebase-blueprint.json & firestore.rules
export const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
export const URL_REGEX = /^https?:\/\/.*$/;
export const DATE_REGEX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const VALID_STATUSES = ['unverified', 'verified', 'flagged', 'archived'] as const;
export type VerificationStatus = (typeof VALID_STATUSES)[number];

export function sanitizeDocumentId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return cleaned.length >= 1 && ID_REGEX.test(cleaned) ? cleaned : `doc_${Date.now()}`;
}

export function sanitizeString(val: unknown, minLen: number, maxLen: number, fallback: string): string {
  const str = typeof val === 'string' ? val.trim() : '';
  const safe = str.length >= minLen ? str : fallback;
  return safe.slice(0, maxLen);
}

export function sanitizeCategory(val: unknown): CrimeCategory {
  if (typeof val === 'string') {
    const trimmed = val.trim().slice(0, 100);
    if (trimmed.length >= 2) {
      return trimmed;
    }
  }
  return 'হত্যা/খুন';
}

export function sanitizeVerificationStatus(val: unknown): VerificationStatus {
  if (typeof val === 'string' && (VALID_STATUSES as readonly string[]).includes(val)) {
    return val as VerificationStatus;
  }
  return 'unverified';
}

export function sanitizePublishedDate(val: unknown): string {
  if (typeof val === 'string' && DATE_REGEX.test(val.trim())) {
    return val.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

export function sanitizeUrl(val: unknown): string {
  if (typeof val === 'string' && URL_REGEX.test(val.trim()) && val.trim().length >= 8) {
    return val.trim().slice(0, 1000);
  }
  return 'https://news.google.com';
}
