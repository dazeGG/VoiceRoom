import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import type { HotkeyBinding } from '@voiceroom/ui-kit/hotkey';
import Field from '../Field/Field.vue';
import HotkeyField from './HotkeyField.vue';
import type { HotkeyFieldProps } from './types';

const binding: HotkeyBinding = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, code: 'KeyM' };
type Args = HotkeyFieldProps & { modelValue?: HotkeyBinding | null };

const meta = {
  title: 'Components/Inputs/HotkeyField',
  component: HotkeyField,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own field that records the next key chord.',
          '',
          '- Use size md 40.',
          '- On click, start recording (`aria-pressed="true"`, a dot, and «Нажмите клавиши…» (Press the keys…)). Save the first chord. Cancel with Esc.',
          '- Show the keys as Kbd, and reset with an IconButton 28 inside the field.',
          '- Draw focus and recording with the field border `--vr-accent-line`.'
        ].join('\n')
      }
    }
  },
  args: { ariaLabel: 'Включить микрофон', modelValue: binding, defaultValue: binding },
  render: (args: Args) => ({
    components: { Field, HotkeyField },
    setup: () => ({ args, value: ref(args.modelValue ?? null) }),
    template:
      '<Field :label="args.ariaLabel" hint="Работает, пока окно VoiceRoom в фокусе"><HotkeyField v-bind="args" v-model="value" /></Field>'
  })
} satisfies Meta<typeof HotkeyField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Assigned: Story = {};
export const Unassigned: Story = { args: { modelValue: null } };
export const Disabled: Story = { args: { disabled: true } };
export const Recording: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Включить микрофон' }));
  }
};
