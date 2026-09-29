// Reactions are drawn with the bundled emoji artwork, not the platform font,
// while the button still names the emoji it adds or removes.

import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';
import ReactionSummary from '../../src/lib/shared/chat/ReactionSummary.svelte';
import { createReactionStore } from '../../src/lib/shared/chat/reaction-store.svelte';

afterEach(cleanup);

test('a reaction chip draws its emoji as artwork and says which reaction it toggles', () => {
  const store = createReactionStore();
  store.setConversation({ type: 'room', id: 'kitchen' });
  store.applyServer('m1', { emoji: '👍', count: 2, reactedByMe: true, revision: '1' });
  const { container } = render(ReactionSummary, { props: { store, messageId: 'm1' } });

  const toggle = screen.getByRole('button', { name: 'Убрать реакцию 👍' });
  const image = toggle.querySelector('img');
  expect(image?.getAttribute('src')).toMatch(/^\/emoji\/.+/);
  expect(toggle.getAttribute('aria-pressed')).toBe('true');
  expect(container.textContent).not.toContain('👍');
  expect(screen.getByRole('button', { name: 'Показать пользователей: 2' })).toBeTruthy();
});
