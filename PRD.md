# Product Requirements Document (PRD) — Ironsight MVP

**Source of truth:** Current codebase (Next.js App Router, Prisma, PostgreSQL in production schema; SQLite variants for dev/test clients).

**Version:** 0.1.0 (per `package.json`)

---

## 1. Executive summary

**Ironsight MVP** is an internal **B2B deal tracker** for India-centric sales operations. It lets reps work **accounts** (schools/partners), create **deals** tied to approved assigned accounts, log **structured interactions** (outcome, stakeholder, risks, notes), maintain **next steps** on deals, and gives **managers/admins** pipeline visibility, “today” prioritization, CSV export, optional account CSV import, user administration, audit history, and **yesterday activity compliance** reporting.

Currency is presented as **INR**. Dates for compliance and several UX surfaces use **IST (Asia/Kolkata)**.

---

## 2. Technology & deployment (as built)

| Area | Implementation |
|------|------------------|
| Framework | Next.js **16.2.2** (App Router), React **19**, TypeScript |
| Styling | Tailwind CSS **4** |
| ORM / DB | Prisma **6.19**; **PostgreSQL** in `schema.prisma` (`DATABASE_URL`); separate generated clients for **default/main** (`schema.prisma`) and **test** (`schema.test.prisma` + `test.db`) selected in `lib/prisma.ts` by `NODE_ENV` / `TEST_MODE` |
| Auth | Email + password; **bcrypt** hashes (10 rounds); legacy plain-text password compare if stored value does not look like bcrypt |
| Session | HTTP-only cookie `ironsight_user_id` = **user id** (not JWT); `sameSite: lax`, path `/` |
| Tests | Vitest |
| Hosting build | `vercel.json`: `prisma migrate deploy && prisma generate && next build` |

**Test-only auth override:** When `TEST_MODE === "true"`, `getCurrentUser` prefers `x-user-id` header if it matches a user in the DB (used by automated tests).

**Note on `proxy.ts`:** A `proxy` function exists that would redirect unauthenticated users away from non-API routes, but **there is no `middleware.ts` wired to it in the repo** (no import of `proxy`). **Page-level auth is therefore inconsistent** (see §8).

---

## 3. Roles & org model

### 3.1 Roles (`UserRole`)

- **ADMIN** — Full org; account approve/reject/assign; user CRUD (non-admin users); deal delete; sees all accounts with `?includeAll=1`; export; manager pipeline breakdown; audit; activity compliance (full rep+manager set for admin viewer).
- **MANAGER** — Sees deals on accounts assigned to **self or direct-report REPs** (`managerId` link). Can PATCH deal value for own deals or reports’ deals. Pipeline with optional per-rep breakdown. “Today” in manager mode. Export (all deals in DB, see §7.6). Users API read + audit + activity. Cannot approve accounts (admin-only in API).
- **REP** — Sees only accounts **assigned to self**; can request accounts; create deals only on **approved accounts assigned to self**; log interactions only when **account assignee is self**.

### 3.2 User hierarchy

- `User.managerId` optional; **REPs must have a MANAGER** on create/update (API enforced).
- **MANAGER** users have `managerId` cleared when role is MANAGER.

---

## 4. Core domain model (Prisma)

### 4.1 `User`

- `id` (cuid), `name`, `email` (unique), `password`, `role`, optional `managerId`, self-relation for reports.

### 4.2 `Account`

- `name`, `normalized` (unique, lowercase single-spaced trim), `type` (`SCHOOL` default | `PARTNER`), `state`, `district` (defaults `"UNKNOWN"` in schema but flows require real values on create).
- `createdById`, `requestedById` (nullable, `onDelete: SetNull`), `assignedToId` (nullable).
- `status`: `PENDING` | `APPROVED` | `REJECTED` (default `PENDING`).
- Relations: deals[], createdBy, requestedBy, assignedTo.

### 4.3 `Deal`

