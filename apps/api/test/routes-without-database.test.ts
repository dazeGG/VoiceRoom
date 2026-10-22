// Every route exists whether or not the app has a database: an app on fakes
// answers a database-backed route with the database's failure, not a 404.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiRuntime } from '../src/app/api-runtime.ts';
import { userSession } from './fakes/index.ts';

test('a database-backed route on an app without a pool answers 503, not 404', async (t) => {
  const app = createApiRuntime({ env: { ...process.env } }).createApp({
    users: {
      async getSessionUser(token) {
        return token === 'member-token' ? userSession({ id: 'user-1' }) : null;
      }
    }
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/api/notifications/inbox/unread-count',
    headers: { cookie: 'vr_session=member-token' }
  });
  assert.equal(response.statusCode, 503, response.body);
  assert.deepEqual(response.json(), { ok: false, error: 'Internal server error', code: 'internal_error' });
});
