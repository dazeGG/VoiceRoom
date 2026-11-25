import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Badge } from '@voiceroom/ui-kit/components';

test('caps counts above 99 at 99+', async () => {
  const view = render(Badge, { props: { count: 99 } });
  expect(screen.getByText('99')).toBeTruthy();
  await view.rerender({ count: 100 });
  expect(screen.getByText('99+')).toBeTruthy();
  expect(screen.queryByText('100')).toBeNull();
});

test('a missed-call badge can expose the exact count without changing its visible cap', () => {
  render(Badge, { props: { tone: 'danger', count: 105, label: '105 пропущенных звонков' } });
  const badge = screen.getByRole('img', { name: '105 пропущенных звонков' });
  expect(badge.textContent).toBe('99+');
});

test('an unlabelled live dot is decorative', () => {
  const view = render(Badge, { props: { tone: 'online', variant: 'dot' } });
  expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  expect(screen.queryByRole('img')).toBeNull();
});