- `name` — in product terms this is the **product line** (must be one of allowed products).
- `companyName` — **auto-filled from account name** on create (not user-editable in API).
- `value` (float, **must be > 0**).
- `accountId`, `ownerId` (**deal creator** at POST time).
- `createdAt`, `lastActivityAt` (default now).
- `nextStepType` (string), `nextStepDate` (DateTime?), `nextStepSource` (`AUTO` | `MANUAL` implied by API).

### 4.4 `InteractionLog`

- `interactionType`: `CALL` | `ONLINE_MEETING` | `OFFLINE_MEETING`.
- `outcome`: enum `Outcome` (full list in schema — 18 values including positive, stalled, negative).
- `stakeholderType`: `INFLUENCER` | `DECISION_MAKER` | `UNKNOWN`.
- `notes` optional string.
- `risks`: 1–3 `InteractionRisk` rows, each `category` ∈ `RiskCategory` enum.

### 4.5 `AuditLog`

- `entityType`: `USER` | `ACCOUNT` | `DEAL` | `LOG` (LOG type exists in enum; **interaction creates are not audited in `POST /api/logs`** — only certain mutations call `logAudit`).
- `action`: `CREATE` | `UPDATE` | `DELETE`.
- `changedById`, optional `before` / `after` JSON, `createdAt`.

---

## 5. Product catalog

Deal `name` must be one of (from `lib/products.json`):

1. Geneo ONE
2. Geneo EDGE
3. Geneo IL
4. Geneo Touch
5. Geneo Test Prep

---

## 6. Deal “stage” (derived, not stored)

Computed in `getDealStage(dealId)` from **set of all logged outcomes** for the deal:

| Stage | Rule (simplified) |
|-------|-------------------|
| **ACCESS** | If any `DEAL_DROPPED` or `LOST_TO_COMPETITOR`; else default baseline. |
| **QUALIFIED** | `MET_DECISION_MAKER` AND `BUDGET_DISCUSSED` (and not escalated past by higher rules). |
| **EVALUATION** | Any of: `DEMO_DONE`, `PRICING_REQUESTED`, `PROPOSAL_SHARED`, `BUDGET_CONFIRMED`, `NEGOTIATION_STARTED`. |
| **COMMITTED** | `MET_DECISION_MAKER` + `BUDGET_DISCUSSED` + `PROPOSAL_SHARED` + `DEAL_CONFIRMED`. |
| **CLOSED** | `DEAL_CONFIRMED` AND `PO_RECEIVED`. |

Ordering on the home deals list: `COMMITTED` → `EVALUATION` → `QUALIFIED` → `ACCESS` → `CLOSED`, then higher **value**, then more recent **lastActivityAt**.

---

## 7. Functional requirements by feature

### 7.1 Authentication

- **`POST /api/auth/login`**: JSON `{ email, password }`; email trimmed/lowercased; sets session cookie on success; structured error codes (`USER_NOT_FOUND`, `PASSWORD_MISMATCH`, Prisma errors, etc.).
- **`POST /api/auth/logout`**: Clears cookie (`maxAge: 0`).
- **`GET /api/session/me`**: Returns `{ id, email, role }` or 401.
- **UI `/login`**: Form; redirects to `/` if cookie already maps to a user.
- **Deprecated (410):** `POST /api/session/switch`, `GET /api/session/users`.

### 7.2 Global chrome

- **Root layout:** Geist fonts, `AppNav` (links depend on role), **`TestSessionBar`** showing logged-in email/role or “Session expired” with login link + logout/clear.
- **`TestSessionProvider`:** Exposes `useTestSession()` with **`header: {}`** (identity is **cookie-based** for browser `fetch`; the name “Test” is legacy — production login uses the same path).

### 7.3 Navigation (`AppNav`)

Visible to everyone (no server check in nav itself):

- Deals `/`, Accounts `/accounts`, Today `/today`, Pipeline `/pipeline`, **Export Data** → `GET /api/export` (link; still subject to API auth).

If `canViewAdminSections(role)` (**ADMIN or MANAGER**):

