import { afterEach, beforeEach, expect, test } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { installBodyClasses, usePageStore } from '@/stores/page.store';

let stop: (() => void) | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  document.body.className = '';
});

afterEach(() => {
  stop?.();
  stop = null;
  document.body.className = '';
});

const bodyClasses = () => [...document.body.classList].sort();

test('the screen is one class at a time on the body', () => {
  const page = usePageStore();
  stop = installBodyClasses();
  expect(bodyClasses()).toEqual([]);

  page.screen = 'start';
  expect(bodyClasses()).toEqual(['screen--start']);

  page.screen = 'room';
  expect(bodyClasses()).toEqual(['screen--room']);

  page.screen = '';
  expect(bodyClasses()).toEqual([]);
});

test('each page flag toggles its own class and leaves unrelated body classes alone', () => {
  document.body.classList.add('vr-keep');
  const page = usePageStore();
  stop = installBodyClasses();
  page.screen = 'room';
  page.chatOpen = true;
  page.lobbyEmbedded = true;
  page.screenView = true;
  page.stripCollapsed = true;
  page.stageSummary = 'hidden';
  page.desktopScreenFullscreen = true;
  expect(bodyClasses()).toEqual([
    'chat--open',
    'lobby--embedded',
    'screen--desktop-fullscreen',
    'screen--room',
    'screen-view--open',
    'stage-summary--hidden',
    'strip--collapsed',
    'vr-keep'
  ]);

  page.chatOpen = false;
  page.screenView = false;
  page.stageSummary = '';
  page.desktopScreenFullscreen = false;
  expect(bodyClasses()).toEqual(['lobby--embedded', 'screen--room', 'strip--collapsed', 'vr-keep']);

  page.desktopScreenFullscreen = true;
  page.screen = 'start';
  expect(bodyClasses()).toContain('screen--desktop-fullscreen');
  expect(bodyClasses()).toContain('screen--start');
  expect(bodyClasses()).not.toContain('screen--room');
});

test('the classes follow the store from the moment they are installed, and stop when stopped', () => {
  const page = usePageStore();
  page.screen = 'checking';
  page.screenView = true;
  stop = installBodyClasses();
  expect(bodyClasses()).toEqual(['screen--checking', 'screen-view--open']);

  stop();
  page.screen = 'room';
  expect(bodyClasses()).toEqual(['screen--checking', 'screen-view--open']);
});

test('nothing is written to body.dataset', () => {
  const page = usePageStore();
  stop = installBodyClasses();
  page.screen = 'room';
  page.chatOpen = true;
  expect(Object.keys(document.body.dataset)).toEqual([]);
});
