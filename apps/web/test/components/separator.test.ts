import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { Separator } from '@voice-room/ui/components';

test('a semantic separator exposes its orientation and label', () => {
  render(Separator, { props: { orientation: 'vertical' }, attrs: { 'aria-label': 'Раздел действий' } });
  expect(screen.getByRole('separator', { name: 'Раздел действий' }).getAttribute('aria-orientation')).toBe('vertical');
});

test('a decorative separator has no separator role', () => {
  render(Separator, { props: { decorative: true } });
  expect(screen.queryByRole('separator')).toBeNull();
});
