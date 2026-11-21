import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref, shallowRef } from 'vue';
import Button from '../Button/Button.vue';
import { PopoverDivider, PopoverMenuItem } from '../Popover';
import ContextMenu from './ContextMenu.vue';

const meta = {
  title: 'Components/ContextMenu',
  component: ContextMenu,
  tags: ['autodocs'],
  args: { open: false, x: 0, y: 0, ariaLabel: 'Действия с комнатой', role: 'menu', padded: true },
  render: (args) => ({
    components: { Button, ContextMenu, PopoverDivider, PopoverMenuItem },
    setup() {
      const open = ref(false);
      const x = ref(0);
      const y = ref(0);
      const trigger = shallowRef<HTMLElement | null>(null);
      function show(event: MouseEvent): void {
        if (!(event.currentTarget instanceof HTMLElement)) return;
        trigger.value = event.currentTarget;
        const rect = event.currentTarget.getBoundingClientRect();
        x.value = event.clientX || rect.left;
        y.value = event.clientY || rect.bottom;
        open.value = true;
      }
      return { args, open, x, y, trigger, show };
    },
    template: `
      <Button aria-haspopup="menu" :aria-expanded="open" @click="show" @contextmenu.prevent="show">
        Открыть меню комнаты
      </Button>
      <ContextMenu v-bind="args" :open="open" :x="x" :y="y" :restore-focus="trigger" @close="open = false">
        <template #default="{ close }">
          <template v-if="args.role === 'dialog'">
            <p>Пригласите друзей в комнату.</p>
            <Button @click="close()">Готово</Button>
          </template>
          <template v-else-if="args.role === 'listbox'">
            <PopoverMenuItem label="Все сообщения" role="option" selected @click="close()" />
            <PopoverMenuItem label="Только упоминания" role="option" @click="close()" />
          </template>
          <template v-else>
            <PopoverMenuItem label="Войти" @click="close()" />
            <PopoverMenuItem label="Создать комнату" variant="accent" @click="close()" />
            <PopoverMenuItem label="Копировать ссылку" disabled />
            <PopoverDivider />
            <PopoverMenuItem label="Удалить комнату" variant="danger" @click="close()" />
          </template>
        </template>
      </ContextMenu>
    `
  })
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Bare: Story = { args: { padded: false } };
export const Listbox: Story = { args: { role: 'listbox', ariaLabel: 'Уведомления' } };
export const DialogPanel: Story = { args: { role: 'dialog', ariaLabel: 'Пригласить друзей' } };
