import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Avatar from '../Avatar/Avatar.vue';
import Combobox from './Combobox.vue';

const meta = {
  title: 'Components/Inputs/Combobox',
  component: Combobox,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Combobox and Listbox that filters as the user types.',
          '',
          '- Use field sizes sm 32, md 40 and lg 44.',
          '- Use a row of 36 for a plain row, or 48 for a row with an avatar.',
          '- Filter as the user types. Move the highlight with the arrow keys, select with Enter, and close with Esc.',
          '- Keep focus in the field.',
          '- Show «Ничего не найдено» (Nothing found) when there is no result.',
          '- Use the same Listbox for mentions in the composer, with the composer as the field.'
        ].join('\n')
      }
    }
  },
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

export const Overlay: Story = { args: { overlay: true, visuallyHiddenLabel: true } };
