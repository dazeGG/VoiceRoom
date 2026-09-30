import { beforeEach, expect, test } from 'vitest';
import { stubFetch } from '../fixtures/fetch.ts';
import { authUser } from '../fixtures/users.ts';
import { freshImport } from '../helpers/fresh-module.ts';
import type * as SessionModule from '../../src/lib/features/auth/session.svelte.ts';

const loadSessionModule = () => freshImport<typeof SessionModule>('/src/lib/features/auth/session.svelte.ts');

beforeEach(() => localStorage.clear());

test('the first load asks the server once, even for concurrent callers', async () => {
  const { calls } = stubFetch({ '/api/auth/me': { body: { user: authUser() } } });
  const { loadSession, session } = await loadSessionModule();

  const [first, second] = await Promise.all([loadSession(), loadSession()]);

  expect(calls).toHaveLength(1);
  expect(first?.login).toBe('anya');
  expect(second).toBe(first);
  expect(session).toMatchObject({ loaded: true, user: { login: 'anya' } });
  // Loaded state answers later calls without another request.
  await loadSession();
  expect(calls).toHaveLength(1);
});

test('a signed-in account fills the voice room name; there is no local session hint', async () => {
  stubFetch({ '/api/auth/me': { body: { user: authUser({ displayName: '  ', login: 'boris' }) } } });
  const { loadSession } = await loadSessionModule();

  await loadSession();

  expect(localStorage.getItem('voice-room:name')).toBe('boris');
  expect(Object.keys(localStorage)).toEqual(['voice-room:name']);
});

test('a failed session check is reported, not shown as a signed-out visitor', async () => {
  stubFetch({ '/api/auth/me': { status: 502 } });
  const { loadSession, session } = await loadSessionModule();

  await expect(loadSession()).rejects.toThrow('Не удалось проверить сессию');
  expect(session.loaded).toBe(true);
  expect(session.user).toBeNull();
});

test('a forced reload asks again and signing out forgets the room name', async () => {
  const { calls } = stubFetch({ '/api/auth/me': { body: { user: authUser() } } });
  const { clearSession, loadSession, session } = await loadSessionModule();

  await loadSession();
  await loadSession(true);
  expect(calls).toHaveLength(2);

  clearSession();
  expect(session).toMatchObject({ loaded: true, user: null });
  expect(localStorage.getItem('voice-room:name')).toBeNull();
});
