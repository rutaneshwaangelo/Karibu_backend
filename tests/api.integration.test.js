/**
 * KARIBU API integration tests.
 *
 * These tests boot the real Express app against a real MongoDB and exercise it
 * over HTTP. They never touch the development database: the connection string
 * from `.env` is rewritten to a sibling database whose name ends in `_test`
 * (or set `TEST_MONGODB_URI` explicitly), which is dropped when the run ends.
 *
 * Run with: npm test
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { User } = require('../models');

// ---------------------------------------------------------------------------
// Test database
// ---------------------------------------------------------------------------

function toTestDatabase(uri) {
  const url = new URL(uri);
  const dbName = url.pathname.replace(/^\//, '') || 'karibu';
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

const sourceUri = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;

if (!sourceUri) {
  throw new Error(
    'No MongoDB connection string found. Set MONGODB_URI (or TEST_MONGODB_URI) in .env before running the tests.'
  );
}

process.env.MONGODB_URI = toTestDatabase(sourceUri);
// Skip the 5s queue-engine interval: queue advancement is driven by the API
// calls under test, so the background tick would only add timing noise.
process.env.VERCEL = '1';

const mongoose = require('mongoose');
const app = require('../server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

async function api(method, route, { token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { status: res.status, body: json };
}

const stamp = Date.now();
const adminEmail = `admin.run${stamp}@example.com`;
const ownerEmail = `owner.run${stamp}@example.com`;

const state = {
  adminToken: null,
  ownerToken: null,
  categoryId: null,
  businessId: null,
  serviceId: null,
  queueA: null,
  queueB: null,
};

before(async () => {
  await mongoose.connection.asPromise();

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await User.create({
    name: 'Integration Admin',
    email: adminEmail,
    password: 'AdminPass2026!',
    role: 'ADMIN',
    active: true,
  });

  const login = await api('POST', '/api/auth/login', {
    body: { email: adminEmail, password: 'AdminPass2026!' },
  });
  assert.equal(login.status, 200, 'admin login should succeed during setup');
  state.adminToken = login.body.token;
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }

  const dbName = mongoose.connection.name;
  if (mongoose.connection.readyState === 1 && dbName.endsWith('_test')) {
    await mongoose.connection.dropDatabase();
  }

  await mongoose.disconnect();
});

// ---------------------------------------------------------------------------
// Health & auth
// ---------------------------------------------------------------------------

test('GET /api/health reports the service as up', async () => {
  const { status, body } = await api('GET', '/api/health');

  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.app, 'KARIBU Smart Queue Management System');
});

test('POST /api/auth/login rejects a wrong password', async () => {
  const { status, body } = await api('POST', '/api/auth/login', {
    body: { email: adminEmail, password: 'wrong-password' },
  });

  assert.equal(status, 401);
  assert.equal(body.success, false);
});

test('POST /api/auth/login returns a token that /api/auth/me accepts', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: adminEmail, password: 'AdminPass2026!' },
  });

  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  assert.equal(login.body.user.role, 'ADMIN');

  const me = await api('GET', '/api/auth/me', { token: login.body.token });

  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, adminEmail);
  assert.equal(me.body.user.businessId, null);
});

test('GET /api/auth/me without a token is rejected', async () => {
  const { status, body } = await api('GET', '/api/auth/me');

  assert.equal(status, 401);
  assert.match(body.message, /token/i);
});

test('POST /api/auth/logout always succeeds', async () => {
  const { status, body } = await api('POST', '/api/auth/logout');

  assert.equal(status, 200);
  assert.equal(body.success, true);
});

// ---------------------------------------------------------------------------
// Admin: category + business registration
// ---------------------------------------------------------------------------

test('admin can create a category', async () => {
  const { status, body } = await api('POST', '/api/admin/categories', {
    token: state.adminToken,
    body: {
      name: `Integration Category ${stamp}`,
      description: 'Created by the integration test suite',
    },
  });

  assert.equal(status, 201);
  assert.ok(body.data._id);
  state.categoryId = body.data._id;
});

test('admin registration creates business, owner, hours and free trial', async () => {
  const before = Date.now();

  const { status, body } = await api('POST', '/api/admin/businesses', {
    token: state.adminToken,
    body: {
      name: `Integration Salon ${stamp}`,
      categoryId: state.categoryId,
      ownerName: 'Integration Owner',
      email: ownerEmail,
      phone: '+254 700 000 001',
      location: 'Test Town',
      address: '1 Test Street',
      password: 'OwnerPass2026!',
      status: 'ACTIVE',
    },
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.ok(body.data.business._id);
  assert.equal(body.data.business.status, 'ACTIVE');
  assert.equal(body.data.owner.email, ownerEmail);
  assert.equal(body.data.owner.role, 'BUSINESS_OWNER');

  assert.equal(body.data.subscription.plan, 'FREE_TRIAL');
  assert.equal(body.data.subscription.status, 'ACTIVE');

  const endDate = new Date(body.data.subscription.endDate).getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.ok(
    Math.abs(endDate - (before + thirtyDays)) < 60 * 1000,
    'trial should end 30 days from registration'
  );

  state.businessId = body.data.business._id;
});

test('admin registration rejects a duplicate owner email', async () => {
  const { status, body } = await api('POST', '/api/admin/businesses', {
    token: state.adminToken,
    body: {
      name: `Duplicate Salon ${stamp}`,
      categoryId: state.categoryId,
      ownerName: 'Someone Else',
      email: ownerEmail,
      password: 'OwnerPass2026!',
    },
  });

  assert.equal(status, 400);
  assert.equal(body.success, false);
  assert.match(body.message, /already exists/i);
});

test('admin registration requires the core fields', async () => {
  const { status } = await api('POST', '/api/admin/businesses', {
    token: state.adminToken,
    body: { name: 'Incomplete Salon' },
  });

  assert.equal(status, 400);
});

test('the new owner can log in and load their business', async () => {
  const login = await api('POST', '/api/auth/login', {
    body: { email: ownerEmail, password: 'OwnerPass2026!' },
  });

  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'BUSINESS_OWNER');
  assert.equal(login.body.user.businessId, state.businessId);
  assert.equal(login.body.user.business.status, 'ACTIVE');

  state.ownerToken = login.body.token;

  const profile = await api('GET', '/api/business/profile', {
    token: state.ownerToken,
  });

  assert.equal(profile.status, 200);
  assert.equal(profile.body.data._id, state.businessId);
  assert.match(profile.body.data.name, /Integration Salon/);
});

test('admin registration initialized seven days of opening hours', async () => {
  const { status, body } = await api('GET', '/api/business/opening-hours', {
    token: state.ownerToken,
  });

  assert.equal(status, 200);
  assert.equal(body.data.length, 7);

  const monday = body.data.find((day) => day.dayOfWeek === 1);
  assert.equal(monday.isOpen, true);
  assert.equal(monday.openingTime, '08:00');
  assert.equal(monday.closingTime, '17:00');
});

test('a business owner cannot reach admin endpoints', async () => {
  const { status } = await api('GET', '/api/admin/dashboard', {
    token: state.ownerToken,
  });

  assert.equal(status, 403);
});

// ---------------------------------------------------------------------------
// Queue: join, wait, advance
// ---------------------------------------------------------------------------

test('owner creates a service', async () => {
  const { status, body } = await api('POST', '/api/services', {
    token: state.ownerToken,
    body: {
      name: 'Integration Haircut',
      description: '30 minute test service',
      durationMinutes: 30,
    },
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.data.durationMinutes, 30);
  state.serviceId = body.data._id;
});

test('first customer joining an idle business starts being served', async () => {
  const { status, body } = await api('POST', '/api/customer/queue/join', {
    body: {
      businessId: state.businessId,
      serviceId: state.serviceId,
      customerName: 'Integration Customer A',
      customerPhone: '+254 700 000 002',
    },
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.data.status, 'SERVING');
  assert.equal(body.data.position, 1);
  assert.match(body.data.queueNumber, /^K\d{3}$/);
  assert.equal(body.data.service.durationMinutes, 30);
  state.queueA = body.data.queueId;
});

test('second customer waits behind the one being served', async () => {
  const { status, body } = await api('POST', '/api/customer/queue/join', {
    body: {
      businessId: state.businessId,
      serviceId: state.serviceId,
      customerName: 'Integration Customer B',
      customerPhone: '+254 700 000 003',
    },
  });

  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(body.data.status, 'WAITING');
  assert.equal(body.data.position, 2);
  assert.ok(
    body.data.estimatedWaitMinutes >= 25,
    `expected roughly 30 minutes of wait, got ${body.data.estimatedWaitMinutes}`
  );
  state.queueB = body.data.queueId;
});

test('queue status reports the live position', async () => {
  const { status, body } = await api('GET', `/api/customer/queue/${state.queueB}`);

  assert.equal(status, 200);
  assert.equal(body.data.status, 'WAITING');
  // The status endpoint reports people ahead (the one being served), while
  // the join response reports the customer's own 1-based position.
  assert.equal(body.data.position, 1);
  assert.equal(body.data.service.name, 'Integration Haircut');
  assert.equal(body.data.customer.name, 'Integration Customer B');
});

test('a customer can find their place by ticket number', async () => {
  const ticket = (await api('GET', `/api/customer/queue/${state.queueB}`)).body
    .data.queueNumber;

  const { status, body } = await api('POST', '/api/customer/queue/track', {
    body: { query: ticket },
  });

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.matches.length, 1);

  const [match] = body.data.matches;
  assert.equal(match.queueId, state.queueB);
  assert.equal(match.queueNumber, ticket);
  assert.equal(match.status, 'WAITING');
  assert.equal(match.peopleAhead, 1);
  assert.equal(match.placeInLine, 2);
  assert.equal(match.totalWaiting, 1);
  assert.match(match.nowServing, /^K\d{3}$/);
  assert.equal(match.customer.name, 'Integration Customer B');
  assert.equal(match.business.name, `Integration Salon ${stamp}`);
});

test('a customer can find their place by the name they joined with', async () => {
  const { status, body } = await api('POST', '/api/customer/queue/track', {
    body: { name: 'Integration Customer B' },
  });

  assert.equal(status, 200, JSON.stringify(body));
  const match = body.data.matches.find((row) => row.queueId === state.queueB);
  assert.ok(match, 'the active ticket should be among the matches');
  assert.equal(match.customer.name, 'Integration Customer B');
});

test('tracking needs a ticket number or name', async () => {
  const { status } = await api('POST', '/api/customer/queue/track', {
    body: {},
  });

  assert.equal(status, 400);
});

test('tracking an unknown ticket returns an empty match list', async () => {
  const { status, body } = await api('POST', '/api/customer/queue/track', {
    body: { query: 'K999' },
  });

  assert.equal(status, 200);
  assert.deepEqual(body.data.matches, []);
});

test('joining with an unknown service is rejected', async () => {
  const { status } = await api('POST', '/api/customer/queue/join', {
    body: {
      businessId: state.businessId,
      serviceId: new mongoose.Types.ObjectId().toString(),
      customerName: 'Integration Customer X',
    },
  });

  assert.equal(status, 400);
});

test('the owner dashboard shows the live queue', async () => {
  const { status, body } = await api('GET', '/api/business/queue', {
    token: state.ownerToken,
  });

  assert.equal(status, 200);
  assert.equal(body.data.currentServing._id, state.queueA);
  assert.equal(body.data.waitingList.length, 1);
  assert.equal(body.data.waitingList[0]._id, state.queueB);
  assert.equal(body.data.totalWaiting, 1);
});

test('a customer leaving advances the next one to SERVING', async () => {
  const leave = await api('POST', `/api/customer/queue/${state.queueA}/leave`);

  assert.equal(leave.status, 200);
  assert.match(leave.body.message, /left the queue/i);

  const advanced = await api('GET', `/api/customer/queue/${state.queueB}`);

  assert.equal(advanced.status, 200);
  assert.equal(advanced.body.data.status, 'SERVING');
  assert.equal(advanced.body.data.position, 0);
  assert.ok(advanced.body.data.startedAt, 'startedAt should be set on promotion');
  assert.ok(advanced.body.data.expectedEndAt, 'expectedEndAt should be set');

  const board = await api('GET', '/api/business/queue', {
    token: state.ownerToken,
  });

  assert.equal(board.body.data.currentServing._id, state.queueB);
  assert.equal(board.body.data.waitingList.length, 0);
  assert.equal(board.body.data.totalWaiting, 0);
});

test('staff can extend the current service time', async () => {
  const { status, body } = await api(
    'POST',
    `/api/staff/queue/${state.queueB}/adjust-time`,
    { token: state.ownerToken, body: { minutes: 5 } }
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.extensionMinutes, 5);

  const tracked = await api('GET', `/api/customer/queue/${state.queueB}`);
  assert.equal(tracked.body.data.extensionMinutes, 5);
  assert.equal(tracked.body.data.status, 'SERVING');
});

test('leaving an unknown queue entry returns 404', async () => {
  const { status, body } = await api(
    'POST',
    `/api/customer/queue/${new mongoose.Types.ObjectId().toString()}/leave`
  );

  assert.equal(status, 404);
  assert.equal(body.success, false);
});

test('admin queue overview includes the active entry', async () => {
  const { status, body } = await api('GET', '/api/admin/queues', {
    token: state.adminToken,
  });

  assert.equal(status, 200);
  const entry = body.data.find((row) => row._id === state.queueB);
  assert.ok(entry, 'the SERVING entry should appear in the admin overview');
  assert.equal(entry.status, 'SERVING');
});

test('staff can complete the customer being served', async () => {
  const { status, body } = await api(
    'POST',
    `/api/staff/queue/${state.queueB}/complete`,
    { token: state.ownerToken }
  );

  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.data.status, 'COMPLETED');

  const tracked = await api('GET', `/api/customer/queue/${state.queueB}`);
  assert.equal(tracked.body.data.status, 'COMPLETED');

  const board = await api('GET', '/api/staff/queue', {
    token: state.ownerToken,
  });
  assert.equal(board.body.data.currentServing, null);

  const again = await api('POST', `/api/staff/queue/${state.queueB}/complete`, {
    token: state.ownerToken,
  });
  assert.equal(again.status, 400);
});
