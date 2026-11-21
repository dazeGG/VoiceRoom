import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref, useId } from 'vue';
import Button from '../Button/Button.vue';
import Field from '../Field/Field.vue';
import TextField from '../TextField/TextField.vue';
import Dialog from './Dialog.vue';

const meta = {
  title: 'Components/Overlays/Dialog',
  component: Dialog,
  tags: ['autodocs'],
  args: {
    open: false,
    title: 'Создать комнату',
    size: 'md',
    onClose: () => {}
  },
  render: (args) => ({
    components: { Button, Dialog, Field, TextField },
    setup() {
      const open = ref(false);
      const name = ref('');
      const formId = useId();
      const nameId = useId();
      function close(): void {
        open.value = false;
      }
      return { args, open, name, formId, nameId, close };
    },
    template: `
      <Button @click="open = true">{{ args.title }}</Button>
      <Dialog v-bind="args" :open="open" :on-close="close" :initial-focus="'#' + nameId">
        <form :id="formId" @submit.prevent="close">
          <Field :id="nameId" label="Название">
            <TextField v-model="name" size="lg" required placeholder="Пятничные игры" />
          </Field>
        </form>
        <template #footer>
          <Button size="lg" @click="close">Отмена</Button>
          <Button variant="primary" size="lg" type="submit" :form="formId">Создать комнату</Button>
        </template>
      </Dialog>
    `
  })
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { description: 'Пригласите друзей в голосовую комнату.' } };
export const Large: Story = { args: { size: 'lg' } };
export const WithoutCloseButton: Story = { args: { closable: false } };
