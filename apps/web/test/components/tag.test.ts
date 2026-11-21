import { render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Tag } from '@voice-room/ui/components';

test('selectable tags toggle their pressed state with pointer and keyboard', async () => {
  const user = userEvent.setup();
  const view = render(Tag, { props: { selectable: true }, slots: { default: 'Чистый звук' } });
  const tag = screen.getByRole('button', { name: 'Чистый звук', pressed: false });

  await user.click(tag);
  expect(tag.getAttribute('aria-pressed')).toBe('true');
  await user.keyboard('[Space]');
  expect(tag.getAttribute('aria-pressed')).toBe('false');
  expect(view.emitted('update:pressed')).toEqual([[true], [false]]);
});

test('the remove button emits remove without toggling the tag', async () => {
  const view = render(Tag, { props: { selectable: true, removable: true }, slots: { default: 'Аня' } });
  await userEvent.click(screen.getByRole('button', { name: 'Удалить' }));
  expect(view.emitted('remove')).toEqual([[]]);
  expect(screen.getByRole('button', { name: 'Аня', pressed: false })).toBeTruthy();
});
