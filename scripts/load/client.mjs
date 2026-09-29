// Minimal staff API client for the load scripts: session cookie, CSRF token, Origin.
// No dependencies; Node 22+ (global fetch).

export const API = process.env.LOAD_API ?? 'http://localhost:48110';
export const ORIGIN = process.env.LOAD_ORIGIN ?? 'http://localhost:43110';

export class Staff {
  cookie = '';
  csrf = '';

  static async signIn(email, password) {
    const staff = new Staff();
    const res = await staff.call('POST', '/api/v1/auth/login', { email, password });
    if (res.status !== 200)
      throw new Error(`sign-in ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return staff;
  }

  async call(method, path, body, headers = {}) {
    const started = performance.now();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        accept: 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const ms = performance.now() - started;
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const c of setCookie) {
      const pair = c.split(';')[0];
      if (/^(__Host-)?hotel_sid=/.test(pair)) this.cookie = pair;
    }
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.csrfToken === 'string') {
      this.csrf = parsed.csrfToken;
    }
    return { status: res.status, body: parsed, ms };
  }

  get = (path) => this.call('GET', path);
  post = (path, body, headers) => this.call('POST', path, body, headers);
}

export const idem = () => ({ 'idempotency-key': `load-${crypto.randomUUID()}` });

/** Runs `task(i)` for i in [0, count) with at most `concurrency` in flight. */
export async function pool(count, concurrency, task, onProgress) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) {
      const i = next++;
      await task(i);
      done++;
      if (onProgress && done % 500 === 0) onProgress(done);
    }
  });
  await Promise.all(workers);
}

export function isoDate(daysFromToday, today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

export function credentials() {
  const email = process.env.LOAD_EMAIL ?? 'admin@abc.test';
  const password = process.env.LOAD_PASSWORD;
  if (!password) throw new Error('Set LOAD_PASSWORD (the demo seed password for a local run).');
  return { email, password };
}
