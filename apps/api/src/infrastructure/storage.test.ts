import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage, ObjectNotFound } from './storage.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('stores, reads and deletes by opaque key, leaving no temp files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storage-'));
    dirs.push(dir);
    const storage = new LocalDiskStorage(dir);
    const org = randomUUID();
    const key = `${org}/employee-documents/${randomUUID()}`;
    await storage.put(key, Buffer.from('hello'));
    expect(await text(await storage.get(key))).toBe('hello');
    expect(await readdir(join(dir, org, 'employee-documents'))).toHaveLength(1);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(ObjectNotFound);
    await storage.delete(key); // idempotent
  });

  it('refuses keys that could escape its directory', async () => {
    const storage = new LocalDiskStorage(tmpdir());
    for (const key of ['../x', `${randomUUID()}/../../etc/passwd`, 'a/b/c', '']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow('Invalid storage key');
    }
  });
});
