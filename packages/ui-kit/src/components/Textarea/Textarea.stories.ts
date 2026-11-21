import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Field from '../Field/Field.vue';
import Textarea from './Textarea.vue';
import type { TextareaProps } from './types';

type Args = TextareaProps & { modelValue?: string; error?: string };

const meta = {
  title: 'Components/Inputs/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own multiline field that grows with the text and then scrolls.',
          '',
          '- Grow with the text from 80 to 240px, in steps of one 20px line, then scroll.',
          '- Turn manual resize off.',
          '- Show the counter «12 / 500» on the right under the field.',
          '- When the value exceeds the limit, use `--vr-danger`.'
        ].join('\n')
      }
    }
  },
  args: { placeholder: 'Что стоит знать модератору?' },
  render: (args: Args) => ({
    components: { Field, Textarea },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: `<Field label="Комментарий" optional :error="args.error">
      <Textarea v-model="value" :placeholder="args.placeholder" :maxlength="args.maxlength" :disabled="args.disabled" :readonly="args.readonly" />
    </Field>`
  })
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Counter: Story = { args: { modelValue: 'В чате была реклама.', maxlength: 500 } };
export const MultipleLines: Story = {
  args: {
    modelValue:
      'В чате была реклама.\nСообщение прислали несколько раз.\nЭто произошло после звонка.\n\nПроверьте переписку.'
  }
};
export const Scrollable: Story = { args: { modelValue: 'В чате была реклама.\n'.repeat(16) } };
export const Disabled: Story = { args: { disabled: true, modelValue: 'Жалоба отправлена.' } };
export const ReadOnly: Story = { args: { readonly: true, modelValue: 'Жалоба отправлена.' } };
export const OverLimit: Story = {
  args: { modelValue: 'Это произошло после звонка.', maxlength: 16, error: 'Сократите комментарий' }
};

export const Monospace: Story = { args: { variant: 'mono' } };
export const Compact: Story = { args: { variant: 'compact' } };
