// Builds a busy-hotel data set through the public API, so every row is consistent with the
// domain rules (inventory, folios, audit, outbox). Additive and repeatable; run it against a
// database made for load testing, never a real one.
//
//   LOAD_PASSWORD=... node scripts/load/generate.mjs
//
// Env: LOAD_API, LOAD_ORIGIN, LOAD_EMAIL, LOAD_PASSWORD, LOAD_PROPERTY (code, default MNL),
// LOAD_ROOMS (total rooms, default 200), LOAD_DAYS (booking horizon, default 365),
// LOAD_OCCUPANCY (target, default 0.75), LOAD_IN_HOUSE (check-ins today, default 120),
// LOAD_CONCURRENCY (default 16).
import { credentials, idem, isoDate, pool, Staff } from './client.mjs';

const PROPERTY = process.env.LOAD_PROPERTY ?? 'MNL';
const ROOMS = Number(process.env.LOAD_ROOMS ?? 200);
const DAYS = Number(process.env.LOAD_DAYS ?? 365);
const OCCUPANCY = Number(process.env.LOAD_OCCUPANCY ?? 0.75);
const IN_HOUSE = Number(process.env.LOAD_IN_HOUSE ?? 120);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 16);

const FIRST = ['Ana', 'Ben', 'Carla', 'Dan', 'Elena', 'Felix', 'Gina', 'Hugo', 'Iris', 'Jose'];
const LAST = ['Reyes', 'Santos', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Lim', 'Tan', 'Go'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const { email, password } = credentials();
const staff = await Staff.signIn(email, password);
const properties = await staff.get('/api/v1/properties');
const property = (properties.body.items ?? properties.body).find((p) => p.code === PROPERTY);
if (!property) throw new Error(`No property ${PROPERTY}`);
const base = `/api/v1/properties/${property.id}`;

const board = await staff.get(`${base}/front-desk`);
const businessDate = board.body.businessDate;
const today = new Date(`${businessDate}T00:00:00Z`);
const day = (n) => isoDate(n, today);
console.log(`Property ${PROPERTY}, business date ${businessDate}`);

const roomTypes = (await staff.get(`${base}/room-types`)).body;
const ratePlans = (await staff.get(`${base}/rate-plans`)).body;
const ratePlan =
  (ratePlans.items ?? ratePlans).find((r) => r.code === 'BAR') ?? (ratePlans.items ?? ratePlans)[0];
const types = (roomTypes.items ?? roomTypes).filter((t) => !t.archivedAt);

// ---- Rooms --------------------------------------------------------------------------------
let rooms = (await staff.get(`${base}/rooms`)).body;
rooms = rooms.items ?? rooms;
const missing = Math.max(0, ROOMS - rooms.length);
await pool(missing, CONCURRENCY, async (i) => {
  const type = types[i % types.length];
  const number = `L${String(i + 1).padStart(4, '0')}`;
  const res = await staff.post(`${base}/rooms`, { number, roomTypeId: type.id });
  if (res.status !== 201 && res.status !== 409)
    throw new Error(`room ${number}: ${res.status} ${JSON.stringify(res.body)}`);
});
rooms = (await staff.get(`${base}/rooms`)).body;
rooms = rooms.items ?? rooms;
console.log(`Rooms: ${rooms.length} (${missing} created)`);

// ---- Bookings: fill each room type toward the target occupancy, night by night ------------
const capacity = new Map(
  types.map((t) => [t.id, rooms.filter((r) => r.roomTypeId === t.id).length]),
);
const occupied = new Map(types.map((t) => [t.id, new Array(DAYS + 6).fill(0)]));
const bookings = [];
for (let d = 0; d < DAYS; d++) {
  for (const type of types) {
    const nights = occupied.get(type.id);
    const want = Math.floor(capacity.get(type.id) * OCCUPANCY);
    while (nights[d] < want) {
      const length = 1 + Math.floor(Math.random() * 5);
      for (let n = d; n < d + length; n++) nights[n]++;
      bookings.push({ type, arrival: d, departure: d + length });
    }
  }
}
console.log(`Creating ${bookings.length} bookings over ${DAYS} days...`);
let created = 0;
let refused = 0;
const arrivalsToday = [];
const started = Date.now();
await pool(
  bookings.length,
  CONCURRENCY,
  async (i) => {
    const b = bookings[i];
    const first = pick(FIRST);
    const last = pick(LAST);
    const res = await staff.post(
      `${base}/reservations`,
      {
        source: pick(['DIRECT', 'PHONE', 'WEBSITE', 'CORPORATE']),
        booker: {
          newGuest: {
            firstName: first,
            lastName: last,
            email: `${first}.${last}.${i}.${Date.now().toString(36)}@load.test`.toLowerCase(),
          },
        },
        rooms: [
          {
            roomTypeId: b.type.id,
            ratePlanId: ratePlan.id,
            arrivalDate: day(b.arrival),
            departureDate: day(b.departure),
            adults: 1,
          },
        ],
      },
      idem(),
    );
    if (res.status === 201) {
      created++;
      if (b.arrival === 0) arrivalsToday.push(res.body);
    } else refused++;
  },
  (done) =>
    console.log(
      `  ${done}/${bookings.length} (${Math.round(done / ((Date.now() - started) / 1000))}/s)`,
    ),
);
console.log(`Bookings: ${created} created, ${refused} refused`);

// ---- Today: check guests in and post charges ----------------------------------------------
const free = new Map(types.map((t) => [t.id, rooms.filter((r) => r.roomTypeId === t.id)]));
let checkedIn = 0;
await pool(Math.min(IN_HOUSE, arrivalsToday.length), 4, async (i) => {
  const reservation = arrivalsToday[i];
  const line = reservation.rooms[0];
  const candidates = free.get(line.roomTypeId) ?? [];
  const lineUrl = `${base}/reservations/${reservation.id}/rooms/${line.id}`;
  while (candidates.length) {
    const room = candidates.shift();
    if ((await staff.call('PUT', `${lineUrl}/assignment`, { roomId: room.id })).status !== 200)
      continue;
    if ((await staff.post(`${lineUrl}/check-in`)).status !== 200) continue;
    checkedIn++;
    const folio = (await staff.get(`${lineUrl}/folio`)).body;
    for (const [department, amountMinor] of [
      ['FNB', 45_000],
      ['MINIBAR', 12_000],
      ['LAUNDRY', 30_000],
    ]) {
      await staff.post(
        `${base}/folios/${folio.id}/charges`,
        { department, description: `${department.toLowerCase()} charge`, amountMinor },
        idem(),
      );
    }
    return;
  }
});
console.log(`In house: ${checkedIn} checked in with charges`);
