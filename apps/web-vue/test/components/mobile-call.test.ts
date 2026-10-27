// The call on a phone: two people face to face with my picture-in-picture,
// a grid that fills the screen, focus with pinning, and controls that hide.

import { fireEvent, render, screen, within } from '@testing-library/vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { nextTick, shallowReactive } from 'vue';
import type { Participant } from '@/features/room/client/core/types';
import { defined, instanceOf } from '../helpers/assert';
import { participant } from '../fixtures/participant';

const platform = vi.hoisted(() => ({ platformClass: 'mobile' }));
const camera = vi.hoisted(() => ({ flipCamera: vi.fn(), toggleCamera: vi.fn() }));

vi.mock('@/platform/desktop-boundary', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDesktopBoundaryPolicy: () => ({ platformClass: platform.platformClass, desktopAllowed: false })
}));
vi.mock('@/features/room/client/services/camera-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...camera
}));

const { default: MobileCallStage } = await import('@/features/room/components/MobileCallStage.vue');
const { state } = await import('@/features/room/client/core/room-runtime.store');
const { useRoomUiStore } = await import('@/features/room/room-ui.store');
const { PORTRAIT_PHONE_QUERY } = await import('@/features/room/mobile-call-ui.store');
const { usePageStore } = await import('@/stores/page.store');

// The screen the layout asks about: upright and narrow unless a test turns it.
const portrait = { matches: true, listeners: new Set<(event: Event) => void>() };

function turnPhone(upright: boolean): void {
  portrait.matches = upright;
  for (const listener of portrait.listeners) listener(Object.assign(new Event('change'), { matches: upright }));
}

// A class instance, like a real MediaStream: Vue does not proxy a value whose type tag is not a plain object.
// Registered as the global MediaStream, so `new MediaStream()` builds one.
class FakeStream {
  get [Symbol.toStringTag](): string {
    return 'MediaStream';
  }
}

let pinia: Pinia;

function person(id: string, extra: Partial<Participant> = {}): Participant {
  return shallowReactive(
    participant({
      avatarColorKey: 'blue',
      id,
      joinedAt: Number(id.replace(/\D/g, '')) || 0,
      name: id,
      ...extra
    })
  );
}

function peer(id: string): Participant {
  return defined(state.peers.get(id), `peer ${id}`);
}

function enterRoom(peerCount: number, self: Partial<Participant> = {}): void {
  usePageStore().screen = 'room';
  state.joined = true;
  state.self = person('me', { isLocal: true, name: 'Кирилл', ...self });
  for (let index = 1; index <= peerCount; index += 1) state.peers.set(`p${index}`, person(`p${index}`));
}

// Renders the call and lets the page mark this device as a phone (it does so once mounted).
async function mount(): Promise<void> {
  render(MobileCallStage, { global: { plugins: [pinia] } });
  await nextTick();
}

function tile(id: string): HTMLElement {
  return instanceOf(document.querySelector(`.mobile-call-tile[data-peer-id="${id}"]`), HTMLElement, `tile ${id}`);
}

function variantOf(id: string): string | undefined {
  return [...tile(id).classList]
    .find((name) => /^mobile-call-tile--(grid|focus|strip|pip|bleed)$/.test(name))
    ?.split('--')[1];
}

// The tile is a picture with one button over it; that button takes the tap.
async function tap(id: string): Promise<void> {
  await fireEvent.click(defined(tile(id).querySelector('.mobile-call-tile__hit'), 'tile button'));
}

function call(): HTMLElement | null {
  const element = document.querySelector('.mobile-call');
  return element instanceof HTMLElement ? element : null;
}

function chrome(): 'visible' | 'hidden' {
  return call()?.classList.contains('mobile-call--chrome-hidden') ? 'hidden' : 'visible';
}

function pip(): HTMLElement {
  return instanceOf(document.querySelector('.mobile-call-pip'), HTMLElement, 'picture-in-picture');
}

function cornerOf(box: HTMLElement): string | undefined {
  return [...box.classList].find((name) => /^mobile-call-pip--(tl|tr|bl|br)$/.test(name))?.split('--')[1];
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  platform.platformClass = 'mobile';
  portrait.matches = true;
  portrait.listeners.clear();
  vi.stubGlobal('matchMedia', (media: string) => ({
    get matches() {
      return media === PORTRAIT_PHONE_QUERY && portrait.matches;
    },
    media,
    addEventListener: (_type: string, listener: (event: Event) => void) => portrait.listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: Event) => void) => portrait.listeners.delete(listener)
  }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('MediaStream', FakeStream);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  camera.flipCamera.mockReset();
  state.peers.clear();
  state.self = null;
  state.joined = false;
  state.viewedScreenPeerId = '';
  state.localCameraStream = null;
});

