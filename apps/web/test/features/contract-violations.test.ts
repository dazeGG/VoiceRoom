// An HTTP answer outside its contract is reported like a realtime frame, so
// the app looks for a newer version (realtime-client.test.ts covers frames and
// the once-a-minute limit).

import { expect, test, vi } from 'vitest';
import { Type } from 'typebox';
import { stubFetch } from '../fixtures/fetch.ts';
import { freshImport, muteWarnings } from '../helpers/fresh-module.ts';

const Counted = Type.Object({ ok: Type.Literal(true), n: Type.Number() });

test('an answer outside its contract asks for a version check', async () => {
  const { api } = await freshImport(() => import('../../src/api/client.ts'));
  const { onContractViolation } = await import('../../src/api/contract-violations.ts');
  muteWarnings();
  const violated = vi.fn();
  onContractViolation(violated);
  stubFetch({ 'GET /api/count': { body: { ok: true, n: 'one' } } });

  await expect(api.get('/api/count', Counted)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(violated).toHaveBeenCalledTimes(1);
});
