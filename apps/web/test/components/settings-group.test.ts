import { render, screen, within } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Card, SettingRow, SettingsGroup } from '@voice-room/ui/components';
import { defineComponent } from 'vue';

test('a card renders its content as the requested semantic element', () => {
  render(Card, { props: { as: 'article' }, slots: { default: 'Сводка по комнате' } });
  expect(within(screen.getByRole('article')).getByText('Сводка по комнате')).toBeTruthy();
});

test('a named settings group renders a row and keeps its control keyboard-operable', async () => {
  const save = vi.fn();
  const user = userEvent.setup();
  render(
    defineComponent({
      components: { SettingRow, SettingsGroup },
      setup: () => ({ save }),
      template: `
        <SettingsGroup heading="Звук" description="Настройки устройств">
          <SettingRow label="Микрофон" description="Устройство ввода">
            <template #control><button type="button" @click="save">Проверить микрофон</button></template>
          </SettingRow>
        </SettingsGroup>
      `
    })
  );

  const group = within(screen.getByRole('region', { name: 'Звук' }));
  const control = group.getByRole('button', { name: 'Проверить микрофон' });
  expect(group.getByText('Устройство ввода')).toBeTruthy();
  await user.tab();
  expect(document.activeElement).toBe(control);
  await user.keyboard('{Enter}');
  expect(save).toHaveBeenCalledTimes(1);
});
