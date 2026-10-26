// Packet loss is counted over the last few stats polls and only once enough
// packets went by: while someone is silent Opus sends a couple of packets a
// second, so one lost packet in a single poll must not read as 12 % loss.

import { expect, test } from 'vitest';
import {
  LOSS_MIN_PACKETS,
  LOSS_WINDOW_POLLS,
  createLossWindow
} from '../../src/lib/features/room/client/room/loss-window.ts';

test('one lost packet in a silent poll says nothing, not 12 %', () => {
  const loss = createLossWindow();
  expect(loss.add(1, 8)).toBeNull();
  expect(loss.add(0, 8)).toBeNull();
});

test('over speech the loss is counted across the window, in percent', () => {
  const loss = createLossWindow();
  // 150 packets a poll of speech, 3 of them lost once: 3 of 300 is 1 %.
  expect(loss.add(0, 150)).toBe(0);
  expect(loss.add(3, 150)).toBe(1);
  // A silent poll with its lost packet barely moves the figure.
  expect(loss.add(1, 8)).toBe(1.3);
});

test('old polls leave the window, so a burst of loss fades and a real one shows', () => {
  const loss = createLossWindow();
  expect(LOSS_WINDOW_POLLS).toBeGreaterThan(1);
  expect(LOSS_MIN_PACKETS).toBeGreaterThan(8);
  loss.add(30, 150); // a real burst: 20 % of one poll
  for (let poll = 1; poll < LOSS_WINDOW_POLLS; poll += 1) loss.add(0, 150);
  expect(loss.add(0, 150)).toBe(0);

  loss.reset();
  for (let poll = 0; poll < LOSS_WINDOW_POLLS; poll += 1) loss.add(15, 150);
  expect(loss.add(15, 150)).toBe(10);
});

test('counters that went backwards or more loss than packets never give a figure out of range', () => {
  const loss = createLossWindow();
  expect(loss.add(-5, 100)).toBe(0);
  expect(loss.add(500, 100)).toBe(100);
});
