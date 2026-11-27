import { render, screen, within } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { SafetyCode } from '@voiceroom/ui-kit/components';

const items = [
  { emoji: '🦊', name: 'лиса' },
  { emoji: '🍉', name: 'арбуз' },
  { emoji: '🚀', name: 'ракета' },
  { emoji: '🐢', name: 'черепаха' }
];

test('the code is one named list that keeps the protocol order and reads as names', () => {
  render(SafetyCode, { props: { items, label: 'Код проверки звонка' } });
  const code = screen.getByRole('list', { name: 'Код проверки звонка' });
  const entries = within(code).getAllByRole('listitem');
  expect(entries.map((entry) => entry.textContent)).toEqual(['🦊лиса', '🍉арбуз', '🚀ракета', '🐢черепаха']);
  // Screen readers hear the names, not the emoji glyphs.
  for (const entry of entries) {
    const glyph = entry.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toMatch(/\p{Extended_Pictographic}/u);
  }
});
