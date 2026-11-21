import { render } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Skeleton } from '@voice-room/ui/components';

test('a skeleton uses the supplied content dimensions and stays decorative', () => {
  const { container } = render(Skeleton, {
    props: { width: '60%', height: 'var(--size-20)', radius: 'var(--radius-4)' }
  });
  const skeleton = container.firstElementChild;
  if (!(skeleton instanceof HTMLElement)) throw new Error('skeleton did not render an element');
  expect(skeleton.style.width).toBe('60%');
  expect(skeleton.style.height).toBe('var(--size-20)');
  expect(skeleton.style.borderRadius).toBe('var(--radius-4)');
  expect(skeleton.getAttribute('aria-hidden')).toBe('true');
});

test('the circle variant overrides the rectangular radius', () => {
  const { container } = render(Skeleton, {
    props: { width: 'var(--size-40)', height: 'var(--size-40)', circle: true, radius: 'var(--radius-4)' }
  });
  const skeleton = container.firstElementChild;
  if (!(skeleton instanceof HTMLElement)) throw new Error('skeleton did not render an element');
  expect(skeleton.classList.contains('ui-skeleton--circle')).toBe(true);
  expect(skeleton.style.borderRadius).toBe('');
  expect(skeleton.getAttribute('aria-hidden')).toBe('true');
});
