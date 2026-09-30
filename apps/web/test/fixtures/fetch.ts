// A fake `fetch` that answers from a route table, for tests of the real API
// clients in src/lib/api.

import { vi } from 'vitest';

export type Reply =
  { status?: number; body?: unknown } | ((init: RequestInit | undefined) => { status?: number; body?: unknown });

export function stubFetch(routes: Record<string, Reply>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body });
    const route = routes[`${method} ${url}`] ?? routes[url];
    if (!route)
      return new Response(JSON.stringify({ ok: false, error: `no stub for ${method} ${url}` }), { status: 500 });
    const reply = typeof route === 'function' ? route(init) : route;
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}
