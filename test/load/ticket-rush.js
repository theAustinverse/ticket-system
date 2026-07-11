import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Load test for the high-concurrency ticket rush flow, modeling the
 * realistic scenario where users already have accounts (created ahead of
 * time) and only need to log in at the moment the sale opens:
 *
 *   pre-register VUS accounts in setup() -> each VU logs in -> enters the
 *   queue room -> polls until admitted -> creates an order.
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
const PASSWORD = 'password123';

if (!TICKET_TYPE_ID) {
  throw new Error('Set -e TICKET_TYPE_ID=<id> to the ticket type to hammer');
}

export const options = {
  setupTimeout: '30m',
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

const LOGIN_BATCH_SIZE = 18; // stays under the default 20-per-10s anti-bot limit
const LOGIN_BATCH_INTERVAL_S = 11;

/**
 * Accounts must already exist before running this test — see
 * scratch-seed-users.js, which inserts them directly via Prisma (bypassing
 * the anti-bot rate limiter, which would otherwise throttle a bulk
 * registration burst from a single IP, same as it would for a real attacker).
 * Pass the run id used when seeding via -e RUN_ID=<id>.
 *
 * This models the realistic case where users log in well ahead of the sale
 * and are already holding a valid session when the queue opens — logging
 * everyone in here, paced to respect the anti-bot rate limit, isolates the
 * timed scenario below to measure pure queue+order throughput rather than
 * bcrypt login cost.
 */
export function setup() {
  const runId = __ENV.RUN_ID;
  if (!runId) {
    throw new Error(
      'Set -e RUN_ID=<id> matching the id used by scratch-seed-users.js',
    );
  }

  const tokens = [];
  for (let start = 0; start < VUS; start += LOGIN_BATCH_SIZE) {
    const chunkSize = Math.min(LOGIN_BATCH_SIZE, VUS - start);
    const requests = [];
    for (let i = 0; i < chunkSize; i++) {
      const idx = start + i;
      requests.push({
        method: 'POST',
        url: `${BASE_URL}/auth/login`,
        body: JSON.stringify({
          email: `loadtest-${runId}-${idx}@example.com`,
          password: PASSWORD,
        }),
        params: { headers: { 'Content-Type': 'application/json' } },
      });
    }
    const responses = http.batch(requests);
    for (const res of responses) {
      tokens.push(res.json('accessToken'));
    }
    if (start + chunkSize < VUS) {
      sleep(LOGIN_BATCH_INTERVAL_S);
    }
  }

  console.log(
    `ticketTypeId=${TICKET_TYPE_ID} totalStock=${TOTAL_STOCK} vus=${VUS} runId=${runId} preLoggedIn=${tokens.length}`,
  );
  return { ticketTypeId: TICKET_TYPE_ID, tokens };
}

export default function (data) {
  const { ticketTypeId, tokens } = data;
  const accessToken = tokens[__VU - 1];

  // Spread the initial connection burst over a few seconds instead of every
  // VU opening a socket in the exact same instant, which just tests the OS
  // TCP accept-queue depth rather than the application.
  sleep(Math.random() * 5);

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
