import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Load test for the high-concurrency ticket rush flow:
 * register -> enter queue room -> poll until admitted -> create order.
 *
 * The ticket type must already exist (see scratch-seed-loadtest.sh pattern:
 * create an Event -> Session -> SaleBatch with saleStartAt in the past ->
 * TicketType). Pass its id and stock size in:
 *
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *     -e TICKET_TYPE_ID=<id> -e TOTAL_STOCK=250 -e VUS=2500 \
 *     test/load/ticket-rush.js
 *
 * After the run, verify no oversell by checking the database directly:
 *   SELECT COUNT(*) FROM "Order" WHERE "ticketTypeId" = '<TICKET_TYPE_ID>';
 * This count must be <= TOTAL_STOCK.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;
const TOTAL_STOCK = Number(__ENV.TOTAL_STOCK || 250);
const VUS = Number(__ENV.VUS || 2500);

if (!TICKET_TYPE_ID) {
  throw new Error('Set -e TICKET_TYPE_ID=<id> to the ticket type to hammer');
}

export const options = {
  scenarios: {
    ticket_rush: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '8m',
    },
  },
};

const ordersCreated = new Counter('orders_created');
const ordersRejected = new Counter('orders_rejected');
const insufficientStock = new Counter('orders_insufficient_stock');

export function setup() {
  console.log(`ticketTypeId=${TICKET_TYPE_ID} totalStock=${TOTAL_STOCK} vus=${VUS}`);
  return { ticketTypeId: TICKET_TYPE_ID };
}

export default function (data) {
  const { ticketTypeId } = data;
  const email = `loadtest-${__VU}-${Date.now()}@example.com`;
  const password = 'password123';

  // Spread the initial connection burst over a few seconds instead of every
  // VU opening a socket in the exact same instant, which just tests the OS
  // TCP accept-queue depth rather than the application.
  sleep(Math.random() * 5);

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
  for (let attempt = 0; attempt < 150; attempt++) {
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
