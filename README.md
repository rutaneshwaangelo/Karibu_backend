# KARIBU — Smart Queue Management System (Backend API)

REST API and real-time (Socket.IO) backend for **KARIBU**, a multi-tenant queue
management platform for salons, clinics, banks, government offices and other
service businesses.

Customers join a queue online without an account and track their live position.
Business owners manage services, staff, opening hours and subscriptions. Platform
admins manage businesses, categories and users.

- **Stack:** Node.js, Express 4, MongoDB (Mongoose 8), Socket.IO, JWT, bcryptjs
- **Base URL (local):** `http://localhost:5000`
- **API prefix:** `/api`
- **Entry point:** `server.js` (also exported from `api/index.js` for Vercel)

---

## Table of contents

1. [Requirements](#requirements)
2. [Getting started](#getting-started)
3. [Environment variables](#environment-variables)
4. [npm scripts](#npm-scripts)
5. [API docs, collection & tests](#api-docs-collection--tests)
6. [Seeded demo accounts](#seeded-demo-accounts)
7. [Authentication & roles](#authentication--roles)
8. [Response & error format](#response--error-format)
9. [API reference](#api-reference)
   - [Health](#health)
   - [Auth](#auth)
   - [Admin](#admin)
   - [Business (owner)](#business-owner)
   - [Services](#services)
   - [Staff](#staff)
   - [Customer (public)](#customer-public)
10. [Real-time events (Socket.IO)](#real-time-events-socketio)
11. [Queue engine](#queue-engine)
12. [Project structure](#project-structure)
13. [Deployment](#deployment)

---

## Requirements

- **Node.js** 18 or newer
- **MongoDB** — a local instance (`mongodb://127.0.0.1:27017/karibu`) or a
  MongoDB Atlas connection string (`mongodb+srv://...`)

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
#    then edit .env and set MONGODB_URI and JWT_SECRET

# 3. Seed the database (admin user, categories, a demo business + staff)
npm run seed

# 4. Start the API
npm run dev     # nodemon, auto-restart
# or
npm start       # plain node
```

The server logs:

```
[MongoDB] Connected successfully: <host>/<db>
[KARIBU API] Server running in development mode on port 5000
```

Smoke test:

```bash
curl http://localhost:5000/api/health
```

## Environment variables

All variables are read from `.env` via `dotenv` (see `.env.example`).

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PORT` | No | `5000` | HTTP port the server listens on. |
| `MONGODB_URI` | **Yes** | — | MongoDB connection string (local or Atlas SRV). The app forces Google DNS (`8.8.8.8`) for SRV resolution. |
| `JWT_SECRET` | **Yes** (in production) | `karibu_super_secret_jwt_key_2026` | Secret used to sign/verify JWTs. The fallback is development-only — always set it in production. |
| `JWT_EXPIRE` | No | `24h` | Token lifetime, any `jsonwebtoken` duration string (`1h`, `7d`, ...). |
| `CLIENT_URL` | No | `http://localhost:5173` | Allowed frontend origin for CORS and Socket.IO. |
| `CORS_ORIGINS` | No | — | Comma-separated list of allowed origins. **Overrides** `CLIENT_URL` when set. Example: `http://localhost:5173,https://karibu.vercel.app` |
| `NODE_ENV` | No | `development` | Set to `production` to hide stack traces from error responses. |
| `VERCEL` | No | — | Set automatically by Vercel. When present, the in-process queue engine is not started (serverless has no long-lived process). |
| `TEST_MONGODB_URI` | No | `MONGODB_URI` + `_test` | Database used by `npm test`. Defaults to the `MONGODB_URI` database with a `_test` suffix, so tests never touch your dev data. |

Requests without an `Origin` header (curl, server-to-server) are always allowed.

## npm scripts

| Script | Command | Purpose |
| --- | --- | --- |
| `npm start` | `node server.js` | Run the API. |
| `npm run dev` | `nodemon server.js` | Run with auto-reload. |
| `npm run seed` | `node utils/seedAdmin.js` | Idempotent seed: admin user, 5 categories, demo business, demo owner/staff, 4 services, opening hours, free-trial subscription. |
| `npm test` | `node --test` | Integration tests against a disposable `_test` database (see below). |

## API docs, collection & tests

- **OpenAPI 3 spec:** [`docs/openapi.yaml`](docs/openapi.yaml) — every endpoint in
  this README, with schemas, auth and error responses. Open it in
  [Swagger Editor](https://editor.swagger.io) or generate a client from it.
- **Postman / Thunder Client:** import
  [`postman/KARIBU.postman_collection.json`](postman/KARIBU.postman_collection.json).
  It ships with collection variables (`baseUrl`, `token`, `businessId`, …) and
  scripts that store the JWT and returned IDs, so you can log in as admin, then
  walk the folders top to bottom. Point `baseUrl` at your server and log in as
  the relevant role before using the Business, Services or Staff folders.
- **Integration tests:**

  ```bash
  npm test
  ```

  `tests/api.integration.test.js` boots the real app over HTTP and covers login,
  admin business registration (owner, opening hours, free trial), role checks,
  and the queue join/wait/promote/cancel/time-adjust flow. It connects to
  `TEST_MONGODB_URI` when set, otherwise to `MONGODB_URI` with a `_test` suffix,
  and drops that database when the run finishes.

## Seeded demo accounts

`npm run seed` is safe to re-run — it updates existing records instead of
duplicating them.

| Role | Email | Password |
| --- | --- | --- |
| `ADMIN` | `admin@gmail.com` | `123karibu` |
| `BUSINESS_OWNER` | `john@kibalisalon.com` | `SalonPass2026!` |
| `STAFF` | `sarah@kibalisalon.com` | `StaffPass2026!` |

The demo business is **Kibali Executive Salon & Barber** (Nairobi West), with four
services and a 30-day `FREE_TRIAL` subscription.

## Authentication & roles

- Login returns a signed JWT. Send it on every protected request:

  ```
  Authorization: Bearer <token>
  ```

- JWT payload: `{ id, role, businessId, iat, exp }`.
- The middleware re-loads the user from the database on each request, so
  deactivated accounts (`active: false`) are rejected immediately with `403`.
- Roles: `ADMIN`, `BUSINESS_OWNER`, `STAFF`.
- Owners and staff are **tenant-scoped**: `verifyBusinessAccess` rejects any
  request whose `businessId` (in params, query or body) differs from the caller's,
  and rejects callers whose business is not `ACTIVE`.
- Login also fails with `403` if the caller's business is suspended or inactive.

| Capability | ADMIN | BUSINESS_OWNER | STAFF | Public |
| --- | :-: | :-: | :-: | :-: |
| Login / me / logout | ✅ | ✅ | ✅ | login, logout |
| Platform dashboard, reports, businesses, categories, users, subscriptions | ✅ | — | — | — |
| Business dashboard, profile, staff, opening hours, subscription | — | ✅ | — | — |
| View services | — | ✅ | ✅ | — |
| Create / update / delete services | — | ✅ | — | — |
| View business queue | — | ✅ | ✅ | — |
| Adjust service time / cancel entry | — | ✅ | ✅ | — |
| Browse businesses & categories, join / track / leave queue | — | — | — | ✅ |

## Response & error format

Successful responses:

```json
{ "success": true, "data": { } }
```

List endpoints may also include `count`; mutations include `message`.

Errors:

```json
{ "success": false, "message": "Human readable reason" }
```

In `NODE_ENV=development` the global error handler also returns `error` (stack
trace). Unknown routes return `404` with
`{ "success": false, "message": "Route not found: <METHOD> <url>" }`.

---

## API reference

Legend: 🔓 public · 🔑 any authenticated user · 🛡️ specific role(s).

### Health

#### `GET /api/health` 🔓

Liveness check.

```json
{
  "status": "ok",
  "app": "KARIBU Smart Queue Management System",
  "version": "1.0.0",
  "environment": "development",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

---

### Auth

#### `POST /api/auth/login` 🔓

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `email` | string | ✅ | Case-insensitive, trimmed. |
| `password` | string | ✅ | Plain text; compared against the bcrypt hash. |

`200`:

```json
{
  "success": true,
  "token": "<jwt>",
  "user": {
    "id": "...",
    "name": "John Kibali",
    "email": "john@kibalisalon.com",
    "phone": "+254 711 000 111",
    "role": "BUSINESS_OWNER",
    "businessId": "...",
    "business": { "id": "...", "name": "Kibali Executive Salon & Barber", "location": "Nairobi West", "status": "ACTIVE" }
  }
}
```

Errors: `400` missing credentials · `401` bad email/password · `403` deactivated
account, missing business, or business not `ACTIVE`.

#### `GET /api/auth/me` 🔑

Returns the current user plus the populated business (including
`categoryId.name`). `user.business` is `null` for admins.

#### `POST /api/auth/logout` 🔓

Stateless — always `200` with `{ "success": true, "message": "Logged out successfully" }`.
The client is responsible for discarding the token.

---

### Admin

All routes below require `Authorization: Bearer <token>` with role `ADMIN`
(`verifyToken` + `requireRole('ADMIN')` applied at the router level).

#### `GET /api/admin/dashboard` 🛡️

```json
{
  "success": true,
  "data": {
    "totalBusinesses": 0,
    "activeBusinesses": 0,
    "totalCategories": 0,
    "totalUsers": 0,
    "queuesToday": 0,
    "activeServingCount": 0,
    "waitingCount": 0,
    "completedTodayCount": 0
  }
}
```

#### `POST /api/admin/businesses` 🛡️

Atomically registers a business + its owner account, default opening hours
(Sun closed; Mon–Fri 08:00–17:00; Sat 09:00–15:00) and a 30-day `FREE_TRIAL`
subscription.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | Business name. |
| `categoryId` | ObjectId | ✅ | Must exist. |
| `ownerName` | string | ✅ | Owner's display name. |
| `email` | string | ✅ | Owner login email; must be unique. |
| `password` | string | ✅ | Owner password (hashed by the model). |
| `phone` | string | No | |
| `location` | string | No | Short area, e.g. `Nairobi West`. |
| `address` | string | No | Street address. |
| `status` | string | No | `ACTIVE` (default), `SUSPENDED`, `INACTIVE`. |

`201`: `{ success, message, data: { business, owner: { id, name, email, role }, subscription } }`

Errors: `400` missing fields, duplicate email, unknown category.

#### `GET /api/admin/businesses` 🛡️

Query: `status`, `category` (category id), `search` (case-insensitive name match).

Returns each business with populated `categoryId` (`name`) and `ownerId`
(`name email phone`) plus `serviceCount` and `activeQueueCount`. Sorted newest
first.

#### `PUT /api/admin/businesses/:id` 🛡️

Editable: `name`, `categoryId`, `location`, `address`, `phone`, `email`, `status`.
Only supplied fields change. `404` if the business does not exist.

#### `GET /api/admin/categories` 🛡️

All categories (active and inactive), sorted by name. Includes `count`.

#### `POST /api/admin/categories` 🛡️

Body: `name` (required), `description` (optional). `201` with the category.
`400` if the name already exists.

#### `PUT /api/admin/categories/:id` 🛡️

Editable: `name`, `description`, `active`.

#### `DELETE /api/admin/categories/:id` 🛡️

Hard delete. `400` if any business is still assigned to the category
(deactivate it instead).

#### `GET /api/admin/users` 🛡️

Query: `role` (`ADMIN` | `BUSINESS_OWNER` | `STAFF`), `businessId`.
Returns users without passwords, with `businessId` populated as
`{ name, status }`. Includes `count`.

#### `PATCH /api/admin/users/:id/toggle-status` 🛡️

Flips `active`. An admin cannot deactivate their own account (`400`).

#### `GET /api/admin/queues` 🛡️

Live queue across all businesses — entries with status `SERVING` or `WAITING`,
populated `businessId` (`name location`), `serviceId` (`name durationMinutes`),
`customerId` (`name phone`), ordered by `joinedAt`. Includes `count`.

#### `GET /api/admin/subscriptions` 🛡️

All subscriptions with `businessId` populated (`name email phone status`),
newest first. Includes `count`.

#### `PUT /api/admin/subscriptions/:id` 🛡️

Editable: `plan`, `status`, `endDate` (ISO date string).

#### `GET /api/admin/reports` 🛡️

```json
{
  "success": true,
  "data": {
    "totalQueuesServed": 0,
    "totalQueuesWaiting": 0,
    "totalCancelled": 0,
    "categoryStats": [{ "_id": "Hair, Beauty & Grooming", "totalQueues": 12 }]
  }
}
```

`totalCancelled` counts both `LEFT` and `CANCELLED`. `categoryStats` is an
aggregation of all-time queue entries grouped by category name, highest first.

---

### Business (owner)

Router: `/api/business` — requires `BUSINESS_OWNER` **and** an active business
(`verifyBusinessAccess`).

#### `GET /api/business/dashboard` 🛡️

```json
{
  "success": true,
  "data": {
    "totalQueuesToday": 0,
    "currentServing": null,
    "waitingCount": 0,
    "completedToday": 0,
    "totalServices": 0,
    "totalStaff": 0
  }
}
```

`currentServing` is the populated `SERVING` queue entry (or `null`).

#### `GET /api/business/profile` 🛡️

The business document with `categoryId.name` and `ownerId`
(`name email phone`).

#### `PUT /api/business/profile` 🛡️

Editable: `name`, `location`, `address`, `phone`, `email`. Status and category
are admin-only.

#### `GET /api/business/queue` 🛡️

Live queue for the caller's business:

```json
{
  "success": true,
  "data": {
    "currentServing": { },
    "waitingList": [ ],
    "recentlyCompleted": [ ],
    "totalWaiting": 0
  }
}
```

`waitingList` is ordered by `joinedAt`; `recentlyCompleted` holds today's
`COMPLETED` entries (max 10, newest first). Both `serviceId` and `customerId`
are populated.

#### `POST /api/business/queue/:id/cancel` 🛡️

Cancels an entry belonging to this business (no-show or manual removal). Sets
status to `CANCELLED`; if it was `SERVING`, the next customer is promoted,
otherwise wait times are recalculated. Emits `queue_updated` and
`customer_status_changed`.

Body: none.

#### `GET /api/business/staff` 🛡️

All `STAFF` users of the business (passwords excluded). Includes `count`.

#### `POST /api/business/staff` 🛡️

| Body field | Type | Required |
| --- | --- | --- |
| `name` | string | ✅ |
| `email` | string | ✅ (unique across the platform) |
| `password` | string | ✅ |
| `phone` | string | No |

`201` with `{ id, name, email, phone, role, businessId, active }`.

#### `DELETE /api/business/staff/:id` 🛡️

Soft delete — sets `active: false` so queue history stays intact. `404` if the
user is not staff of this business.

#### `GET /api/business/opening-hours` 🛡️

Up to 7 documents (`dayOfWeek` 0 = Sunday … 6 = Saturday), sorted by day:

```json
[{ "dayOfWeek": 1, "isOpen": true, "openingTime": "08:00", "closingTime": "17:00" }]
```

#### `PUT /api/business/opening-hours` 🛡️

Upserts the supplied days.

```json
{
  "hours": [
    { "dayOfWeek": 0, "isOpen": false, "openingTime": "10:00", "closingTime": "16:00" },
    { "dayOfWeek": 1, "isOpen": true,  "openingTime": "08:00", "closingTime": "17:00" }
  ]
}
```

`400` if `hours` is not an array. Returns the updated array.

#### `GET /api/business/subscription` 🛡️

The business's subscription document, or `data: null` if none exists. Includes
`plan`, `status`, `billingCycle`, `startDate`, `endDate`, `lastPaymentDate`,
`lastPaymentAmount`, `paymentMethod`.

#### `POST /api/business/subscription/pay` 🛡️

Simulated payment/renewal (no external gateway).

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `plan` | string | ✅ | `BASIC`, `PRO` or `ENTERPRISE`. |
| `billingCycle` | string | No | `monthly` (default) or `yearly`. |
| `paymentMethod` | string | No | Default `Card`. |

Pricing (USD): BASIC 29/mo or 290/yr · PRO 59/mo or 590/yr · ENTERPRISE 120/mo or
1200/yr. If the current subscription is still active, the new period starts at
its `endDate` (stacking); otherwise it starts now. Pays for 30 or 365 days.

`200`: `{ success, message, data: subscription }`. `400` for an invalid plan.

---

### Services

Router: `/api/services` — `verifyToken` + `verifyBusinessAccess` on every route.
Owners and staff can read; only owners can write.

#### `GET /api/services` 🛡️ (`BUSINESS_OWNER`, `STAFF`)

Active services of the caller's business, newest first. Includes `count`.
Each service: `{ _id, businessId, name, description, durationMinutes, active, createdAt, updatedAt }`.

#### `POST /api/services` 🛡️ (`BUSINESS_OWNER`)

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | ✅ | |
| `durationMinutes` | integer | ✅ | 1–720. |
| `description` | string | No | |

`201`: `{ success, message, data: service }`. `400` for a missing name or an
out-of-range duration.

#### `PUT /api/services/:id` 🛡️ (`BUSINESS_OWNER`)

Editable: `name`, `description`, `durationMinutes`, `active`. `404` if the service
belongs to another business.

#### `DELETE /api/services/:id` 🛡️ (`BUSINESS_OWNER`)

Soft delete (`active: false`) so historical queue records stay valid.
Returns `{ success, message }`. No body required.

---

### Staff

Router: `/api/staff` — `STAFF` or `BUSINESS_OWNER` with tenant validation.

#### `GET /api/staff/queue` 🛡️

Identical to `GET /api/business/queue`: `currentServing`, `waitingList`,
`recentlyCompleted`, `totalWaiting`.

#### `POST /api/staff/queue/:id/adjust-time` 🛡️

Extends or shortens the currently served entry's expected end time (typical
buttons: +5, +10, +15, −5, −10 minutes).

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `minutes` | number | ✅ | Positive = longer, negative = shorter. Result may not go below 0. |

`200`:

```json
{
  "success": true,
  "message": "Service duration adjusted by +5 minutes.",
  "data": { }
}
```

`400` with the engine's reason if the entry is not `SERVING` or the adjustment is
invalid. Recalculates wait times and emits `queue_updated` + `service_time_adjusted`.

#### `POST /api/staff/queue/:id/complete` 🛡️

Marks the customer currently being served as `COMPLETED` (sets `completedAt`
and `actualDurationMinutes`) and immediately promotes the next waiting customer.
Emits `queue_updated` (`customer_completed`) and `customer_status_changed`
(`COMPLETED`).

Body: none. Returns `{ success, message, data: { queueId, status } }`; `400` if the
entry is not `SERVING`, `404` if it belongs to another business.

#### `POST /api/staff/queue/:id/cancel` 🛡️

Same behaviour as the business cancel endpoint. Body: none.

---

### Customer (public)

Router: `/api/customer` — no authentication.

#### `GET /api/customer/categories` 🔓

Active categories, sorted by name, in `data`.

#### `GET /api/customer/businesses` 🔓

Active businesses only.

| Query | Type | Notes |
| --- | --- | --- |
| `category` | ObjectId | Filter by category. |
| `search` | string | Case-insensitive name match. |
| `location` | string | Case-insensitive location match. |

```json
{
  "success": true,
  "count": 1,
  "data": [
    {
      "id": "...",
      "name": "Kibali Executive Salon & Barber",
      "category": "Hair, Beauty & Grooming",
      "categoryId": "...",
      "location": "Nairobi West",
      "address": "Westgate Plaza, 2nd Floor",
      "phone": "+254 711 000 111",
      "services": [{ "_id": "...", "name": "Executive Haircut", "durationMinutes": 30, "description": "..." }]
    }
  ]
}
```

#### `GET /api/customer/businesses/:id` 🔓

Details and active services for a single active business. `404` if it does not
exist or is inactive. Adds `email`.

#### `POST /api/customer/queue/join` 🔓

Joins a queue. Creates a `Customer` record, allocates the next daily queue number
(`K001`, `K002`, …), and immediately promotes the entry to `SERVING` if nobody is
being served.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `businessId` | ObjectId | ✅ | Business must be `ACTIVE`. |
| `serviceId` | ObjectId | ✅ | Must be active and belong to that business. |
| `customerName` | string | ✅ | |
| `customerPhone` | string | No | |

`201`:

```json
{
  "success": true,
  "message": "Successfully joined queue for Kibali Executive Salon & Barber!",
  "data": {
    "queueId": "...",
    "queueNumber": "K001",
    "status": "SERVING",
    "position": 1,
    "estimatedWaitMinutes": 0,
    "service": { "id": "...", "name": "Executive Haircut", "durationMinutes": 30 },
    "business": { "id": "...", "name": "...", "location": "Nairobi West" }
  }
}
```

Emits `queue_updated` (`action: "customer_joined"`) to `business:<id>`.

Errors: `400` missing fields, business inactive, service unavailable.

#### `GET /api/customer/queue/:id` 🔓

Live status for one entry, with recalculated position.

```json
{
  "success": true,
  "data": {
    "queueId": "...",
    "queueNumber": "K003",
    "status": "WAITING",
    "position": 2,
    "estimatedWaitMinutes": 45,
    "joinedAt": "...",
    "startedAt": null,
    "expectedEndAt": null,
    "extensionMinutes": 0,
    "customer": { "name": "Jane" },
    "service": { "name": "Executive Haircut", "durationMinutes": 30 },
    "business": { "id": "...", "name": "...", "location": "...", "address": "..." }
  }
}
```

`position` is `0` while `SERVING`, `0` for finished entries, otherwise the number
of people ahead (including the one being served). `404` if not found.

#### `POST /api/customer/queue/track` 🔓

Find a customer's place in the line when they no longer have the ticket link.
Matches either the ticket number (`K001`) or the name used to join, and returns
every still-active (`WAITING`/`SERVING`) entry that matches.

| Body field | Type | Required | Notes |
| --- | --- | --- | --- |
| `query` | string | ✅ | Ticket number or customer name. `ticketNumber`, `queueNumber`, `ticket`, `name`, `customerName` and `search` are accepted as aliases, and `?query=` works too. |

`200` with a `matches` array (`[]` when nothing is queued — not an error), each item:

```json
{
  "success": true,
  "data": {
    "matches": [
      {
        "queueId": "...",
        "queueNumber": "K002",
        "status": "WAITING",
        "peopleAhead": 1,
        "placeInLine": 2,
        "estimatedWaitMinutes": 30,
        "nowServing": "K001",
        "totalWaiting": 1,
        "business": { "id": "...", "name": "Kibali Executive Salon & Barber", "location": "Nairobi West" },
        "customer": { "name": "Jane Wambui" },
        "service": { "name": "Executive Haircut", "durationMinutes": 30 }
      }
    ]
  }
}
```

`peopleAhead` is the number of customers in front (including whoever is being
served), `placeInLine` is the customer's own position (1-based) and `nowServing`
is the ticket currently at the desk. `400` when no search text was supplied.

#### `POST /api/customer/queue/:id/leave` 🔓

Voluntarily leaves. Sets status `LEFT` and `leftAt`. If the customer was being
served, the next waiting customer is promoted; otherwise wait times are
recalculated. Emits `queue_updated` (`action: "customer_left"`).

Returns `{ success: true, message: "You have left the queue." }`. `400` if the
entry is already `COMPLETED` or `CANCELLED`.

---

## Real-time events (Socket.IO)

Connect to the same origin as the API (`io()` on the frontend, with the API URL).
CORS uses the same allow-list as HTTP (`CORS_ORIGINS` / `CLIENT_URL`).

### Client → server

| Event | Payload | Effect |
| --- | --- | --- |
| `join_business` | `businessId` (string) | Subscribes the socket to room `business:<businessId>`. |
| `join_queue` | `queueId` (string) | Subscribes the socket to room `queue:<queueId>`. |

### Server → client

| Event | Room | Payload |
| --- | --- | --- |
| `queue_updated` | `business:<id>` | `{ action, queueNumber, ... }` where `action` is `customer_joined`, `customer_serving`, `customer_completed`, `customer_left`, `customer_cancelled`, or `time_adjusted`. |
| `customer_status_changed` | `queue:<id>` | `{ status }` — `SERVING`, `COMPLETED` or `CANCELLED`. |
| `service_time_adjusted` | `queue:<id>` | `{ extensionMinutes }` |

Typical frontend flow: staff/owner dashboards emit `join_business` and refetch the
queue on any `queue_updated`; customers emit `join_queue` after joining and
render the new status from `customer_status_changed`.

## Queue engine

`services/queueEngine.js` runs an interval every **5 seconds** (started from
`server.js` unless `VERCEL` is set). It:

1. Finds `SERVING` entries whose `expectedEndAt` has passed and marks them
   `COMPLETED`.
2. Promotes the oldest `WAITING` entry to `SERVING`, sets `startedAt` and
   `expectedEndAt` (service duration + accumulated extensions).
3. Recalculates `estimatedWaitMinutes` for everyone still waiting.
4. Emits the Socket.IO events listed above.

Because it relies on a long-lived process, deploy the API on a server or worker
platform (Render, Railway, Fly.io, a VPS) for automatic queue progression. On
Vercel's serverless runtime the engine is skipped — queue progression then only
happens through API actions.

## Project structure

```
.
├── api/index.js            # Vercel entry — re-exports the Express app
├── server.js               # Express app, CORS, routes, Socket.IO, queue engine
├── config/db.js            # Mongoose connection (Google DNS for SRV)
├── middleware/auth.js      # verifyToken, requireRole, verifyBusinessAccess
├── models/                 # User, Business, Category, Service, Customer,
│                           # Queue, OpeningHours, Subscription (+ index.js)
├── controllers/            # auth, admin, business, service, queue, customer
├── routes/                 # auth, admin, business, service, staff, customer
├── services/queueEngine.js # Queue number generation, promotion, wait times
├── utils/generateToken.js  # JWT signing
├── utils/seedAdmin.js      # `npm run seed`
├── tests/                  # Integration tests (`npm test`)
├── docs/openapi.yaml       # OpenAPI 3 spec
├── postman/                # Postman / Thunder Client collection
└── .env.example
```

## Deployment

1. Set `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, and `CORS_ORIGINS`
   (your deployed frontend URL) in the host's environment settings.
2. Ensure the MongoDB cluster allows connections from the host's IPs (Atlas:
   `0.0.0.0/0` or the platform's egress ranges).
3. Prefer a always-on host so the queue engine runs. On Vercel, `api/index.js`
   serves the Express app but the engine is disabled.

Frontend note: point the client at `<API_URL>/api` and connect Socket.IO to
`<API_URL>`.
