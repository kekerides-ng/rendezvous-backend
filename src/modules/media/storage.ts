import { createHmac, createHash } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CONFIG, type Env } from '../../common/config';

/** Small S3 SigV4 client: avoids proxying private photos through the API. */
@Injectable()
export class MediaStorage {
  private readonly endpoint: URL;

  constructor(@Inject(CONFIG) private readonly env: Env) {
    this.endpoint = new URL(env.S3_ENDPOINT);
  }

  private key(date: string): Buffer {
    const h = (key: Buffer | string, value: string) =>
      createHmac('sha256', key).update(value).digest();
    return h(
      h(h(h(`AWS4${this.env.S3_SECRET_ACCESS_KEY}`, date), this.env.S3_REGION), 's3'),
      'aws4_request',
    );
  }

  private objectUrl(objectKey?: string): URL {
    const url = new URL(this.endpoint);
    const prefix = this.endpoint.pathname.replace(/\/$/, '');
    const path = [this.env.S3_BUCKET, ...(objectKey ? objectKey.split('/') : [])]
      .map((part) => encodeURIComponent(part))
      .join('/');
    url.pathname = `${prefix}/${path}`;
    return url;
  }

  sign(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    objectKey?: string,
    contentType?: string,
    ttl = 300,
  ): string {
    const url = this.objectUrl(objectKey);
    const now = new Date();
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = stamp.slice(0, 8);
    const scope = `${date}/${this.env.S3_REGION}/s3/aws4_request`;
    const headers = contentType ? 'content-type;host' : 'host';
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${this.env.S3_ACCESS_KEY_ID}/${scope}`,
      'X-Amz-Date': stamp,
      'X-Amz-Expires': String(ttl),
      'X-Amz-SignedHeaders': headers,
    });
    const canonicalQuery = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalHeaders = `${contentType ? `content-type:${contentType}\n` : ''}host:${url.host}\n`;
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      headers,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const digest = createHash('sha256').update(canonicalRequest).digest('hex');
    const signature = createHmac('sha256', this.key(date))
      .update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${digest}`)
      .digest('hex');
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }

  async ensureBucket(): Promise<void> {
    if (!['localhost', '127.0.0.1'].includes(this.endpoint.hostname)) return;
    const url = this.sign('HEAD');
    let response: Response;
    try {
      response = await fetch(url, { method: 'HEAD' });
    } catch {
      throw new ServiceUnavailableException('Photo storage is unavailable.');
    }
    if (response.ok) return;
    // Local MinIO starts empty. Production R2 buckets are provisioned in advance.
    if (response.status === 404) {
      let created: Response;
      try {
        created = await fetch(this.sign('PUT'), { method: 'PUT' });
      } catch {
        throw new ServiceUnavailableException('Photo storage is unavailable.');
      }
      if (created.ok || created.status === 409) return;
    }
    throw new ServiceUnavailableException('Photo storage bucket is unavailable.');
  }

  async head(objectKey: string): Promise<{ bytes: number; contentType: string } | null> {
    let response: Response;
    try {
      response = await fetch(this.sign('HEAD', objectKey), { method: 'HEAD' });
    } catch {
      throw new ServiceUnavailableException('Photo storage is unavailable.');
    }
    if (response.status === 404) return null;
    if (!response.ok)
      throw new ServiceUnavailableException('Could not inspect the uploaded photo.');
    return {
      bytes: Number(response.headers.get('content-length')),
      contentType: response.headers.get('content-type')?.split(';')[0] ?? '',
    };
  }

  async isImage(objectKey: string, contentType: string): Promise<boolean> {
    let response: Response;
    try {
      response = await fetch(this.sign('GET', objectKey), {
        headers: { Range: 'bytes=0-15' },
      });
    } catch {
      throw new ServiceUnavailableException('Photo storage is unavailable.');
    }
    if (!response.ok) throw new ServiceUnavailableException('Could not inspect the photo.');
    // The caller checks HEAD length (at most 8 MB) before this read. S3
    // normally honours the range, but a server ignoring it stays bounded.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const at = (index: number, value: number) => bytes[index] === value;
    if (contentType === 'image/jpeg') return at(0, 0xff) && at(1, 0xd8) && at(2, 0xff);
    if (contentType === 'image/png')
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) =>
        at(index, value),
      );
    if (contentType === 'image/webp')
      return (
        String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
      );
    return false;
  }

  async remove(objectKey: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.sign('DELETE', objectKey), { method: 'DELETE' });
    } catch {
      throw new ServiceUnavailableException('Photo storage is unavailable.');
    }
    if (!response.ok && response.status !== 404)
      throw new ServiceUnavailableException('Could not remove the photo from storage.');
  }
}
