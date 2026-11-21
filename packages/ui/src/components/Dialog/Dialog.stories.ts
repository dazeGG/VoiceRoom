import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import Dialog from './Dialog.vue';

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  args: {
    open: false,
    title: 'Создать комнату',
    width: 430,
    onClose: () => {}
  },
  render: (args) => ({
    components: { Button, Dialog },
    setup() {
      const open = ref(false);
      function close(): void {
        open.value = false;
      }
      return { args, open, close };
    },
    template: `
      <Button @click="open = true">Создать комнату</Button>
      <Dialog v-bind="args" :open="open" :on-close="close">
        <p>Пригласите друзей в голосовую комнату.</p>
        <Button @click="close">Создать комнату</Button>
      </Dialog>
    `
  })
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Wide: Story = { args: { width: 640 } };
