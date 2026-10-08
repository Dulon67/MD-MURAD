# Security Specification — BD Crime & Incident News Archive

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity Enforcement**: Every read and write operation requires `request.auth != null && request.auth.token.email_verified == true`. Unverified email accounts or anonymous sessions are rejected.
3. **Strict Tenant Isolation (`ownerId`)**: Every document in `/news_articles/{articleId}` and `/keyword_configs/{configId}` belongs strictly to `ownerId == request.auth.uid`. Both `get` and `list` operations validate `resource.data.ownerId == request.auth.uid` on the server side (Zero Client Delegation).
4. **Path Variable Hardening (`isValidId`)**: All single-document operations (`get`, `create`, `update`, `delete`) validate document IDs against `^[a-zA-Z0-9_\-]+$` with length `1..128`. `list` operations omit `isValidId` per Pillar 3.
5. **Anti-Update-Gap & Strict Schema Blueprints**: Both `create` and `update` call `isValidNewsArticle(incoming())` or `isValidKeywordConfig(incoming())`, enforcing exact key sets (`hasAll` + `hasOnly`), string length bounds, regex patterns, enum memberships, and `ownerId == request.auth.uid`.
6. **Temporal Integrity & Immortal Fields**: `createdAt` and `updatedAt` must equal `request.time` on `create`; on `update`, `createdAt`, `ownerId`, and primary identity fields (`url` / `category`) are immutable (`incoming().field == existing().field`) and `updatedAt == request.time`.
7. **Terminal State Locking**: Once a `NewsArticle` reaches `verificationStatus == 'archived'`, no further updates are permitted (`existing().verificationStatus != 'archived'`).

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Identity Spoofing on Create**:
   `{ "ownerId": "victim_uid_999", "title": "Spoofed", ... }` by `attacker_uid_111` -> **REJECTED** (`data.ownerId == request.auth.uid` fails).
2. **Payload 2 — Shadow / Ghost Field Injection**:
   Adding `"isAdmin": true` or `"ghostField": "pwn"` to `/news_articles/art_1` -> **REJECTED** (`data.keys().hasOnly(...)` fails).
3. **Payload 3 — Unverified Email Spoofing**:
   Authenticated request where `request.auth.token.email_verified == false` -> **REJECTED** (`isSignedIn()` requires `email_verified == true`).
4. **Payload 4 — ID Poisoning (1.5KB Document ID)**:
   Creating `/news_articles/aaaa...200_chars` or `/news_articles/bad$id!` -> **REJECTED** (`isValidId(articleId)` fails).
5. **Payload 5 — Denial-of-Wallet Oversized String**:
   Setting `summary` to a 50,000-character string -> **REJECTED** (`data.summary.size() <= 1500` fails).
6. **Payload 6 — Invalid Category Enum**:
   Setting `category` to `"খেলাধুলা"` -> **REJECTED** (`isValidCategory(data.category)` fails).
7. **Payload 7 — Invalid Date Pattern**:
   Setting `publishedDate` to `"07-10-2026"` or `"2026/10/07"` -> **REJECTED** (`data.publishedDate.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$')` fails).
8. **Payload 8 — Forged Client Timestamp**:
   Setting `createdAt` or `updatedAt` to a past/future timestamp instead of `request.time` -> **REJECTED** (`incoming().createdAt == request.time` fails).
9. **Payload 9 — Immortal Field Mutation on Update**:
   Attempting to mutate `createdAt`, `ownerId`, or `url` during an `update` -> **REJECTED** (`incoming().url == existing().url` and `affectedKeys().hasOnly(...)` fail).
10. **Payload 10 — Terminal State Bypass**:
    Attempting to update a `NewsArticle` whose existing `verificationStatus` is `'archived'` -> **REJECTED** (`existing().verificationStatus != 'archived'` fails).
11. **Payload 11 — Unauthorized Action Field Mix on Update**:
    Attempting to modify `title` or `portalName` during an update -> **REJECTED** (`affectedKeys().hasOnly(...)` action gates disallow mutating `title` or `portalName`).
12. **Payload 12 — Cross-Tenant List / Query Scraping**:
    User A executing an unfiltered `list` query across `/news_articles` to read User B's saved articles -> **REJECTED** (`allow list` enforces `existing().ownerId == request.auth.uid`).

---

## 3. Red Team Conflict Report

| Collection | Identity Spoofing | State Shortcutting / Terminal Lock | Resource / ID Poisoning | Update Validation Helper Present | Value Poisoning |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/news_articles/{articleId}` | PASS (`ownerId == request.auth.uid` + immutable) | PASS (`existing().verificationStatus != 'archived'`) | PASS (`isValidId` + strict `.size()` on all strings) | PASS (`isValidNewsArticle(incoming())` wraps `update`) | PASS (strict types, enums, regexes) |
| `/keyword_configs/{configId}` | PASS (`ownerId == request.auth.uid` + immutable) | PASS (strict action-based `affectedKeys().hasOnly()`) | PASS (`isValidId` + strict `.size()` on all strings/ints) | PASS (`isValidKeywordConfig(incoming())` wraps `update`) | PASS (strict types, range checks) |
