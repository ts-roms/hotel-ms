# Load test

Dependency-free Node scripts (Node 22+) that fill a database with a busy hotel through the
public API, then measure the busiest screens under concurrent staff use.

Use a database made for this, never a real one.

## 1. A database

```bash
docker exec -e PGPASSWORD=hotel_owner hotel-platform-postgres-1 psql -h localhost -U hotel_owner -d postgres -c "CREATE DATABASE hotel_load OWNER hotel_owner"
```

Apply the migrations with `DATABASE_OWNER_URL` pointed at `hotel_load`, then run the seed
(`packages/database/dist/seed/run.js`) with all three database URLs pointed at it.

## 2. The API

Start the API against `hotel_load`. Set `DB_SLOW_QUERY_MS=100` to log every statement
slower than 100 ms (SQL text only, never parameter values), and `LOG_LEVEL=warn` to keep
request logs out of the way.

## 3. Data

```bash
LOAD_PASSWORD=<demo seed password> node scripts/load/generate.mjs
```

This creates:

- 200 rooms at MNL;
- bookings for 365 days, filled toward 75% occupancy, with a new guest per booking;
- 120 check-ins today, each with three folio charges.

Settings: `LOAD_ROOMS`, `LOAD_DAYS`, `LOAD_OCCUPANCY`, `LOAD_IN_HOUSE`, `LOAD_CONCURRENCY`.

## 4. The run

```bash
LOAD_PASSWORD=<demo seed password> LOAD_VUS=40 LOAD_SECONDS=60 node scripts/load/run.mjs
```

Virtual staff users each hit a weighted mix of screens:

- front desk, reservations (list, search, by arrival, detail);
- availability, quote, calendar;
- guest search, global search;
- dashboards, audit log, folio, housekeeping, daily report;
- writes: new bookings and folio charges.

It prints the 50th, 95th and 99th percentile and the maximum response time per endpoint.
`LOAD_OUT=report.json` also writes the numbers to a file.

The API defaults to `http://localhost:48110`, with Origin `http://localhost:43110`. Change
them with `LOAD_API` and `LOAD_ORIGIN`.
