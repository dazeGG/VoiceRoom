import { expect, test } from 'vitest';
import { resolvePopoverPlacement } from '../src/lib/shared/ui/Popover/popover-placement.ts';

const VIEWPORT = 800;
const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() {} }) as DOMRect;

test('a panel that fits below stays below', () => {
  expect(resolvePopoverPlacement(rect(100, 40), rect(150, 200), 'bottom-start', VIEWPORT)).toBe('bottom-start');
});

test('a panel that would run off the bottom flips up when there is more room above', () => {
  const trigger = rect(700, 40);
  expect(resolvePopoverPlacement(trigger, rect(750, 300), 'bottom-end', VIEWPORT)).toBe('top-end');
});

test('a panel that fits nowhere keeps the side with more room', () => {
  const nearTop = rect(120, 40);
  expect(resolvePopoverPlacement(nearTop, rect(170, 700), 'bottom-start', VIEWPORT)).toBe('bottom-start');
});

test('a panel preferred above flips down only when it overflows the top and there is more room below', () => {
  expect(resolvePopoverPlacement(rect(500, 40), rect(290, 200), 'top-start', VIEWPORT)).toBe('top-start');
  expect(resolvePopoverPlacement(rect(60, 40), rect(-150, 200), 'top-start', VIEWPORT)).toBe('bottom-start');
});
