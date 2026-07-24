import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

/**
 * Full-stack production load test: simulates VUS concurrent NEW users each
 * registering (with email verification), then immediately racing for a
 * ticket. Only runs correctly while the backend has LOAD_TEST_MODE=true set
 * (see AuthService.register / OrderService.createOrder / RateLimitGuard),
 * which:
 *   - accepts loadtest<n>@gmail.com addresses without a real inbox, and
 *     returns the verification code directly in the register response
 *     instead of emailing it
 *   - skips the order-confirmation email for those same synthetic accounts
 *   - disables the IP-based anti-bot rate limiter (a k6 run from one
 *     machine would otherwise share a single IP bucket with itself)
 *
 * Before running: call POST /admin/reset-stock (via the "重置票種庫存"
 * button on /admin/orders) so TICKET_TYPE_ID's Redis counter reflects only
 * real orders, not leftover drift from a previous run.
 *
 * After running: verify no oversell via GET /admin/orders (or the DB
 * directly), then delete the synthetic accounts via the "刪除 loadtest
 * 測試帳號" button (or DELETE /admin/load-test-users), then reset stock
 * again to repair Redis back to the true real-orders-only remaining count.
 * Finally unset LOAD_TEST_MODE on Railway to restore anti-bot + email
 * verification.
 *
 *   k6 run -e BASE_URL=https://api-production-0c47.up.railway.app \
 *     -e TICKET_TYPE_ID=<id> -e VUS=2000 -e RUN_ID=$(date +%s) \
 *     test/load/production-rush.js
 */

const BASE_URL = __ENV.BASE_URL;
const TICKET_TYPE_ID = __ENV.TICKET_TYPE_ID;
const VUS = Number(__ENV.VUS || 2000);
const RUN_ID = __ENV.RUN_ID || Date.now().toString();
const PASSWORD = 'LoadTest123!';

if (!BASE_URL) throw new Error('Set -e BASE_URL=<production api url>');
if (!TICKET_TYPE_ID) throw new Error('Set -e TICKET_TYPE_ID=<id> to hammer');

export const options = {
  scenarios: {
    registration_and_ticket_rush: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: 1,
      maxDuration: '10m',
    },
  },
};

const registrationsOk = new Counter('registrations_ok');
const registrationsFailed = new Counter('registrations_failed');
const ordersCreated = new Counter('orders_created');
const ordersRejected = new Counter('orders_rejected');
const insufficientStock = new Counter('orders_insufficient_stock');

export default function () {
  // Spread the initial connection burst over a few seconds instead of every
  // VU opening a socket in the exact same instant.
  sleep(Math.random() * 5);

  const email = `loadtest${RUN_ID}${__VU}@gmail.com`;
  const jsonHeaders = { headers: { 'Content-Type': 'application/json' } };

  // 1. Register (simulates the "2000 people registering at once" scenario).
  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: PASSWORD }),
    jsonHeaders,
  );
  const debugCode = registerRes.json('debugCode');
  if (registerRes.status !== 201 && registerRes.status !== 200) {
    registrationsFailed.add(1);
    return;
  }
  if (!debugCode) {
    // LOAD_TEST_MODE isn't on, or this email didn't match the test pattern —
    // there's no way to complete verification without a real inbox.
    registrationsFailed.add(1);
    return;
  }

  // 2. Verify (completes account creation, returns a session token).
  const verifyRes = http.post(
    `${BASE_URL}/auth/verify-registration`,
    JSON.stringify({ email, code: debugCode }),
    jsonHeaders,
  );
  const accessToken = verifyRes.json('accessToken');
  if (!accessToken) {
    registrationsFailed.add(1);
    return;
  }
  registrationsOk.add(1);

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  };

  // 2b. Fill in the profile — the queue-room entry gate requires a
  // complete profile (name/team/lineId/phone) before granting ticket
  // eligibility, same as a real account must before it can queue.
  http.patch(
    `${BASE_URL}/users/me`,
    JSON.stringify({
      name: '測試使用者',
      team: '壓力測試',
      lineId: `loadtest${__VU}`,
      phone: '0900000000',
    }),
    authHeaders,
  );

  // 3. Enter the queue room (simulates the "2000 people racing for a
  // ticket" scenario, immediately after registering).
  const enterRes = http.post(
    `${BASE_URL}/queue/${TICKET_TYPE_ID}/enter`,
    null,
    authHeaders,
  );
  const queueToken = enterRes.json('token');
  if (!queueToken) {
    ordersRejected.add(1);
    return;
  }

  let admitted = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const statusRes = http.get(
      `${BASE_URL}/queue/${TICKET_TYPE_ID}/status?token=${queueToken}`,
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

  // 4. Create the order (no payment step — creation itself is final).
  const orderRes = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({
      ticketTypeId: TICKET_TYPE_ID,
      quantity: 1,
      registrantName: `LoadTest${__VU}`,
      registrantTeam: '壓力測試',
      registrantLineId: `loadtest${__VU}`,
      registrantPhone: '0900000000',
      mealPreference: '葷食',
    }),
    {
      headers: {
        ...authHeaders.headers,
        'x-queue-token': queueToken,
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
