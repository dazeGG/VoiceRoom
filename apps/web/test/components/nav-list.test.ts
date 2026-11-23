import { screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { NavList, NavListGroup, NavListItem } from '@voiceroom/ui-kit/components';
import { renderWithApp } from '../helpers/render';

const Navigation = defineComponent({
  components: { NavList, NavListGroup, NavListItem },
  props: { links: Boolean },
  emits: { leave: () => true },
  setup: () => ({ current: ref('profile') }),
  template: `
    <NavList label="Настройки">
      <template v-if="links">
        <NavListItem label="Справка" href="/help" />
        <NavListItem label="Главная" to="/" />
      </template>
      <template v-else>
        <NavListGroup label="Аккаунт">
          <NavListItem label="Профиль" :current="current === 'profile'" @click="current = 'profile'" />
          <NavListItem label="Звук" :current="current === 'sound'" @click="current = 'sound'" />
        </NavListGroup>
        <NavListItem label="Выйти" tone="danger" disabled @click="$emit('leave')" />
      </template>
    </NavList>`
});

test('navigation exposes the current page and updates when another section is selected', async () => {
  const onLeave = vi.fn();
  await renderWithApp(Navigation, { props: { onLeave } });
  const profile = screen.getByRole('button', { name: 'Профиль' });
  const sound = screen.getByRole('button', { name: 'Звук' });
  expect(
    screen.getByRole('navigation', { name: 'Настройки' }).contains(screen.getByRole('group', { name: 'Аккаунт' }))
  ).toBe(true);
  expect(profile.getAttribute('aria-current')).toBe('page');

  await userEvent.click(sound);
  expect(sound.getAttribute('aria-current')).toBe('page');
  expect(profile.hasAttribute('aria-current')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Выйти' }));
  expect(onLeave).not.toHaveBeenCalled();
});

test('navigation supports both href and router links', async () => {
  await renderWithApp(Navigation, {
    props: { links: true },
    extraRoutes: [{ path: '/', component: { render: () => null } }]
  });
  expect(screen.getByRole('link', { name: 'Справка' }).getAttribute('href')).toBe('/help');
  expect(screen.getByRole('link', { name: 'Главная' }).getAttribute('aria-current')).toBe('page');
});