test('a desktop keeps its own room stage', async () => {
  platform.platformClass = 'desktop';
  enterRoom(1);
  await mount();
  expect(call()).toBeNull();
});

test('two people, a camera on: the other fills the screen and my own picture floats in a corner', async () => {
  enterRoom(1, { camera: true });
  await mount();
  expect(variantOf('p1')).toBe('bleed');
  expect(variantOf('me')).toBe('pip');
  expect(cornerOf(pip())).toBe('br');
  // No grid or focus to switch to with two people.
  expect(screen.queryByRole('button', { name: 'Фокус на говорящем' })).toBeNull();
});

test('two people with no camera sit in two 16:9 tiles; a camera turns it into a face-to-face call', async () => {
  enterRoom(1);
  await mount();
  expect(document.querySelector('.mobile-call-grid')?.classList.contains('mobile-call-grid--voice-only')).toBe(true);
  expect(variantOf('p1')).toBe('grid');
  expect(variantOf('me')).toBe('grid');
  expect(document.querySelector('.mobile-call-pip')).toBeNull();

  // Their camera, not a screen share, makes it a video call.
  peer('p1').screen = true;
  await vi.waitFor(() => expect(variantOf('p1')).toBe('grid'));
  peer('p1').camera = true;
  await vi.waitFor(() => expect(variantOf('p1')).toBe('bleed'));
  expect(variantOf('me')).toBe('pip');

  peer('p1').camera = false;
  await vi.waitFor(() => expect(variantOf('p1')).toBe('grid'));

  // My own camera does it too.
  defined(state.self, 'self').camera = true;
  await vi.waitFor(() => expect(variantOf('me')).toBe('pip'));
});

test('in a grid with a camera on the tiles fill the screen; with voices only they keep 16:9', async () => {
  enterRoom(3);
  await mount();
  expect(document.querySelector('.mobile-call-grid')?.classList.contains('mobile-call-grid--voice-only')).toBe(true);
  peer('p2').camera = true;
  await vi.waitFor(() =>
    expect(document.querySelector('.mobile-call-grid')?.classList.contains('mobile-call-grid--voice-only')).toBe(false)
  );
});

test('two people: my picture grows with the camera switch, then swaps me full screen; the other swaps back', async () => {
  const stream = new MediaStream();
  enterRoom(1, { camera: true, cameraStream: stream });
  state.localCameraStream = stream;
  await mount();

  await tap('me');
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(true);
  expect(variantOf('me')).toBe('pip');
  const flip = within(pip()).getByRole('button', { name: 'На основную камеру' });
  await fireEvent.click(flip);
  expect(camera.flipCamera).toHaveBeenCalledTimes(1);
  // Turning the camera does not swap anyone.
  expect(variantOf('me')).toBe('pip');

  await tap('me');
  expect(variantOf('me')).toBe('bleed');
  expect(variantOf('p1')).toBe('pip');
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(false);
  // Full screen myself, the camera switch stays at hand.
  expect(screen.getByRole('button', { name: 'На основную камеру' })).toBeTruthy();
  expect(cornerOf(pip())).toBe('br');

  await tap('p1');
  expect(variantOf('p1')).toBe('bleed');
  expect(variantOf('me')).toBe('pip');
});

// A camera reports its size only once frames arrive, and a phone camera can
// change it while it starts or turns.
async function sendFrames(video: HTMLVideoElement, width: number, height: number): Promise<void> {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  await fireEvent(video, new Event('resize'));
}

