import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Avatar from '../Avatar/Avatar.vue';
import Combobox from './Combobox.vue';

const meta = {
  title: 'Components/Inputs/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  args: {
    label: 'Пригласить в комнату',
    placeholder: 'Имя или логин',
    options: [
      { value: 'anya', label: 'Аня' },
      { value: 'oleg', label: 'Олег' },
      { value: 'mira', label: 'Мира', disabled: true }
    ]
  }
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Small: Story = { args: { size: 'sm' } };
export const Medium: Story = { args: { size: 'md' } };
export const Large: Story = { args: { size: 'lg' } };
export const Empty: Story = { args: { options: [], open: true } };
export const GroupedResults: Story = {
  args: {
    label: 'Найти аккаунт или комнату',
    resultsLabel: 'Найдено',
    externalFilter: true,
    open: true,
    query: 'кух',
    options: [
      { value: 'account-kitchen', label: 'Олег', description: '@kitchen', group: 'Аккаунты' },
      { value: 'room-kitchen', label: 'Кухня', group: 'Комнаты' }
    ]
  }
};
export const LoadingResults: Story = {
  args: { ...GroupedResults.args, options: [], loading: true }
};
export const WithAvatars: Story = {
  args: {
    open: true,
    options: meta.args.options.map((option) => ({ ...option, description: '@' + option.value }))
  },
  render: (args) => ({
    components: { Avatar, Combobox },
    setup: () => ({ args }),
    template: `
      <Combobox v-bind="args">
        <template #avatar="{ option }"><Avatar :name="option.label" :size="28" /></template>
      </Combobox>`
  })
};
