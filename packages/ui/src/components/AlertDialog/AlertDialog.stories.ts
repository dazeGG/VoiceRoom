import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import AlertDialog from './AlertDialog.vue';

const meta = {
  title: 'Components/Overlays/AlertDialog',
  component: AlertDialog,
  tags: ['autodocs'],
  args: {
    open: false,
    title: 'Удалить комнату «Пятничные игры»?',
    description: 'Чат и закреплённые сообщения пропадут у всех участников. Отменить это нельзя.',
    confirmLabel: 'Удалить',
    tone: 'danger'
  },
  render: (args) => ({
    components: { AlertDialog, Button },
    setup() {
      const open = ref(false);
      function close(): void {
        open.value = false;
      }
      return { args, open, close };
    },
    template: `
      <Button :variant="args.tone === 'danger' ? 'danger-ghost' : 'ghost'" @click="open = true">
        {{ args.confirmLabel }}
      </Button>
      <AlertDialog v-bind="args" :open="open" @cancel="close" @confirm="close" />
    `
  })
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Danger: Story = {};
export const Default: Story = {
  args: {
    title: 'Перейти в комнату «Пятничные игры»?',
    description: 'Вы покинете текущий звонок.',
    confirmLabel: 'Перейти',
    tone: 'default'
  }
};
export const Busy: Story = { args: { busy: true, confirmLabel: 'Удаляем…' } };
