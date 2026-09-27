import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Env } from '../config/env.js';

/**
 * Object storage for uploaded files (ADR-0019). Keys are opaque, built by us, never from
 * user input: `{organizationId}/employee-documents/{documentId}`.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string, sha256Hex: string): Promise<void>;
  /** Throws ObjectNotFound if the object is missing. */
  get(key: string): Promise<Readable>;
  /** Idempotent: deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class ObjectNotFound extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
  }
}

const KEY_RE = /^[0-9a-f-]{36}\/[a-z-]+\/[0-9a-f-]{36}$/;

function checkKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return key;
}

/** Development and tests: files under a local directory (no encryption at rest). */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolve(dir);
  }

  private path(key: string): string {
    return join(this.root, ...checkKey(key).split('/'));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // Write then rename, so a reader never sees a half-written file.
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, body, { flag: 'wx' });
    await rename(temp, path);
  }

  async get(key: string): Promise<Readable> {
    const path = this.path(key);
    try {
      await stat(path);
    } catch {
      throw new ObjectNotFound(key);
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** Cloud: S3, every object encrypted with the platform's KMS key (SSE-KMS). */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly kmsKeyId: string,
    region?: string,
  ) {
    this.client = new S3Client(region ? { region } : {});
  }

  async put(key: string, body: Buffer, contentType: string, sha256Hex: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: checkKey(key),
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: this.kmsKeyId,
        BucketKeyEnabled: true,
        // S3 verifies the upload against our hash.
        ChecksumSHA256: Buffer.from(sha256Hex, 'hex').toString('base64'),
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }),
      );
      if (!(result.Body instanceof Readable)) throw new ObjectNotFound(key);
      return result.Body;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') throw new ObjectNotFound(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
  }
}

export function createObjectStorage(env: Env): ObjectStorage {
  return env.STORAGE_DRIVER === 's3'
    ? new S3Storage(env.STORAGE_BUCKET!, env.STORAGE_KMS_KEY_ID!, env.AWS_REGION)
    : new LocalDiskStorage(env.STORAGE_LOCAL_DIR);
}
