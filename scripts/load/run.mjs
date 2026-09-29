// Load run: virtual staff users hit a weighted mix of the busiest screens and a few writes,
// then latency percentiles per endpoint are printed (and written as JSON with LOAD_OUT).
//
//   LOAD_PASSWORD=... node scripts/load/run.mjs
//
// Env: LOAD_API, LOAD_ORIGIN, LOAD_EMAIL, LOAD_PASSWORD, LOAD_PROPERTY (default MNL),
// LOAD_VUS (concurrent users, default 40), LOAD_SECONDS (default 60), LOAD_SESSIONS
// (sign-ins shared by the users, default 3), LOAD_OUT (JSON report path).
import { writeFileSync } from 'node:fs';
import { credentials, idem, isoDate, Staff } from './client.mjs';

const PROPERTY = process.env.LOAD_PROPERTY ?? 'MNL';
const VUS = Number(process.env.LOAD_VUS ?? 40);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60);
const SESSIONS = Number(process.env.LOAD_SESSIONS ?? 3);

const { email, password } = credentials();
const sessions = [];
for (let i = 0; i < SESSIONS; i++) sessions.push(await Staff.signIn(email, password));
const staff = sessions[0];

const properties = await staff.get('/api/v1/properties');
const property = (properties.body.items ?? properties.body).find((p) => p.code === PROPERTY);
const base = `/api/v1/properties/${property.id}`;
const board = (await staff.get(`${base}/front-desk`)).body;
const today = new Date(`${board.businessDate}T00:00:00Z`);
const day = (n) => isoDate(n, today);

// Ids to read, taken from the data set.
const typeList = (await staff.get(`${base}/room-types`)).body;
const types = typeList.items ?? typeList;
const plans = (await staff.get(`${base}/rate-plans`)).body;
const ratePlan = (plans.items ?? plans).find((r) => r.code === 'BAR') ?? (plans.items ?? plans)[0];
const reservationIds = [];
let cursor = '';
for (let page = 0; page < 10; page++) {
  const res = await staff.get(`${base}/reservations?limit=100${cursor ? `&cursor=${cursor}` : ''}`);
  reservationIds.push(...res.body.items.map((r) => r.id));
  if (!res.body.nextCursor) break;
  cursor = encodeURIComponent(res.body.nextCursor);
}
const inHouse = board.inHouse ?? [];
const folioIds = inHouse.map((i) => i.folioId).filter(Boolean);
console.log(
  `Data: ${reservationIds.length} reservations sampled, ${inHouse.length} in house, ${folioIds.length} folios`,
);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const names = ['reyes', 'santos', 'cruz', 'garcia', 'lim', 'tan', 'ana', 'jose'];
const offset = () => Math.floor(Math.random() * 300);

