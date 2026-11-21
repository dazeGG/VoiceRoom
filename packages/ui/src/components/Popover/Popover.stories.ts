import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import { Popover, PopoverDivider, PopoverMenuItem, PopoverMenuLabel, PopoverSubmenu } from './index';

const meta = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
  args: { placement: 'bottom-start', ariaLabel: 'Действия с комнатой', flip: true },
  render: (args) => ({
    components: { Button, Popover, PopoverDivider, PopoverMenuItem, PopoverMenuLabel, PopoverSubmenu },
    setup() {
      return { args };
    },
    template: `
      <Popover v-bind="args">
        <template #trigger="{ open, toggle, panelId }">
          <Button :aria-expanded="open" :aria-controls="panelId" aria-haspopup="menu" @click="toggle">
            Открыть меню
          </Button>
        </template>
        <template #content="{ close }">
          <PopoverMenuLabel text="Комната" />
          <PopoverMenuItem label="Войти" hint="Enter" @click="close()" />
          <PopoverMenuItem label="Создать комнату" variant="accent" @click="close()" />
          <PopoverMenuItem label="Пригласить друзей" variant="friendly" @click="close()" />
          <PopoverMenuItem label="Копировать ссылку" disabled />
          <PopoverDivider />
          <PopoverSubmenu label="Уведомления" aria-label="Уведомления комнаты">
            <template #default="{ close: closeSubmenu }">
              <PopoverMenuItem label="Включить" selected @click="closeSubmenu(); close()" />
              <PopoverMenuItem label="Не беспокоить" @click="closeSubmenu(); close()" />
            </template>
          </PopoverSubmenu>
          <PopoverSubmenu label="Управлять доступом" disabled>
            <PopoverMenuItem label="Пригласить по ссылке" />
          </PopoverSubmenu>
          <PopoverDivider tight />
          <PopoverMenuItem label="Удалить комнату" variant="danger" @click="close()" />
        </template>
      </Popover>
    `
  })
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const BottomEnd: Story = { args: { placement: 'bottom-end' } };
export const TopStart: Story = { args: { placement: 'top-start' } };
export const TopEnd: Story = { args: { placement: 'top-end' } };
export const Floating: Story = { args: { floating: true } };
export const KeptMounted: Story = { args: { keepContentMounted: true } };
export const Listbox: Story = {
  args: { role: 'listbox', ariaLabel: 'Уведомления' },
  render: (args) => ({
    components: { Button, Popover, PopoverMenuItem },
    setup() {
      const selected = ref('all');
      return { args, selected };
    },
    template: `
      <Popover v-bind="args">
        <template #trigger="{ open, toggle, panelId }">
          <Button :aria-expanded="open" :aria-controls="panelId" aria-haspopup="listbox" @click="toggle">
            Выбрать уведомления
          </Button>
        </template>
        <template #content="{ close }">
          <PopoverMenuItem label="Все сообщения" role="option" :selected="selected === 'all'"
            @click="selected = 'all'; close()" />
          <PopoverMenuItem label="Только упоминания" role="option" :selected="selected === 'mentions'"
            @click="selected = 'mentions'; close()" />
        </template>
      </Popover>
    `
  })
};
export const DialogPanel: Story = {
  args: { role: 'dialog', ariaLabel: 'Пригласить друзей' },
  render: (args) => ({
    components: { Button, Popover },
    setup() {
      return { args };
    },
    template: `
      <Popover v-bind="args">
        <template #trigger="{ open, toggle, panelId }">
          <Button :aria-expanded="open" :aria-controls="panelId" aria-haspopup="dialog" @click="toggle">
            Пригласить друзей
          </Button>
        </template>
        <template #content="{ close }">
          <p>Поделитесь ссылкой на комнату с друзьями.</p>
          <Button @click="close()">Готово</Button>
        </template>
      </Popover>
    `
  })
};