- Users `/users`, Audit `/audit`, Activity `/activity`.

### 7.4 Deals — API

- **`GET /api/deals`**: Authenticated; scoped by `buildDealWhere` (account `assignedToId` in viewer’s accessible user ids). Returns deals + `account`, each enriched with **`stage`** and **`missingSignals`**, sorted per §6.
- **`POST /api/deals`**: Validates body (`validateDealInput`); requires logged-in user; account must exist; **`validateDealCreationAccess`**: account **APPROVED**, **assigned**, assignee **must be current user**; creates deal with `ownerId = current user`; **audit CREATE** on deal.
- **`GET /api/deals/:id`**: 401 if no user; 404 if no deal; **read allowed if `canAccessAssignedToId(user, account.assignedToId)`** (admin: unassigned accounts readable; else assignee must be in scope). Returns deal + account + logs + risks + `stage` + `missingSignals`.
- **`PATCH /api/deals/:id`**: Only **`value`** update; requires **`assertDealAccess`** (same scope as deal list). Audit UPDATE with before/after value.
- **`DELETE /api/deals/:id`**: **ADMIN only**; audit DELETE.

**`GET /api/deals/:id/stage`** and **`GET /api/deals/:id/missing-signals`**: Same read gate as GET deal.

### 7.5 “Missing signals” (computed)

`getMissingSignals`:

- Missing text if no log outcome: `MET_DECISION_MAKER`, `BUDGET_DISCUSSED`, `PROPOSAL_SHARED`.
- If `lastActivityAt` older than **7 days**: append `No Recent Activity (7 days)`.

### 7.6 Interaction logs — API

- **`POST /api/logs`**: Validates with `validateLogInput`:
  - `dealId`, `interactionType`, `outcome`, `stakeholderType`, `risks` array **length 1–3**, all valid `RiskCategory`.
  - `notes` optional string.
  - **`nextStepType`** required and must be in `NEXT_STEP_TYPES`; **`nextStepDate`** ISO string, parseable.
  - `nextStepSource` optional; if present must be `AUTO` or `MANUAL` (else 400).
- Access: **`validateInteractionLogAccess`** — account must have `assignedToId` and it must equal **current user** (not deal owner per se).
- **Outcome guardrails** (`validateOutcomeGuardrails`):
  - `PROPOSAL_SHARED` requires **deal.value > 0**.
  - `DEAL_CONFIRMED` requires prior outcomes (in any logs) include `MET_DECISION_MAKER`, `BUDGET_DISCUSSED`, `PROPOSAL_SHARED`.
  - `PO_RECEIVED` requires prior `DEAL_CONFIRMED`.
- On success: create log; update deal `lastActivityAt = now`, set `nextStepType`, `nextStepDate`, `nextStepSource` (defaults to `AUTO` if not `MANUAL`).

- **`GET /api/logs/:dealId`**: Same deal visibility as above; returns logs with `risks` flattened to category strings.

### 7.7 Accounts — API

- **`GET /api/accounts`**: Scoped with `buildAccountWhere` (assigned accounts in viewer’s ids). Query `?includeAll=1` allowed for **non-REP**; **REP gets 403** if they try `includeAll=1`. Response includes `assignedTo`, `requestedBy` subset.
- **`POST /api/accounts/request`**: Authenticated; body `type` SCHOOL|PARTNER, `name`, `district`, `state` (non-empty); **state must pass `isValidIndiaState`** against fixed list `INDIAN_STATES_AND_UTS`; duplicate check on `normalized`; creates **PENDING** account with `createdById` and `requestedById` = current user; audit CREATE.
- **`GET /api/accounts/pending`**: **ADMIN only**; all `PENDING` accounts, ordered `createdAt` asc, includes creators/assignees/requester.
- **`POST /api/accounts/:id/approve`**, **`reject`**: **ADMIN only**; status update; audit with subset fields.
- **`POST /api/accounts/:id/assign`**: **ADMIN only**; account must be **APPROVED**; body `{ userId }`; audit.
- **`POST /api/accounts/import`**: `mode=preview` | `confirm` (default preview). **Multipart** `file` (CSV). Parses headers: **either** `School Name` **or** `Partner Name` column, plus `State`, `District`. **No Indian-state validation** on import (unlike manual request). Dedupes within file and vs DB on `normalized`. **Preview** returns all rows with flags; **confirm** creates **PENDING** accounts for valid rows in a transaction, each with `createdById`, `requestedById`, **`assignedToId` = importing user’s id**; audit per row. Returns skipped counts.

