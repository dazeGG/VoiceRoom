// The call on a phone: two people face to face with my picture-in-picture,
// a grid that fills the screen, focus with pinning, and controls that hide.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Participant } from '../../src/lib/features/room/client/core/types';

const platform = vi.hoisted(() => ({ platformClass: 'mobile' }));
const camera = vi.hoisted(() => ({ flipCamera: vi.fn(), toggleCamera: vi.fn() }));

vi.mock('../../src/lib/platform/desktop-boundary', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDesktopBoundaryPolicy: () => ({ platformClass: platform.platformClass, desktopAllowed: false })
}));
vi.mock('../../src/lib/features/room/client/services/camera-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...camera
}));

const { default: MobileCallStage } = await import('../../src/lib/features/room/components/MobileCallStage.svelte');
const { state, reactiveParticipant } = await import('../../src/lib/features/room/client/core/state.svelte');
const { roomUi } = await import('../../src/lib/features/room/room-ui.svelte');
const { PORTRAIT_PHONE_QUERY } = await import('../../src/lib/features/room/mobile-call-ui.svelte');

// The screen the layout asks about: upright and narrow unless a test turns it.
const portrait = { matches: true, listeners: new Set<(event: Event) => void>() };

function turnPhone(upright: boolean): void {
  portrait.matches = upright;
  for (const listener of portrait.listeners) listener(new Event('change'));
}

// A class instance, like a real MediaStream: $state does not proxy it.
class FakeStream {}

function person(id: string, extra: Partial<Participant> = {}): Participant {
  return reactiveParticipant({
    accountUserId: '',
    avatarAccent: '',
    avatarColorKey: 'blue',
    avatarUrl: '',
    camera: false,
    cameraStream: null,
    deafened: false,
    id,
    isLocal: false,
    joinedAt: Number(id.replace(/\D/g, '')) || 0,
    muted: false,
    name: id,
    screen: false,
    speaking: false,
    statusLabel: '',
    ...extra
  } as Participant);
}

function enterRoom(peerCount: number, self: Partial<Participant> = {}): void {
  state.screen = 'room';
  state.joined = true;
  state.self = person('me', { isLocal: true, name: 'Кирилл', ...self });
  for (let index = 1; index <= peerCount; index += 1) state.peers.set(`p${index}`, person(`p${index}`));
}

