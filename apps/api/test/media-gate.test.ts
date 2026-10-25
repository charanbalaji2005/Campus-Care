import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS, deepMerge, type PlatformSettings } from '@campuscare/shared';

let current: PlatformSettings = DEFAULT_SETTINGS;
vi.mock('../src/services/settings.service', () => ({ getSettings: async () => current }));
vi.mock('../src/services/storage.service', () => ({ storage: { put: async () => ({ key: 'aa/' + 'a'.repeat(48) }) } }));

// vi.mock calls are hoisted above these imports.
import { storeUpload } from '../src/services/files.service';
import { Evidence } from '../src/models/incident';

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.alloc(100)]);
const mp4 = Buffer.concat([Buffer.from('00000020', 'hex'), Buffer.from('ftypisom'), Buffer.alloc(100)]);
const file = (buffer: Buffer, name: string, mimetype: string) => ({ buffer, size: buffer.length, originalname: name, mimetype }) as Express.Multer.File;

describe('support chat image/video sending (Super Admin switch, off by default)', () => {
  beforeEach(() => {
    current = DEFAULT_SETTINGS;
    vi.spyOn(Evidence, 'create').mockImplementation(async (doc: unknown) => ({ _id: 'x', ...(doc as object) }) as never);
  });

  it('refuses images and videos by default', async () => {
    await expect(storeUpload(file(png, 'a.png', 'image/png'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).rejects.toMatchObject({ status: 403, code: 'media_disabled' });
    await expect(storeUpload(file(mp4, 'a.mp4', 'video/mp4'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).rejects.toMatchObject({ status: 403, code: 'media_disabled' });
  });

  it('allows images once enabled for support chats, while videos stay off', async () => {
    current = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: true } } } });
    await expect(storeUpload(file(png, 'a.png', 'image/png'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(storeUpload(file(mp4, 'a.mp4', 'video/mp4'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).rejects.toMatchObject({ code: 'media_disabled' });
  });

  it('allows videos when enabled, and keeps community chat separate', async () => {
    current = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: true, videos: true } } } });
    await expect(storeUpload(file(mp4, 'clip.mp4', 'video/mp4'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).resolves.toMatchObject({ mimeType: 'video/mp4' });
    await expect(storeUpload(file(png, 'a.png', 'image/png'), { purpose: 'chat', mediaScope: 'community', uploaderId: 'u' })).rejects.toMatchObject({ code: 'media_disabled' });
  });

  it('trusts file bytes, not the declared type', async () => {
    current = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { images: true } } } });
    const disguised = file(Buffer.from('MZ\x90\x00 executable payload here....'), 'cat.png', 'image/png');
    await expect(storeUpload(disguised, { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).rejects.toMatchObject({ status: 415 });
  });

  it('enforces the size limit set by the Super Admin', async () => {
    current = deepMerge(DEFAULT_SETTINGS, { chat: { media: { support: { videos: true } }, maxVideoMb: 1 } });
    const big = Buffer.concat([mp4, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(storeUpload(file(big, 'big.mp4', 'video/mp4'), { purpose: 'chat', mediaScope: 'support', uploaderId: 'u' })).rejects.toMatchObject({ code: 'media_disabled' });
  });
});
