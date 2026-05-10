/**
 * helpers.ts — shared HTTP request utility for all NFR test files.
 */

import http from 'http';

export const BASE_URL = process.env.IAM_BASE_URL || 'http://localhost:3001';

export interface Resp {
  status:     number;
  body:       Record<string, unknown>;
  headers:    Record<string, string | string[] | undefined>;
  durationMs: number;
}

export function req(
  path: string,
  opts: { method?: string; body?: object; headers?: Record<string, string> } = {}
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, BASE_URL);
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port:     Number(url.port) || 3001,
      path:     url.pathname + url.search,
      method:   opts.method || 'GET',
      // Disable keep-alive so sockets are released immediately after each request
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': bodyStr ? Buffer.byteLength(bodyStr).toString() : '0',
        'Connection':     'close',
        ...(opts.headers || {}),
      },
    };

    const start   = Date.now();
    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end',  () => {
        // Destroy the socket immediately — fixes TCPWRAP open handle warnings
        res.destroy();
        resolve({
          status:     res.statusCode || 0,
          body:       (() => { try { return JSON.parse(data); } catch { return {}; } })(),
          headers:    res.headers as Record<string, string | string[] | undefined>,
          durationMs: Date.now() - start,
        });
      });
    });

    request.on('error', reject);
    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

export function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}

export async function concurrent(
  n: number,
  fn: () => Promise<Resp>
): Promise<{ durations: number[]; statuses: number[] }> {
  const settled = await Promise.allSettled(Array.from({ length: n }, fn));
  const durations: number[] = [];
  const statuses:  number[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      durations.push(r.value.durationMs);
      statuses.push(r.value.status);
    }
  }
  return { durations, statuses };
}
