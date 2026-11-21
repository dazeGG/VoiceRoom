import type { Meta, StoryObj } from '@storybook/vue3-vite';
import NativeDialog from './NativeDialog.vue';

const meta = {
  title: 'Components/Overlays/NativeDialog',
  component: NativeDialog,
  tags: ['autodocs'],
  args: { label: 'Просмотр изображения' },
  render: (args) => ({
    components: { NativeDialog },
    setup: () => ({ args }),
    template:
      '<NativeDialog v-slot="{ close }" v-bind="args"><p>Изображение открыто</p><button type="button" @click="close">Закрыть</button></NativeDialog>'
  })
} satisfies Meta<typeof NativeDialog>;
export default meta;

type Story = StoryObj<typeof meta>;
export const Modal: Story = {};
export const Nonmodal: Story = { args: { modal: false } };
