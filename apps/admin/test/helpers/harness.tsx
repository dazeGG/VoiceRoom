// What the admin app's tests share: a fetch that answers from a route table and
// records every call, and rendering a section as a staff member of some role.

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ROLE_PERMISSIONS, type StaffRole } from '@voice-room/shared/contracts/staff';
import { StaffContext, type Staff } from '../../src/staff.tsx';

export type Reply = { status?: number; body: unknown };
export type Route = Reply | ((url: URL, body: unknown) => Reply | Promise<Reply>);

export interface Call {
  method: string;
  url: URL;
  body: unknown;
}

/** Answers "METHOD /path" (the query is not part of the key) and records every call. */
export function stubApi(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'http://admin.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      const route = routes[`${method} ${url.pathname}`];
      const reply: Reply = route
        ? typeof route === 'function'
          ? await route(url, body)
          : route
        : { status: 500, body: { ok: false, error: `no stub for ${method} ${url.pathname}`, code: 'internal_error' } };
      return new Response(JSON.stringify(reply.body), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json' }
      });
    })
  );
  return calls;
}

export function staffOf(role: StaffRole): Staff {
  return {
    user: {
      id: 'u-staff',
      login: 'staff',
      displayName: 'Сотрудник',
      avatarUrl: null,
      avatarColorKey: 'blue',
      avatarAccent: null
    },
    role,
    permissions: [...ROLE_PERMISSIONS[role]],
    siteUrl: 'https://site.test'
  };
}

/** Renders a section as a staff member with `role` (an admin unless said). */
export function renderAs(ui: ReactElement, role: StaffRole = 'admin') {
  return render(<StaffContext.Provider value={staffOf(role)}>{ui}</StaffContext.Provider>);
}
