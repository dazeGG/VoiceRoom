import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import type { ToastItem } from '@voiceroom/ui-kit/toast';
import Button from '../Button/Button.vue';
import Toast from './Toast.vue';
import type { ToastProps } from './types';

const meta = {
  title: 'Components/Feedback/Toast',
  component: Toast,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Toast that states a fact and disappears on its own.',
          '',
          '- Use a width of 360, radius 16 and an icon in a circle of 28. Dismiss it after 5 seconds.',
          '- Write the message as a fact: «Ссылка скопирована» (Link copied), «Не удалось войти» (Login failed).',
          '- Allow at most one action, a Button plain sm.',
          '- Show no more than three at once. Pause the timer on hover. Move focus into the stack with F8.'
        ].join('\n')
      }
    }
  },
  args: { toasts: [{ id: 'copy', variant: 'success', message: 'Ссылка скопирована' }], onDismiss: () => {} },
  render: (args: ToastProps) => ({
    components: { Button, Toast },
    setup() {
      const items = ref<ToastItem[]>([]);
      function show(): void {
        items.value = [...args.toasts];
      }
      function dismiss(id: string): void {
        items.value = items.value.filter((item) => item.id !== id);
      }
      return { items, show, dismiss };
    },
    template:
      '<Button size="sm" @click="show">Показать уведомления</Button><Toast :toasts="items" :on-dismiss="dismiss" />'
  })
} satisfies Meta<typeof Toast>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {};
export const Danger: Story = {
  args: {
    toasts: [{ id: 'error', variant: 'error', message: 'Не удалось войти', description: 'Повторите попытку позже.' }]
  }
};
export const Warning: Story = {
  args: { toasts: [{ id: 'warning', variant: 'warning', message: 'Не удалось включить микрофон' }] }
};
export const Info: Story = {
  args: { toasts: [{ id: 'info', variant: 'info', message: 'Уведомления выключены' }] }
};
export const Default: Story = {
  args: { toasts: [{ id: 'default', variant: 'default', message: 'Настройки сохранены' }] }
};
export const WithAction: Story = {
  args: {
    toasts: [
      {
        id: 'undo',
        variant: 'info',
        message: 'Уведомления выключены',
        duration: 0,
        actions: [{ label: 'Отменить', onClick: () => {} }]
      }
    ]
  }
};
export const Queue: Story = {
  args: {
    toasts: [
      { id: '1', message: 'Ссылка скопирована', variant: 'success' },
      { id: '2', message: 'Отправлена заявка', variant: 'success' },
      { id: '3', message: 'Уведомления включены', variant: 'info' },
      { id: '4', message: 'Настройки сохранены', variant: 'default' }
    ]
  }
};
