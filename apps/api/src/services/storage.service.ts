import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env';

/**
 * Private file storage. Files live outside any public web directory and are only
 * streamed through authorised API endpoints. Swap this module for an S3-compatible
 * implementation (same interface) in production — see docs/DEPLOYMENT.md.
 */
export interface StorageDriver {
  put(buffer: Buffer): Promise<{ key: string }>;
  stream(key: string): NodeJS.ReadableStream;
  remove(key: string): Promise<void>;
}

const root = path.resolve(process.cwd(), env.STORAGE_DIR);

function resolveKey(key: string) {
  if (!/^[a-f0-9]{2}\/[a-f0-9]{48}$/.test(key)) throw new Error('Invalid storage key');
  return path.join(root, key);
}

export const localStorageDriver: StorageDriver = {
  async put(buffer) {
    const id = crypto.randomBytes(24).toString('hex');
    const key = `${id.slice(0, 2)}/${id}`;
    const file = resolveKey(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(file, buffer, { mode: 0o600 });
    return { key };
  },
  stream(key) {
    return fs.createReadStream(resolveKey(key));
  },
  async remove(key) {
    await fs.promises.rm(resolveKey(key), { force: true });
  },
};

export const storage: StorageDriver = localStorageDriver;
