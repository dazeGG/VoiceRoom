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

test('the speaking ring follows the local speaking state without changing the button name', async () => {
  const speaking = ref(false);
  render(
    defineComponent(() => () => h(Button, {}, () => [h(Avatar, { name: 'Аня', speaking: speaking.value }), 'Account']))
  );
  const avatar = screen.getByText('А').closest('[aria-hidden="true"]');
  expect(avatar?.classList.contains('ui-avatar--speaking')).toBe(false);
  speaking.value = true;
  await nextTick();
  expect(avatar?.classList.contains('ui-avatar--speaking')).toBe(true);
  expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy();
  speaking.value = false;
  await nextTick();
  expect(avatar?.classList.contains('ui-avatar--speaking')).toBe(false);
});
