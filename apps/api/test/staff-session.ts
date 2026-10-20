// Signs a staff member in to the admin app the way a browser does: the main-site
// session is handed over for a one-time code, and the code becomes the admin
// app's own cookie. Admin endpoints answer only that cookie.

import { request } from './fakes/server-process.ts';

function cookieValue(setCookie: string[], name: string): string {
  const line = setCookie.find((value) => value.startsWith(`${name}=`)) ?? '';
  return line.split(';')[0] ?? '';
}

/** The admin-app Cookie header for the account signed in by `mainCookie`; empty when it is not staff. */
export async function staffCookie(socketPath: string, mainCookie: string): Promise<string> {
  const state = 'test-state';
  const handoff = await request(socketPath, {
    pathname: `/api/staff/handoff?state=${state}`,
    cookie: mainCookie
  });
  const location = handoff.headers.location ?? '';
  const code = new URL(location, 'http://admin.test').searchParams.get('code');
  if (!code) return '';
  const callback = await request(socketPath, {
    pathname: `/api/staff/callback?${new URLSearchParams({ code, state }).toString()}`,
    cookie: `vr_staff_state=${encodeURIComponent(`${state}|/`)}`
  });
  return cookieValue(callback.setCookie, 'vr_staff');
}
