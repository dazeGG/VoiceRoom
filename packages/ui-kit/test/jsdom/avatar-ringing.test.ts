import { render, screen } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import { expect, test } from 'vitest';
import { Avatar, Button, type AvatarProps } from '@voiceroom/ui-kit/components';

test('ringing, silenced and idle presentations leave the owning button name stable', async () => {
  const ringing = ref<AvatarProps['ringing']>('ringing');
  render(
    defineComponent(
      () => () => h(Button, {}, () => [h(Avatar, { name: 'Аня', size: 128, ringing: ringing.value }), 'Позвонить'])
    )
  );
  const trigger = screen.getByRole('button', { name: 'Позвонить' });
  const avatar = screen.getByText('А');
  expect(avatar.closest('[aria-hidden="true"]')?.classList.contains('ui-avatar--ringing-animated')).toBe(true);
  ringing.value = 'silenced';
  await nextTick();
  expect(avatar.closest('[aria-hidden="true"]')?.classList.contains('ui-avatar--ringing')).toBe(true);
  expect(avatar.closest('[aria-hidden="true"]')?.classList.contains('ui-avatar--ringing-animated')).toBe(false);
  ringing.value = undefined;
  await nextTick();
  expect(avatar.closest('[aria-hidden="true"]')?.classList.contains('ui-avatar--ringing')).toBe(false);
  expect(screen.getByRole('button', { name: 'Позвонить' })).toBe(trigger);
});