- **`PATCH/DELETE /api/accounts/:id`**: **ADMIN only**; PATCH can update name (recomputes normalized), type, state, district, status; audit. DELETE blocked by Prisma relations in practice if deals exist (cascade on deal side from account).

### 7.8 Pipeline — API

- **`GET /api/pipeline`**: Authenticated; aggregates **count + sum of `value`** per stage for deals in viewer’s `buildDealWhere` scope.
- Query `?includeRepBreakdown=1`: If user is **MANAGER**, response shape `{ totals, repPipelines[] }` where per-rep pipeline buckets deals by **`account.assignedToId`** matching each rep.
- **ADMIN** with `includeRepBreakdown=1` still only gets flat totals from main route (rep breakdown is manager-only in this handler).

- **`GET /api/pipeline/manager-breakdown`**: **ADMIN only**. For each MANAGER user, count deals **owned by reps where `rep.managerId` = that manager** (`where: { ownerId in repIds }`), bucket by stage; **`totalValue`** sums deal values. Uses **deal owner**, not account assignee.

### 7.9 “Today” — API

**`GET /api/today`**

- Only deals with **`nextStepDate` not null**, in deal scope from `buildDealWhere`.
- Excludes “inactive” deals: any logs include (`DEAL_DROPPED` or `LOST_TO_COMPETITOR`) OR (`DEAL_CONFIRMED` and `PO_RECEIVED`).
- For each deal, **days since last activity** uses **latest InteractionLog.createdAt** if any, else `deal.lastActivityAt`; day boundaries use **IST calendar** derived from `formatYmdInIST` / `istYmdToUtcStart`.
- **Buckets** (for items):
  - **Critical**: next step date **before start of (today − 2 days) in IST** OR `daysSinceLastActivity >= 10`.
  - **Attention**: not critical AND `daysSinceLastActivity >= 7`.
  - **Upcoming**: next step date between **today** and **today+2** IST inclusive.

**REP / ADMIN** (non-manager branch): returns `{ mode: "REP", critical, attention, upcoming }` for all scoped deals combined (admin sees all assignable deals in scope — effectively all deals on accounts with assignees in… admin `getAccessibleUserIds` returns **null** meaning **no filter** on `buildDealWhere` — **admin sees all deals**).

**MANAGER**: `{ mode: "MANAGER", reps[], selectedRepId, drilldown: { critical, attention } }`. Rep list includes manager’s own id + direct reports. Color per rep: **RED** if any critical; else **YELLOW** if `stale` (max days since activity ≥ 7 among rep’s deals) or any attention; else **GREEN**. `?repId=` selects drilldown rep (must be in scope). **Manager response omits “upcoming” bucket** (only critical + attention in drilldown).

### 7.10 Export

- **`GET /api/export`**: **ADMIN or MANAGER**. CSV download `ironsight-export.csv`. Fetches **`findMany` where `{}`** — **all deals in database** with account + assigned rep email, computed stage, lastActivity ISO, missingSignals joined by ` | `. **Not scoped** to manager hierarchy.

### 7.11 Audit

- **`GET /api/audit`**: **ADMIN or MANAGER** (`requireAdminSectionAccess`). Last **200** audit rows, `changedBy` subset included. UI shows entity type, action, actor email, timestamp (not before/after JSON in table).

### 7.12 Users

