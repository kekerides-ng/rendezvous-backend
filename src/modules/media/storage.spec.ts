import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../common/config';
import { MediaStorage } from './storage';

const storage = new MediaStorage({
  S3_ENDPOINT: 'http://localhost:9002',
  S3_BUCKET: 'rendezvous-media',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_SECRET_ACCESS_KEY: 'private-secret',
  S3_REGION: 'us-east-1',
} as Env);

describe('media storage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('scopes a short-lived upload URL to one object and one content type', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    const url = new URL(storage.sign('PUT', 'user-1/photo.png', 'image/png'));
    expect(url.pathname).toBe('/rendezvous-media/user-1/photo.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Credential')).toContain(
      'test-key/20261021/us-east-1/s3/aws4_request',
    );
    expect(url.href).not.toContain('private-secret');
    expect(storage.sign('PUT', 'user-1/photo.png', 'image/jpeg')).not.toBe(url.href);
  });

  it('checks object bytes rather than trusting the declared image MIME type', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(png))
        .mockResolvedValueOnce(new Response('<html>')),
    );
    expect(await storage.isImage('user-1/photo.png', 'image/png')).toBe(true);
    expect(await storage.isImage('user-1/photo.png', 'image/png')).toBe(false);
  });
});
