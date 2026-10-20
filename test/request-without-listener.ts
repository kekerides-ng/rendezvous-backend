import { IncomingMessage, type Server, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

/** Exercise Node/Express routing, middleware and JSON bodies without a TCP listener. */
export function inject(
  server: Server,
  input: {
    path: string;
    method?: string;
    cookie?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const socket = new Socket();
  const request = new IncomingMessage(socket);
  const body = input.body === undefined ? '' : JSON.stringify(input.body);
  request.method = input.method ?? 'GET';
  request.url = input.path;
  request.httpVersion = '1.1';
  request.httpVersionMajor = 1;
  request.httpVersionMinor = 1;
  request.headers = {
    host: 'localhost',
    connection: 'close',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(body)),
    ...(input.cookie ? { cookie: input.cookie } : {}),
    ...input.headers,
  };
  const response = new ServerResponse(request);
  return new Promise<{
    status: number;
    body: unknown;
    headers: ReturnType<ServerResponse['getHeaders']>;
  }>((resolve, reject) => {
    // The JSON endpoints call end(body). Capture it before Node writes to a socket.
    Object.defineProperty(response, 'end', {
      value: (chunk?: string | Uint8Array) => {
        try {
          const content =
            chunk === undefined
              ? ''
              : typeof chunk === 'string'
                ? chunk
                : Buffer.from(chunk).toString();
          resolve({
            status: response.statusCode,
            body: content ? (JSON.parse(content) as unknown) : undefined,
            headers: response.getHeaders(),
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Invalid HTTP response.'));
        }
        response.emit('finish');
        socket.destroy();
        return response;
      },
    });
    server.emit('request', request, response);
    request.push(body || null);
    if (body) request.push(null);
  });
}
