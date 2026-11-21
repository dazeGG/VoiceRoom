import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref, useTemplateRef } from 'vue';
import Field from '../Field/Field.vue';
import Select from './Select.vue';

const meta = {
  title: 'Components/Inputs/Select',
  component: Select,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A short single-choice list that supports a Reka popup and a platform picker.',
          '',
          '- Use sizes sm 32, md 40 and lg 44, and the `ghost` variant in headers.',
          '- Use it for up to 10–12 items with no search. Beyond that, use Combobox.',
          '- Set `native` when the platform’s own picker is required. Both modes use the same options, sizes and selected value.',
          '- Bind the selection with `v-model`. Handle `valueChange` when an explicit user choice matters.',
          '- Mark the selected item with a check on the right and `--vr-accent-soft`.',
          '- Make the panel at least as wide as the trigger, and no taller than 320px.'
        ].join('\n')
      }
    }
  },
  args: {
    label: 'Микрофон',
    options: [
      { value: '', label: 'По умолчанию' },
      { value: 'headset', label: 'Микрофон гарнитуры' },
      { value: 'studio', label: 'Студийный микрофон' }
    ],
    size: 'md',
    placement: 'bottom-start',
    flip: true
  },
  render: (args) => ({
    components: { Select },
    setup() {
      const value = ref('');
      return { args, value };
    },
    template: '<Select v-bind="args" v-model="value" />'
  })
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};
export const Small: Story = { args: { size: 'sm' } };
export const Large: Story = { args: { size: 'lg' } };
export const Ghost: Story = {
  args: {
    label: 'Язык',
    variant: 'ghost',
    size: 'sm',
    options: [
      { value: '', label: 'Русский' },
      { value: 'en', label: 'Английский' },
      { value: 'fr', label: 'Французский' }
    ]
  }
};
export const InvalidField: Story = {
  render: (args) => ({
    components: { Field, Select },
    setup: () => ({ args }),
    template: '<Field label="Микрофон" error="Выберите доступный микрофон"><Select v-bind="args" /></Field>'
  }),
  args: { label: '' }
};
export const Open: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('combobox'));
  }
};
export const Disabled: Story = { args: { disabled: true } };
export const Empty: Story = { args: { options: [] } };
export const BottomEnd: Story = { args: { placement: 'bottom-end' } };
export const TopStart: Story = { args: { placement: 'top-start' } };
export const TopEnd: Story = { args: { placement: 'top-end' } };
export const SystemPicker: Story = { args: { native: true, size: 'sm' } };

export const LocalPanel: Story = {
  args: { label: '', size: 'sm' },
  render: (args) => ({
    components: { Field, Select },
    setup: () => ({ args, value: ref(''), preview: useTemplateRef<HTMLElement>('preview') }),
    template: `
      <section ref="preview">
        <Field label="Микрофон">
          <Select v-bind="args" v-model="value" :portal-target="preview ?? undefined" />
        </Field>
      </section>
    `
  })
};

export const CustomLabel: Story = {
  render: (args) => ({
    components: { Select },
    setup: () => ({ args }),
    template: '<Select v-bind="args"><template #option-label="{ text }"><strong>{{ text }}</strong></template></Select>'
  })
};
