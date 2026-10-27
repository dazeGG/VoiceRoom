import { nextTick } from 'vue';
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

test('the screen is one class at a time on the body', async () => {
  const page = usePageStore();
  stop = installBodyClasses();
  await nextTick();
  expect(bodyClasses()).toEqual([]);

  page.screen = 'start';
  await nextTick();
  expect(bodyClasses()).toEqual(['screen--start']);

  page.screen = 'room';
  await nextTick();
  expect(bodyClasses()).toEqual(['screen--room']);

  page.screen = '';
  await nextTick();
  expect(bodyClasses()).toEqual([]);
});

test('each page flag toggles its own class and leaves unrelated body classes alone', async () => {
  document.body.classList.add('vr-keep');
  const page = usePageStore();
  stop = installBodyClasses();
  page.screen = 'room';
  page.chatOpen = true;
  page.lobbyEmbedded = true;
  page.screenView = true;
  page.stripCollapsed = true;
  page.stageSummary = 'hidden';
  await nextTick();
  expect(bodyClasses()).toEqual([
    'chat--open',
    'lobby--embedded',
    'screen--room',
    'screen-view--open',
    'stage-summary--hidden',
    'strip--collapsed',
    'vr-keep'
  ]);

  page.chatOpen = false;
  page.screenView = false;
  page.stageSummary = '';
  await nextTick();
  expect(bodyClasses()).toEqual(['lobby--embedded', 'screen--room', 'strip--collapsed', 'vr-keep']);
});

test('the classes follow the store from the moment they are installed, and stop when stopped', async () => {
  const page = usePageStore();
  page.screen = 'checking';
  page.screenView = true;
  stop = installBodyClasses();
  await nextTick();
  expect(bodyClasses()).toEqual(['screen--checking', 'screen-view--open']);

  stop();
  page.screen = 'room';
  await nextTick();
  expect(bodyClasses()).toEqual(['screen--checking', 'screen-view--open']);
});

test('nothing is written to body.dataset', async () => {
  const page = usePageStore();
  stop = installBodyClasses();
  page.screen = 'room';
  page.chatOpen = true;
  await nextTick();
  expect(Object.keys(document.body.dataset)).toEqual([]);
});
