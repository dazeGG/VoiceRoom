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
