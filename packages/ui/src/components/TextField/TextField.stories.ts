import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import Field from '../Field/Field.vue';
import IconButton from '../IconButton/IconButton.vue';
import TextField from './TextField.vue';
import type { TextFieldProps } from './types';

type Args = TextFieldProps & { modelValue?: string };

const meta = {
  title: 'Components/Inputs/TextField',
  component: TextField,
  tags: ['autodocs'],
  args: { placeholder: 'Мира' },
  render: (args: Args) => ({
    components: { Field, TextField },
    setup: () => ({ args, value: ref(args.modelValue ?? '') }),
    template: '<Field label="Имя"><TextField v-bind="args" v-model="value" /></Field>'
  })
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { modelValue: 'Мира' } };
export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };
export const Disabled: Story = { args: { disabled: true, modelValue: 'Мира' } };
export const ReadOnly: Story = { args: { readonly: true, modelValue: 'Мира' } };

export const Password: Story = {
  args: { type: 'password', modelValue: 'voice-room', autocomplete: 'current-password', placeholder: '' },
  render: (args: Args) => ({
    components: { Field, TextField },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<Field label="Пароль"><TextField v-bind="args" v-model="value" /></Field>'
  })
};

export const SearchWithClear: Story = {
  args: { clearable: true, size: 'sm', placeholder: 'Имя или логин', modelValue: 'Мира' },
  render: (args: Args) => ({
    components: { StoryIcon, Field, TextField },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template:
      '<Field label="Поиск"><TextField v-bind="args" v-model="value"><template #leading><StoryIcon name="search" /></template></TextField></Field>'
  })
};

export const Code: Story = {
  args: { variant: 'mono', modelValue: 'A1BC-DE23', placeholder: 'ABCD-1234' },
  render: (args: Args) => ({
    components: { Field, IconButton, StoryIcon, TextField },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: `<Field label="Код восстановления" optional hint="Код действует один раз">
      <TextField v-bind="args" v-model="value">
        <template #trailing>
          <IconButton label="Подставить код" :size="28" @click="value = 'ABCD-1234'"><StoryIcon name="key-round" /></IconButton>
        </template>
      </TextField>
    </Field>`
  })
};

export const Invalid: Story = {
  args: { modelValue: 'mira@' },
  render: (args: Args) => ({
    components: { Field, TextField },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<Field label="Почта" error="Проверьте адрес почты"><TextField v-bind="args" v-model="value" /></Field>'
  })
};
