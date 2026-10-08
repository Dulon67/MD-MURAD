/**
 * Firestore Security Rules Specification Test Suite
 * Verifies that all "Dirty Dozen" adversarial payloads are denied.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  collection: string;
  docId: string;
  operation: 'create' | 'update' | 'get' | 'list' | 'delete';
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Create',
    collection: 'news_articles',
    docId: 'art_valid_1',
    operation: 'create',
    auth: { uid: 'attacker_1', email_verified: true },
    payload: { ownerId: 'victim_999', title: 'Spoofed Headline' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow / Ghost Field Injection',
    collection: 'news_articles',
    docId: 'art_valid_2',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1', isAdmin: true, ghostField: 'injected' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Unverified Email Spoofing',
    collection: 'news_articles',
    docId: 'art_valid_3',
    operation: 'get',
    auth: { uid: 'user_1', email_verified: false },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'ID Poisoning with Invalid Characters',
    collection: 'news_articles',
    docId: 'invalid$doc!id#123',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Denial-of-Wallet Oversized Summary String',
    collection: 'news_articles',
    docId: 'art_valid_5',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1', summary: 'x'.repeat(5000) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Invalid Category Enum Value',
    collection: 'news_articles',
    docId: 'art_valid_6',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1', category: 'InvalidCategory' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Malformed publishedDate Format',
    collection: 'news_articles',
    docId: 'art_valid_7',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1', publishedDate: '07/10/2026' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Forged Client Timestamp on Create',
    collection: 'news_articles',
    docId: 'art_valid_8',
    operation: 'create',
    auth: { uid: 'user_1', email_verified: true },
    payload: { ownerId: 'user_1', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Immortal Field Mutation (url / createdAt)',
    collection: 'news_articles',
    docId: 'art_valid_9',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { url: 'https://malicious.example.com/spoof' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Terminal State Lock Bypass on Archived Article',
    collection: 'news_articles',
    docId: 'art_archived_10',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { verificationStatus: 'verified' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Unauthorized Headline Mutation on Update',
    collection: 'news_articles',
    docId: 'art_valid_11',
    operation: 'update',
    auth: { uid: 'user_1', email_verified: true },
    payload: { title: 'Tampered Headline' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Cross-Tenant List Query Scraping',
    collection: 'news_articles',
    docId: '*',
    operation: 'list',
    auth: { uid: 'attacker_2', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