/** [name, weight, request] — request returns { status, ms }. */
const SCENARIOS = [
  ['front desk board', 15, (s) => s.get(`${base}/front-desk`)],
  ['reservations list', 10, (s) => s.get(`${base}/reservations?limit=50`)],
  ['reservations search', 8, (s) => s.get(`${base}/reservations?q=${pick(names)}&limit=50`)],
  [
    'reservations by arrival',
    5,
    (s) => {
      const d = offset();
      return s.get(`${base}/reservations?arrivalFrom=${day(d)}&arrivalTo=${day(d + 7)}&limit=100`);
    },
  ],
  ['reservation detail', 8, (s) => s.get(`${base}/reservations/${pick(reservationIds)}`)],
  ['availability 30d', 8, (s) => s.get(`${base}/availability?from=${day(0)}&to=${day(30)}`)],
  [
    'quote',
    5,
    (s) => {
      const d = offset();
      return s.get(
        `${base}/quote?roomTypeId=${pick(types).id}&ratePlanId=${ratePlan.id}&arrivalDate=${day(d)}&departureDate=${day(d + 3)}`,
      );
    },
  ],
  ['calendar 14d', 5, (s) => s.get(`${base}/calendar?from=${day(0)}&to=${day(14)}`)],
  ['guest search', 8, (s) => s.get(`/api/v1/guests?q=${pick(names)}&limit=20`)],
  ['global search', 5, (s) => s.get(`/api/v1/search?q=${pick(names)}`)],
  ['property dashboard', 5, (s) => s.get(`${base}/dashboard`)],
  ['group dashboard', 3, (s) => s.get('/api/v1/dashboard')],
  ['folio', 6, (s) => (folioIds.length ? s.get(`${base}/folios/${pick(folioIds)}`) : null)],
  ['housekeeping board', 4, (s) => s.get(`${base}/housekeeping`)],
  ['daily report', 2, (s) => s.get(`${base}/reports/daily?date=${day(0)}`)],
  [
    'create reservation',
    3,
    (s) => {
      const d = 30 + offset();
      return s.post(
        `${base}/reservations`,
        {
          source: 'PHONE',
          booker: {
            newGuest: {
              firstName: 'Load',
              lastName: 'Test',
              email: `run.${crypto.randomUUID()}@load.test`,
            },
          },
          rooms: [
            {
              roomTypeId: pick(types).id,
              ratePlanId: ratePlan.id,
              arrivalDate: day(d),
              departureDate: day(d + 2),
              adults: 1,
            },
          ],
        },
        idem(),
      );
    },
  ],
  [
    'post charge',
    2,
    (s) =>
      folioIds.length
        ? s.post(
            `${base}/folios/${pick(folioIds)}/charges`,
            { department: 'FNB', description: 'load', amountMinor: 10_000 },
            idem(),
          )
        : null,
  ],
];
const totalWeight = SCENARIOS.reduce((sum, s) => sum + s[1], 0);
const choose = () => {
  let r = Math.random() * totalWeight;
  for (const s of SCENARIOS) if ((r -= s[1]) < 0) return s;
  return SCENARIOS[0];
};

const results = new Map(SCENARIOS.map(([name]) => [name, { ms: [], errors: 0, statuses: {} }]));
const deadline = Date.now() + SECONDS * 1000;
const started = Date.now();
await Promise.all(
  Array.from({ length: VUS }, async (_, vu) => {
    const s = sessions[vu % sessions.length];
    while (Date.now() < deadline) {
      const [name, , request] = choose();
      const pending = request(s);
      if (!pending) continue;
      const res = await pending;
      const r = results.get(name);
      r.ms.push(res.ms);
      r.statuses[res.status] = (r.statuses[res.status] ?? 0) + 1;
      // 409 on a write is a business answer (no availability), not a failure.
      if (res.status >= 500 || (res.status >= 400 && res.status !== 409)) r.errors++;
    }
  }),
);
const elapsed = (Date.now() - started) / 1000;

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const rows = [...results].map(([name, r]) => {
  const sorted = [...r.ms].sort((a, b) => a - b);
  return {
    name,
    n: sorted.length,
    errors: r.errors,
    p50: Math.round(pct(sorted, 50)),
    p95: Math.round(pct(sorted, 95)),
    p99: Math.round(pct(sorted, 99)),
    max: Math.round(sorted.at(-1) ?? 0),
    statuses: r.statuses,
  };
});
const total = rows.reduce((sum, r) => sum + r.n, 0);
console.log(
  `\n${VUS} users, ${elapsed.toFixed(0)}s, ${total} requests, ${(total / elapsed).toFixed(1)} req/s\n`,
);
console.log(
  'endpoint'.padEnd(24),
  'n'.padStart(6),
  'err'.padStart(5),
  'p50'.padStart(6),
  'p95'.padStart(6),
  'p99'.padStart(6),
  'max'.padStart(6),
);
for (const r of rows.sort((a, b) => b.p95 - a.p95)) {
  console.log(
    r.name.padEnd(24),
    String(r.n).padStart(6),
    String(r.errors).padStart(5),
    String(r.p50).padStart(6),
    String(r.p95).padStart(6),
    String(r.p99).padStart(6),
    String(r.max).padStart(6),
    r.errors ? JSON.stringify(r.statuses) : '',
  );
}
if (process.env.LOAD_OUT) {
  writeFileSync(
    process.env.LOAD_OUT,
    JSON.stringify({ vus: VUS, seconds: elapsed, total, rows }, null, 2),
  );
}
