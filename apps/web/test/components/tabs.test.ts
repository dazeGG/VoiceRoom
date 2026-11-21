import { render, screen, waitFor } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { defineComponent, ref } from 'vue';
import { Tabs, TabsPanel } from '@voiceroom/ui-kit/components';

test('tabs move focus, skip disabled tabs, and expose the selected panel', async () => {
  const user = userEvent.setup();
  render(
    defineComponent({
      components: { Tabs, TabsPanel },
      setup: () => ({
        selected: ref('chat'),
        items: [
          { value: 'chat', label: 'Чат', dot: true },
          { value: 'archive', label: 'Архив', disabled: true },
          { value: 'people', label: 'Участники', count: 4 }
        ]
      }),
      template: `
      <Tabs v-model="selected" label="Разделы" :items="items">
        <TabsPanel value="chat">Сообщения комнаты</TabsPanel>
        <TabsPanel value="people">Участники комнаты</TabsPanel>
      </Tabs>`
    })
  );
  const chat = screen.getByRole('tab', { name: 'Чат' });
  const people = screen.getByRole('tab', { name: 'Участники' });

  await user.tab();
  await waitFor(() => expect(document.activeElement).toBe(chat));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(document.activeElement).toBe(people));
  expect(people.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel', { name: 'Участники' }).id).toBe(people.getAttribute('aria-controls'));
  expect(screen.queryByRole('tabpanel', { name: 'Чат' })).toBeNull();

  await user.keyboard('{Home}');
  await waitFor(() => expect(chat.getAttribute('aria-selected')).toBe('true'));
});
