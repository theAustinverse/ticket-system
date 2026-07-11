import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Load test for the high-concurrency ticket rush flow:
 * register -> login -> enter queue room -> poll until admitted -> create order.
 *
 * Run with: k6 run -e BASE_URL=http://localhost:3000 test/load/ticket-rush.js
 *
 * After the run, verify no oversell by checking the database directly:
 *   SELECT COUNT(*) FROM "Order" WHERE "ticketTypeId" = '<ticketTypeId printed in setup>';
 * This count must be <= TOTAL_STOCK.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOTAL_STOCK = 200;

export const options = {
  scenarios: {
    ticket_rush: {
      executor: 'per-vu-iterations',
      vus: 500,
      iterations: 1,
      maxDuration: '2m',
    },
  },
};

const ordersCreated = new Counter('orders_created');
const ordersRejected = new Counter('orders_rejected');
const insufficientStock = new Counter('orders_insufficient_stock');

export function setup() {
  const eventRes = http.post(
    `${BASE_URL}/events`,
    JSON.stringify({ name: 'Load Test Concert' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const eventId = eventRes.json('id');

  const sessionRes = http.post(
    `${BASE_URL}/events/${eventId}/sessions`,
    JSON.stringify({ venue: 'Test Arena', startTime: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const sessionId = sessionRes.json('id');

  const ticketTypeRes = http.post(
    `${BASE_URL}/events/sessions/${sessionId}/ticket-types`,
    JSON.stringify({ name: 'GA', price: 1000, totalQuantity: TOTAL_STOCK }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const ticketTypeId = ticketTypeRes.json('id');

  console.log(`ticketTypeId=${ticketTypeId} totalStock=${TOTAL_STOCK}`);
  return { ticketTypeId };
}

export default function (data) {
  const { ticketTypeId } = data;
  const email = `loadtest-${__VU}-${Date.now()}@example.com`;
  const password = 'password123';

  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const accessToken = registerRes.json('accessToken');
  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  };

  const enterRes = http.post(
    `${BASE_URL}/queue/${ticketTypeId}/enter`,
    null,
    authHeaders,
  );
  const token = enterRes.json('token');

  let admitted = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const statusRes = http.get(
      `${BASE_URL}/queue/${ticketTypeId}/status?token=${token}`,
      authHeaders,
    );
    if (statusRes.json('state') === 'admitted') {
      admitted = true;
      break;
    }
    sleep(1);
  }

  if (!admitted) {
    ordersRejected.add(1);
    return;
  }

  const orderRes = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ ticketTypeId, quantity: 1 }),
    {
      headers: {
        ...authHeaders.headers,
        'x-queue-token': token,
      },
    },
  );

  check(orderRes, {
    'order created or correctly rejected': (r) =>
      r.status === 201 || r.status === 400,
  });

  if (orderRes.status === 201) {
    ordersCreated.add(1);
  } else if (orderRes.status === 400) {
    insufficientStock.add(1);
  } else {
    ordersRejected.add(1);
  }
}