function tile(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.mc-tile[data-peer-id="${id}"]`)!;
}

// The tile is a picture with one button over it; that button takes the tap.
async function tap(id: string): Promise<void> {
  await fireEvent.click(tile(id).querySelector('.mc-tile-hit')!);
}

function call(): HTMLElement {
  return document.querySelector<HTMLElement>('.mobile-call')!;
}

beforeEach(() => {
  platform.platformClass = 'mobile';
  portrait.matches = true;
  vi.stubGlobal('matchMedia', (media: string) => ({
    get matches() {
      return media === PORTRAIT_PHONE_QUERY && portrait.matches;
    },
    media,
    addEventListener: (_type: string, listener: (event: Event) => void) => portrait.listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: Event) => void) => portrait.listeners.delete(listener)
  }));
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  camera.flipCamera.mockReset();
  state.peers.clear();
  state.self = null;
  state.screen = '';
  state.joined = false;
  state.viewedScreenPeerId = '';
  state.localCameraStream = null;
  roomUi.chatOpen = false;
});

test('a desktop keeps its own room stage', () => {
  platform.platformClass = 'desktop';
  enterRoom(1);
  render(MobileCallStage);
  expect(call()).toBeNull();
});

test('two people: the other fills the screen and my own picture floats in a corner', () => {
  enterRoom(1);
  render(MobileCallStage);
  expect(tile('p1').dataset.variant).toBe('bleed');
  expect(tile('me').dataset.variant).toBe('pip');
  expect(document.querySelector('.mc-pip')?.getAttribute('data-corner')).toBe('br');
  // No grid or focus to switch to with two people.
  expect(screen.queryByRole('button', { name: 'Фокус на говорящем' })).toBeNull();
});

test('two people: my picture grows with the camera switch, then swaps me full screen; the other swaps back', async () => {
  const stream = new FakeStream() as MediaStream;
  enterRoom(1, { camera: true, cameraStream: stream });
  state.localCameraStream = stream;
  render(MobileCallStage);
  const pip = () => document.querySelector<HTMLElement>('.mc-pip')!;

  await tap('me');
  expect(pip().dataset.expanded).toBe('true');
  expect(tile('me').dataset.variant).toBe('pip');
  const flip = within(pip()).getByRole('button', { name: 'На основную камеру' });
  await fireEvent.click(flip);
  expect(camera.flipCamera).toHaveBeenCalledTimes(1);
  // Turning the camera does not swap anyone.
  expect(tile('me').dataset.variant).toBe('pip');

  await tap('me');
  expect(tile('me').dataset.variant).toBe('bleed');
  expect(tile('p1').dataset.variant).toBe('pip');
  expect(pip().dataset.expanded).toBeUndefined();
  // Full screen myself, the camera switch stays at hand.
  expect(screen.getByRole('button', { name: 'На основную камеру' })).toBeTruthy();
  expect(pip().dataset.corner).toBe('br');

  await tap('p1');
  expect(tile('p1').dataset.variant).toBe('bleed');
  expect(tile('me').dataset.variant).toBe('pip');
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
    cameraStream: new FakeStream() as MediaStream
  });
  enterRoom(1);
  state.self = self;
  render(MobileCallStage);
  const pip = document.querySelector<HTMLElement>('.mc-pip')!;
  // One picture only: no blurred copy to fill bars that are not there.
  const videos = pip.querySelectorAll('video');
  expect(videos).toHaveLength(1);

  await sendFrames(videos[0], 1280, 720);
  expect(Number(pip.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(16 / 9);
  await sendFrames(videos[0], 720, 1080);
  expect(Number(pip.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(2 / 3);

  // The shape stays when the picture grows to show the camera switch.
  await tap('me');
  expect(pip.dataset.expanded).toBe('true');
  expect(Number(pip.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(2 / 3);

  // Without a camera the bubble is an upright phone frame again.
  self.camera = false;
  self.cameraStream = null;
  await vi.waitFor(() => expect(Number(pip.style.getPropertyValue('--pip-ratio'))).toBeCloseTo(100 / 178));
});

test('two people: a tap beside my grown picture shrinks it back instead of hiding the controls', async () => {
  enterRoom(1);
  render(MobileCallStage);
  await tap('me');
  expect(document.querySelector('.mc-pip')?.getAttribute('data-expanded')).toBe('true');

  await tap('p1');
  expect(document.querySelector('.mc-pip')?.hasAttribute('data-expanded')).toBe(false);
  expect(call().dataset.chrome).toBe('visible');
  // Without a camera there is nothing to turn.
  await tap('me');
  expect(screen.queryByRole('button', { name: /^На (основную|фронтальную)/ })).toBeNull();
});

test('four people fill the screen in two rows with me last', () => {
  enterRoom(3);
  render(MobileCallStage);
  const cells = [...document.querySelectorAll<HTMLElement>('.mc-grid-cell')].map((cell) => [
    cell.querySelector<HTMLElement>('.mc-tile')!.dataset.peerId,
    cell.style.gridColumn
  ]);
  // Two rows of two: each tile spans half of the six columns.
  expect(cells).toEqual([
    ['p1', 'span 3'],
    ['p2', 'span 3'],
    ['p3', 'span 3'],
    ['me', 'span 3']
  ]);
  expect(document.querySelector('.mc-grid-page')?.getAttribute('style')).toContain('repeat(2, minmax(0, 1fr))');
  expect(document.querySelector('.mc-grid-dots')).toBeNull();
});

test('ten people page the grid, with dots to move between pages', () => {
  enterRoom(9);
  render(MobileCallStage);
  expect(document.querySelectorAll('.mc-grid-page')).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /^Страница/ })).toHaveLength(2);
});

test('tapping my tile pins me in focus with the camera switch; unpinning follows the speaker again', async () => {
  const stream = new FakeStream() as MediaStream;
  enterRoom(3, { camera: true, cameraStream: stream });
  state.peers.get('p2')!.speaking = true;
  render(MobileCallStage);

  await tap('me');
  expect(tile('me').dataset.variant).toBe('focus');
  expect(screen.getByRole('button', { name: 'На основную камеру' })).toBeTruthy();

  await fireEvent.click(screen.getByRole('button', { name: 'Открепить' }));
  expect(tile('p2').dataset.variant).toBe('focus');
  expect(tile('me').dataset.variant).toBe('strip');
  expect(screen.queryByRole('button', { name: 'Открепить' })).toBeNull();

  await tap('p3');
  expect(tile('p3').dataset.variant).toBe('focus');
  expect(screen.getByRole('button', { name: 'Открепить' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'На основную камеру' })).toBeNull();

  await fireEvent.click(screen.getByRole('button', { name: 'Сетка' }));
  expect(tile('p3').dataset.variant).toBe('grid');
});

test('the controls hide after five quiet seconds, stay while the chat is open, and the timer brings them back', async () => {
  vi.useFakeTimers();
  enterRoom(3);
  render(MobileCallStage);

  await fireEvent.pointerDown(call());
  await vi.advanceTimersByTimeAsync(4_999);
  expect(call().dataset.chrome).toBe('visible');
  await vi.advanceTimersByTimeAsync(1);
  expect(call().dataset.chrome).toBe('hidden');

  await fireEvent.click(screen.getByRole('button', { name: 'Показать управление' }));
  expect(call().dataset.chrome).toBe('visible');

  roomUi.chatOpen = true;
  await fireEvent.pointerDown(call());
  await vi.advanceTimersByTimeAsync(10_000);
  expect(call().dataset.chrome).toBe('visible');

  // A tap on someone else's tile hides them at once.
  await tap('p1');
  expect(call().dataset.chrome).toBe('hidden');
});

test('opening someone’s screen hands the page back to the room stage', async () => {
  enterRoom(3);
  render(MobileCallStage);
  expect(call()).not.toBeNull();
  state.viewedScreenPeerId = 'p1';
  await vi.waitFor(() => expect(call()).toBeNull());
});

test('two people: dragging my picture drops it in the nearest corner and is not taken for a tap', async () => {
  enterRoom(1);
  render(MobileCallStage);
  const pip = document.querySelector<HTMLElement>('.mc-pip')!;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = this.classList.contains('mc-pip')
      ? { left: 20, top: 30, width: 100, height: 178 }
      : { left: 0, top: 0, width: 390, height: 500 };
    return {
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height
    } as DOMRect;
  });

  await fireEvent.pointerDown(tile('me'), { button: 0, clientX: 330, clientY: 400, pointerId: 1 });
  await fireEvent.pointerMove(tile('me'), { clientX: 60, clientY: 90, pointerId: 1 });
  expect(pip.dataset.dragging).toBe('true');
  await fireEvent.pointerUp(tile('me'), { clientX: 60, clientY: 90, pointerId: 1 });
  await tap('me');

  expect(pip.dataset.corner).toBe('tl');
  expect(pip.dataset.dragging).toBeUndefined();
  expect(pip.dataset.expanded).toBeUndefined();
  // The next plain tap counts again.
  await tap('me');
  expect(pip.dataset.expanded).toBe('true');
});

test('a phone turned on its side, or a tablet, keeps the room stage', async () => {
  enterRoom(3);
  render(MobileCallStage);
  expect(call()).not.toBeNull();
  turnPhone(false);
  await vi.waitFor(() => expect(call()).toBeNull());
  turnPhone(true);
  await vi.waitFor(() => expect(call()).not.toBeNull());
});

test('two people: a swap or a grown picture is not carried over to whoever comes next', async () => {
  enterRoom(1);
  render(MobileCallStage);
  await tap('me');
  await tap('me');
  expect(tile('me').dataset.variant).toBe('bleed');

  // The other person leaves and someone new comes in: they fill the screen.
  state.peers.delete('p1');
  state.peers.set('p2', person('p2'));
  await vi.waitFor(() => expect(tile('p2').dataset.variant).toBe('bleed'));
  expect(tile('me').dataset.variant).toBe('pip');

  // My picture grown, a third person drops by and leaves: it comes back small.
  await tap('me');
  expect(document.querySelector('.mc-pip')?.getAttribute('data-expanded')).toBe('true');
  state.peers.set('p3', person('p3'));
  await vi.waitFor(() => expect(document.querySelector('.mc-pip')).toBeNull());
  state.peers.delete('p2');
  await vi.waitFor(() => expect(tile('p3').dataset.variant).toBe('bleed'));
  expect(document.querySelector('.mc-pip')?.hasAttribute('data-expanded')).toBe(false);
});

test('the controls hide on their own once the call opens, and leave the tab order while hidden', async () => {
  vi.useFakeTimers();
  enterRoom(3);
  render(MobileCallStage);
  const dock = () => screen.queryByRole('group', { name: 'Управление звонком' });
  expect(dock()).not.toBeNull();
  const bubble = () => document.querySelector('.mc-bubble')!;
  // jsdom has no inert, so Svelte leaves it as the element's property.
  const inert = (element: Element | null) => Boolean((element as (HTMLElement & { inert?: boolean }) | null)?.inert);
  expect(inert(bubble())).toBe(true);
  expect(inert(document.querySelector('.mc-chrome'))).toBe(false);

  await vi.advanceTimersByTimeAsync(5_000);
  expect(call().dataset.chrome).toBe('hidden');
  expect(inert(document.querySelector('.mc-chrome'))).toBe(true);
  expect(inert(bubble())).toBe(false);
});

test('alone in the call, my camera can still be turned from my own tile', async () => {
  const stream = new FakeStream() as MediaStream;
  enterRoom(0, { camera: true, cameraStream: stream });
  render(MobileCallStage);
  await fireEvent.click(screen.getByRole('button', { name: 'На основную камеру' }));
  expect(camera.flipCamera).toHaveBeenCalledTimes(1);
  // A tap on myself only shows or hides the controls: there is no one to focus between.
  await tap('me');
  expect(call().dataset.chrome).toBe('hidden');
  expect(tile('me').dataset.variant).toBe('grid');
});

test('the room name shares the invite link through the phone', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, share });
  enterRoom(3);
  state.roomId = 'wedding';
  state.roomName = 'Свадьба';
  render(MobileCallStage);
  await fireEvent.click(screen.getByRole('button', { name: 'Пригласить в «Свадьба»' }));
  expect(share).toHaveBeenCalledWith({ title: 'Свадьба', url: `${location.origin}/r/wedding` });
});