test('two people: my picture-in-picture takes the shape my camera sends, with nothing left over', async () => {
  const self = person('me', {
    isLocal: true,
    name: 'Кирилл',
    camera: true,
    cameraStream: new MediaStream()
  });
  enterRoom(1);
  state.self = self;
  await mount();
  const box = pip();
  // One picture only: no blurred copy to fill bars that are not there.
  const videos = box.querySelectorAll('video');
  expect(videos).toHaveLength(1);
  const video = defined(videos[0], 'videos[0]');

  await sendFrames(video, 1280, 720);
  expect(Number(box.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(16 / 9);
  // The box has the camera's shape, so the picture fills it outright.
  expect(video.style.objectFit).toBe('fill');
  // Safari on iPhone is made to lay the new size out again: a pixel wider, then back.
  expect(video.style.width).toBe('calc(100% + 1px)');
  await vi.waitFor(() => expect(video.style.width).toBe(''));
  await sendFrames(video, 720, 1080);
  expect(Number(box.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(2 / 3);

  // The shape stays when the picture grows to show the camera switch.
  await tap('me');
  expect(box.classList.contains('mobile-call-pip--expanded')).toBe(true);
  expect(Number(box.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(2 / 3);

  // Without my camera (theirs still on) my bubble is an upright phone frame again.
  peer('p1').camera = true;
  self.camera = false;
  self.cameraStream = null;
  await vi.waitFor(() => expect(Number(box.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(100 / 178));
});

test('two people: a tap beside my grown picture shrinks it back instead of hiding the controls', async () => {
  enterRoom(1, { camera: true });
  await mount();
  await tap('me');
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(true);

  await tap('p1');
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(false);
  expect(chrome()).toBe('visible');
  // Without a camera there is nothing to turn.
  await tap('me');
  expect(screen.queryByRole('button', { name: /^На (основную|фронтальную)/ })).toBeNull();
});

test('four people fill the screen in two rows with me last', async () => {
  enterRoom(3, { camera: true });
  await mount();
  const cells = [...document.querySelectorAll<HTMLElement>('.mobile-call-grid__cell')].map((cell) => [
    instanceOf(cell.querySelector('.mobile-call-tile'), HTMLElement, 'tile').dataset.peerId,
    cell.style.gridColumn
  ]);
  // Two rows of two: each tile spans half of the six columns.
  expect(cells).toEqual([
    ['p1', 'span 3'],
    ['p2', 'span 3'],
    ['p3', 'span 3'],
    ['me', 'span 3']
  ]);
  expect(document.querySelector<HTMLElement>('.mobile-call-grid__page')?.style.gridTemplateRows).toContain(
    'repeat(2, minmax(0, 1fr))'
  );
  expect(document.querySelector('.mobile-call-grid__dots')).toBeNull();
});

test('ten people page the grid, with dots to move between pages', async () => {
  enterRoom(9);
  await mount();
  expect(document.querySelectorAll('.mobile-call-grid__page')).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^Страница/ })).toHaveLength(2);
});

test('tapping my tile pins me in focus with the camera switch; unpinning follows the speaker again', async () => {
  const stream = new MediaStream();
  enterRoom(3, { camera: true, cameraStream: stream });
  peer('p2').speaking = true;
  await mount();

  await tap('me');
  expect(variantOf('me')).toBe('focus');
  expect(screen.getByRole('button', { name: 'На основную камеру' })).toBeTruthy();

  await fireEvent.click(screen.getByRole('button', { name: 'Открепить' }));
  expect(variantOf('p2')).toBe('focus');
  expect(variantOf('me')).toBe('strip');
  expect(screen.queryByRole('button', { name: 'Открепить' })).toBeNull();

  await tap('p3');
  expect(variantOf('p3')).toBe('focus');
  expect(screen.getByRole('button', { name: 'Открепить' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'На основную камеру' })).toBeNull();

  await fireEvent.click(screen.getByRole('button', { name: 'Сетка' }));
  expect(variantOf('p3')).toBe('grid');
});

test('the controls hide after five quiet seconds, stay while the chat is open, and the timer brings them back', async () => {
  vi.useFakeTimers();
  enterRoom(3);
  await mount();

  await fireEvent.pointerDown(defined(call(), 'call'));
  await vi.advanceTimersByTimeAsync(4_999);
  expect(chrome()).toBe('visible');
  await vi.advanceTimersByTimeAsync(1);
  await nextTick();
  expect(chrome()).toBe('hidden');

  await fireEvent.click(screen.getByRole('button', { name: 'Показать управление' }));
  expect(chrome()).toBe('visible');

  useRoomUiStore().chatOpen = true;
  await fireEvent.pointerDown(defined(call(), 'call'));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(chrome()).toBe('visible');

  // A tap on someone else's tile hides them at once.
  await tap('p1');
  expect(chrome()).toBe('hidden');
  useRoomUiStore().chatOpen = false;
});

test('opening someone’s screen hands the page back to the room stage', async () => {
  enterRoom(3);
  await mount();
  expect(call()).not.toBeNull();
  state.viewedScreenPeerId = 'p1';
  await vi.waitFor(() => expect(call()).toBeNull());
});

test('the room stage returns when the lobby or another screen takes the page', async () => {
  enterRoom(3);
  await mount();
  expect(call()).not.toBeNull();
  // The lobby writes 'start' to the one page screen when it hides its embedded room.
  usePageStore().screen = 'start';
  await vi.waitFor(() => expect(call()).toBeNull());
  usePageStore().screen = 'room';
  await vi.waitFor(() => expect(call()).not.toBeNull());
});

test('two people: dragging my picture drops it in the nearest corner and is not taken for a tap', async () => {
  enterRoom(1, { camera: true });
  await mount();
  const box = pip();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = this.classList.contains('mobile-call-pip')
      ? { left: 20, top: 30, width: 100, height: 178 }
      : { left: 0, top: 0, width: 390, height: 500 };
    return new DOMRect(rect.left, rect.top, rect.width, rect.height);
  });

  await fireEvent.pointerDown(tile('me'), { button: 0, clientX: 330, clientY: 400, pointerId: 1 });
  await fireEvent.pointerMove(tile('me'), { clientX: 60, clientY: 90, pointerId: 1 });
  expect(box.classList.contains('mobile-call-pip--dragging')).toBe(true);
  await fireEvent.pointerUp(tile('me'), { clientX: 60, clientY: 90, pointerId: 1 });
  await tap('me');

  expect(cornerOf(box)).toBe('tl');
  expect(box.classList.contains('mobile-call-pip--dragging')).toBe(false);
  expect(box.classList.contains('mobile-call-pip--expanded')).toBe(false);
  // The next plain tap counts again.
  await tap('me');
  expect(box.classList.contains('mobile-call-pip--expanded')).toBe(true);
});

test('a phone turned on its side, or a tablet, keeps the room stage', async () => {
  enterRoom(3);
  await mount();
  expect(call()).not.toBeNull();
  turnPhone(false);
  await vi.waitFor(() => expect(call()).toBeNull());
  turnPhone(true);
  await vi.waitFor(() => expect(call()).not.toBeNull());
});

test('two people: a swap or a grown picture is not carried over to whoever comes next', async () => {
  enterRoom(1, { camera: true });
  await mount();
  await tap('me');
  await tap('me');
  expect(variantOf('me')).toBe('bleed');

  // The other person leaves and someone new comes in: they fill the screen.
  state.peers.delete('p1');
  state.peers.set('p2', person('p2'));
  await vi.waitFor(() => expect(variantOf('p2')).toBe('bleed'));
  expect(variantOf('me')).toBe('pip');

  // My picture grown, a third person drops by and leaves: it comes back small.
  await tap('me');
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(true);
  state.peers.set('p3', person('p3'));
  await vi.waitFor(() => expect(document.querySelector('.mobile-call-pip')).toBeNull());
  state.peers.delete('p2');
  await vi.waitFor(() => expect(variantOf('p3')).toBe('bleed'));
  expect(pip().classList.contains('mobile-call-pip--expanded')).toBe(false);
});

test('the controls hide on their own once the call opens, and leave the tab order while hidden', async () => {
  vi.useFakeTimers();
  enterRoom(3);
  await mount();
  const dock = () => screen.queryByRole('group', { name: 'Управление звонком' });
  expect(dock()).not.toBeNull();
  const bubble = () => document.querySelector('.mobile-call__bubble');
  // jsdom has no inert property, so Vue writes the attribute (inert="false" when not inert).
  const inert = (element: Element | null) =>
    element instanceof HTMLElement &&
    (element.inert === true || /^(|true)$/.test(element.getAttribute('inert') ?? 'false'));
  expect(inert(bubble())).toBe(true);
  expect(inert(document.querySelector('.mobile-call__chrome'))).toBe(false);

  await vi.advanceTimersByTimeAsync(5_000);
  await nextTick();
  expect(chrome()).toBe('hidden');
  expect(inert(document.querySelector('.mobile-call__chrome'))).toBe(true);
  expect(inert(bubble())).toBe(false);
});

test('alone in the call, my camera can still be turned from my own tile', async () => {
  const stream = new MediaStream();
  enterRoom(0, { camera: true, cameraStream: stream });
  await mount();
  await fireEvent.click(screen.getByRole('button', { name: 'На основную камеру' }));
  expect(camera.flipCamera).toHaveBeenCalledTimes(1);
  // A tap on myself only shows or hides the controls: there is no one to focus between.
  await tap('me');
  expect(chrome()).toBe('hidden');
  expect(variantOf('me')).toBe('grid');
});

test('the room name shares the invite link through the phone', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { share });
  enterRoom(3);
  state.roomId = 'wedding';
  state.roomName = 'Свадьба';
  await mount();
  await fireEvent.click(screen.getByRole('button', { name: 'Пригласить в «Свадьба»' }));
  expect(share).toHaveBeenCalledWith({ title: 'Свадьба', url: `${location.origin}/r/wedding` });
});