- **`GET /api/users`**: Admin-section users; returns all users’ id, name, email, role, managerId.
- **`POST /api/users`**: **ADMIN only** (section allows manager but POST requires admin). Creates **REP or MANAGER** only; hashes password; REP requires valid `managerId` pointing to a MANAGER; audit CREATE.
- **`PATCH /api/users/:id`**: Admin-section + **ADMIN only**. Cannot edit/delete **ADMIN** role users via this route. Validates REP manager rules; optional password re-hash; audit UPDATE.
- **`DELETE /api/users/:id`**: **ADMIN only**; cannot delete self; cannot delete ADMIN users; 409 if user has any deals, createdAccounts, assignedAccounts, or reports.

### 7.13 Activity compliance

- **`GET /api/activity/compliance`**: **ADMIN or MANAGER only** (REP forbidden).
- **`getActivityComplianceRows`**:
  - **MANAGER viewer**: users = self (MANAGER) + REPs with `managerId = viewer`.
  - **ADMIN viewer**: all users with role **REP or MANAGER**.
  - Metrics: **yesterday** interaction count (IST yesterday window), **last activity** (any log on deals **owned** by that user — `deal.ownerId`), **weekly active days** = distinct IST calendar days with ≥1 log in rolling **7-day window including today** `[today-6, today]`.
  - Rows sorted: ascending by yesterday count, then ascending by last activity time (nulls last in effect).

**UI `/activity`**: Server page; redirect `/` if not admin/manager; renders table with emoji thresholds for yesterday and color classes for 7D active days.

### 7.14 Access logging (dev observability)

`getAccessibleUserIds` / related: when `NODE_ENV !== "production"` or `TEST_MODE === "true"`, logs `ACCESS_SCOPE` to console with user id, role, resolved id list.

---

## 8. UI routes & server-side gates (as implemented)

| Route | Behavior |
|-------|----------|
| `/` | Server component; loads deals via **internal `fetch` to `/api/deals`** forwarding cookies; **Create Deal** form; lists deals (active then closed). **No server redirect if unauthenticated** — API returns 401 and page shows error string. |
| `/login` | Redirects to `/` if session cookie valid. |
| `/accounts` | Client page; no server role redirect; uses APIs (some return 401/403). |
| `/deals/[id]` | **Server loads `deal` by id with NO `buildDealWhere` / assignee check** — **anyone with a guessable URL can see deal detail + logs in SSR output** (APIs are stricter). `DealValueEditor` uses PATCH API (which enforces scope). |
| `/deals/[id]/log` | Client log form. |
| `/today` | Client; fetches `/api/today`. |
| `/pipeline` | Client; fetches pipeline (+ manager breakdown for admin). |
| `/users` | **Server:** redirect `/` if role not ADMIN/MANAGER. Client handles read-only manager vs admin CRUD. |
| `/audit` | **Server:** same gate as users. |
| `/activity` | **Server:** same gate as users. |

**`proxy.ts` auth gate:** Not active without Next middleware wiring.

---

## 9. Client-side “suggestions” (logging UI)

Separate from server `lib/next-step.ts` used in tests/docs:

- **`lib/suggestions.ts`** maps outcomes to UI next-step types (with normalization, e.g. `SCHEDULE_DM_MEETING` → `SCHEDULE_MEETING`) and **risk suggestions** (partial map).
- **Next step date** in UI uses `getSuggestedNextStepDate`: e.g. +1 day for `PROPOSAL_SHARED` / `PRICING_REQUESTED`, +3 for `NO_RESPONSE` / `FOLLOW_UP_DONE`, else +2 IST days from “today”.
- **PO_RECEIVED path:** UI clears next step type/date and disables fields, but **submit requires** `nextStepType` and `nextStepDate` — **logging `PO_RECEIVED` from the UI is effectively blocked** unless user works around validation (API would still require next step fields).

---

## 10. Seed data (script behavior, high level)

`prisma/seed.mjs` uses bcrypt, reads `products.json`, generates synthetic users/accounts/deals/logs with randomized weighted outcomes to demo pipeline stages — details are in script (not required for PRD parity beyond: **seed exists** and README documents demo logins).

