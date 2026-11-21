import { render } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Kbd } from '@voice-room/ui/components';

test('each shortcut key gets its own kbd without plus separators', () => {
  const { container } = render(Kbd, { props: { keys: ['Ctrl', 'Shift', 'M'] } });
  const keys = container.querySelectorAll('kbd');
  expect(Array.from(keys, (key) => key.textContent)).toEqual(['Ctrl', 'Shift', 'M']);
  expect(container.textContent).not.toContain('+');
});

test('an empty shortcut renders no keyboard keys', () => {
  const { container } = render(Kbd, { props: { keys: [] } });
  expect(container.querySelectorAll('kbd')).toHaveLength(0);
});
