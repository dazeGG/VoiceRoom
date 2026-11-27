import { render, screen } from '@testing-library/vue';
import { expect, test } from 'vitest';
import { ParticipantTileFace } from '@voiceroom/ui-kit/components';

test('the current participant is identified in the accessible heading only', async () => {
  const view = render(ParticipantTileFace, { props: { name: 'Анна', initials: 'А', local: true } });

  expect(screen.getByRole('heading', { name: /^Анна\s*\(вы\)/ })).toBeTruthy();
  expect(getComputedStyle(screen.getByText('(вы)')).clipPath).toBe('inset(50%)');

  await view.rerender({ local: false });
  expect(screen.getByRole('heading', { name: /^Анна/ })).toBeTruthy();
  expect(screen.queryByText('(вы)')).toBeNull();
});