README demo users (passwords not in PRD; seed prints ids):

- `admin@ironsight.local` — ADMIN
- `manager@ironsight.local` — MANAGER
- `rep@ironsight.local` — REP

---

## 11. Explicit non-requirements / implementation gaps (for “as-built” honesty)

1. **No middleware** enforcing login on all pages; only some routes use server `redirect` by role.
2. **`/deals/[id]` SSR** does not enforce deal/account access control.
3. **Export** returns **global** deal list for admin/manager, not hierarchy-scoped.
4. **Pipeline manager breakdown** uses **deal owner**; main pipeline uses **account assignee** scope — conceptual split in reporting.
5. **Activity compliance** attributes logs to **deal owner**, while **logging permission** uses **account assignee** — alignment depends on whether owner and assignee are the same person.
6. **CSV import** does not validate Indian states.
7. **`/api/session/switch`** deprecated.
8. **Interaction log create** does not write `AuditLog`.

---

## 12. API index (machine-readable)

- `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/session/me`
- `GET|POST /api/deals`, `GET|PATCH|DELETE /api/deals/:id`
- `GET /api/deals/:id/stage`, `GET /api/deals/:id/missing-signals`
- `POST /api/logs`, `GET /api/logs/:dealId`
- `GET /api/accounts`, `POST /api/accounts/request`, `GET /api/accounts/pending`
- `POST /api/accounts/:id/approve`, `reject`, `assign`
- `POST /api/accounts/import?mode=preview|confirm`
- `PATCH|DELETE /api/accounts/:id`
- `GET /api/pipeline`, `GET /api/pipeline/manager-breakdown`
- `GET /api/today?repId=`
- `GET /api/export`
- `GET /api/audit`
- `GET|POST /api/users`, `PATCH|DELETE /api/users/:id`
- `GET /api/activity/compliance`

---

## 13. Next step types (API validation)

Allowed `nextStepType` values (from `lib/next-step.ts`): `FOLLOW_UP`, `SCHEDULE_MEETING`, `SCHEDULE_DEMO`, `SEND_PRICING`, `SEND_PROPOSAL`, `AWAIT_RESPONSE`, `CLOSE_DEAL`, `OTHER`.

---

## 14. Enums reference (schema)

**InteractionType:** `CALL`, `ONLINE_MEETING`, `OFFLINE_MEETING`

**StakeholderType:** `INFLUENCER`, `DECISION_MAKER`, `UNKNOWN`

**Outcome:** `MET_INFLUENCER`, `MET_DECISION_MAKER`, `BUDGET_DISCUSSED`, `DEMO_DONE`, `PRICING_REQUESTED`, `PROPOSAL_SHARED`, `BUDGET_CONFIRMED`, `NEGOTIATION_STARTED`, `DEAL_CONFIRMED`, `PO_RECEIVED`, `NO_RESPONSE`, `FOLLOW_UP_DONE`, `INTERNAL_DISCUSSION`, `DECISION_DELAYED`, `DECISION_MAKER_UNAVAILABLE`, `BUDGET_NOT_AVAILABLE`, `DEAL_ON_HOLD`, `LOST_TO_COMPETITOR`, `DEAL_DROPPED`

**RiskCategory:** `NO_ACCESS_TO_DM`, `STUCK_WITH_INFLUENCER`, `BUDGET_NOT_DISCUSSED`, `BUDGET_NOT_CONFIRMED`, `BUDGET_INSUFFICIENT`, `COMPETITOR_INVOLVED`, `COMPETITOR_PREFERRED`, `DECISION_DELAYED`, `LOW_PRODUCT_FIT`, `FEATURE_GAP`, `CHAMPION_NOT_STRONG`, `INTERNAL_ALIGNMENT_MISSING`

---

*This document describes behavior implemented in the repository at the time of authoring; drift may occur if code changes without updating this file.*
