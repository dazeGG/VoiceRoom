import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import RadioGroup from './RadioGroup.vue';
import RadioGroupItem from './RadioGroupItem.vue';
import type { RadioGroupProps } from './types';

type Args = RadioGroupProps & { modelValue?: string | null };

const meta = {
  title: 'Components/Inputs/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  args: {
    modelValue: 'spam',
    options: [
      { value: 'spam', label: 'Спам или реклама' },
      { value: 'abuse', label: 'Оскорбления, травля или угрозы' },
      { value: 'other', label: 'Другое', description: 'Опишите причину в комментарии' },
      { value: 'resolved', label: 'Жалоба уже отправлена', disabled: true }
    ]
  },
  render: (args: Args) => ({
    components: { RadioGroup },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: '<RadioGroup v-bind="args" v-model="value" aria-label="Причина жалобы" />'
  })
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};
export const Unselected: Story = { args: { modelValue: null } };
export const Disabled: Story = { args: { disabled: true } };

export const Card: Story = {
  args: {
    variant: 'card',
    modelValue: 'grid',
    options: [
      { value: 'grid', label: 'Сетка' },
      { value: 'stage', label: 'Главный участник' }
    ]
  },
  render: (args: Args) => ({
    components: { RadioGroup },
    setup: () => ({ args, value: ref(args.modelValue) }),
    template: `<RadioGroup v-bind="args" v-model="value" aria-label="Раскладка">
      <template #preview="{ option }">
        <span aria-hidden="true" :style="{ display: 'flex', flex: 1, height: '100%', gap: 'var(--space-4)' }">
          <span :style="{ flex: option.value === 'grid' ? 1 : 2, borderRadius: 'var(--radius-4)', background: 'var(--vr-accent-soft)' }"></span>
          <span style="flex: 1; border-radius: var(--radius-4); background: var(--vr-surface-3)"></span>
        </span>
      </template>
    </RadioGroup>`
  })
};

export const CustomItems: Story = {
  render: () => ({
    components: { RadioGroup, RadioGroupItem },
    setup: () => ({ value: ref('voice') }),
    template: `<RadioGroup v-model="value" aria-label="Активация микрофона">
      <template #item="{ variant }">
        <RadioGroupItem :variant="variant" :option="{ value: 'voice', label: 'По голосу' }" />
        <RadioGroupItem :variant="variant" :option="{ value: 'key', label: 'По кнопке' }" />
      </template>
    </RadioGroup>`
  })
};

export const Tiles: Story = { args: { variant: 'tile' } };
