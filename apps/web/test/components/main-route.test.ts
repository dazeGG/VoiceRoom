// `/` and `/r/:id` keep their page while the lobby moves the address between
// them (SvelteKit's shallow routing); a real navigation picks the page again.

import { cleanup, render, screen } from '@testing-library/vue';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h } from 'vue';
import { RouterView, createWebHistory, type Router } from 'vue-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { createAppRouter } from '../../src/router.ts';
import { prefetchRoom } from '../../src/features/room/prefetch.ts';
import { shallowPush, shallowReplace } from '../../src/shared/utils/shallow-routing.ts';

const mounts = vi.hoisted(() => ({ home: 0, room: 0 }));
const device = vi.hoisted(() => ({ roomClientAllowed: true }));

vi.mock('../../src/features/room/prefetch.ts', () => ({ prefetchRoom: vi.fn() }));
vi.mock('../../src/platform/desktop-boundary.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isRoomClientAllowed: () => device.roomClientAllowed
}));

vi.mock('../../src/features/home/HomeRoute.vue', async () => {
  const { defineComponent, h, onMounted } = await import('vue');
  return {
    default: defineComponent(() => {
      onMounted(() => (mounts.home += 1));
      return () => h('p', 'home page');
    })
  };
});

vi.mock('../../src/pages/RoomRoute.vue', async () => {
  const { defineComponent, h, onMounted } = await import('vue');
  return {
    default: defineComponent({
      props: { roomId: { type: String, required: true } },
      setup(props) {
        onMounted(() => (mounts.room += 1));
        return () => h('p', `room page ${props.roomId}`);
      }
    })
  };
});

beforeEach(() => {
  mounts.home = 0;
  mounts.room = 0;
  device.roomClientAllowed = true;
  vi.mocked(prefetchRoom).mockClear();
});

async function open(path: string): Promise<Router> {
  window.history.replaceState(null, '', path);
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createAppRouter(createWebHistory());
  await router.push(path);
  await router.isReady();
  render(
    defineComponent(() => () => h(RouterView)),
    { global: { plugins: [pinia, router] } }
  );
  return router;
}

function back(router: Router): Promise<void> {
  return new Promise((resolve) => {
    const stop = router.afterEach(() => {
      stop();
      resolve();
    });
    window.history.back();
  });
}

test('the lobby entering a room from / keeps the home page mounted, also on the back button', async () => {
  const router = await open('/');
  expect(screen.getByText('home page')).toBeTruthy();

  await shallowPush(router, '/r/abc');
  await shallowPush(router, '/r/xyz');
  expect(window.location.pathname).toBe('/r/xyz');
  await back(router);
  await back(router);
  expect(window.location.pathname).toBe('/');

  expect(screen.getByText('home page')).toBeTruthy();
  expect(mounts).toEqual({ home: 1, room: 0 });
});

test('a room page opened by its address keeps itself when the lobby gives the bare address back', async () => {
  const router = await open('/r/abc');
  expect(screen.getByText('room page abc')).toBeTruthy();

  await shallowReplace(router, '/');
  await shallowPush(router, '/r/xyz');

  expect(screen.getByText('room page abc')).toBeTruthy();
  expect(mounts).toEqual({ home: 0, room: 1 });
});

test('a real navigation between / and a room shows the page of the new address', async () => {
  const router = await open('/');
  await router.push('/r/abc');
  expect(await screen.findByText('room page abc')).toBeTruthy();

  await router.push('/');
  expect(await screen.findByText('home page')).toBeTruthy();
  expect(mounts).toEqual({ home: 2, room: 1 });
});

test('the landing fetches the room code once the page is idle, before any click', async () => {
  await open('/');
  expect(prefetchRoom).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(prefetchRoom).toHaveBeenCalledTimes(1));
});

test('a device that cannot open the room client never fetches its code', async () => {
  device.roomClientAllowed = false;
  await open('/');
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(prefetchRoom).not.toHaveBeenCalled();
});

test('leaving the page before it is idle drops the prefetch', async () => {
  await open('/');
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(prefetchRoom).not.toHaveBeenCalled();
});
