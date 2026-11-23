import type { Meta, StoryObj } from '@storybook/vue3-vite';
import SuggestionList from './SuggestionList.vue';

const meta = {
  title: 'Components/Inputs/SuggestionList',
  component: SuggestionList,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A listbox for an input that owns its own suggestions, such as a message composer.',
          '',
          '- Supply a stable `id`, an accessible `label`, the filtered options and the active option value.',
          '- Keep focus in the host input and point its active descendant to the current option; handle selection through `select`.',
          '- Use the `avatar` and `option` slots for richer rows. Disabled options cannot be selected.'
        ].join('\n')
      }
    }
  },
  args: {
    id: 'people-suggestions',
    label: 'Упоминания',
    active: 'anna',
    options: [
      { value: 'anna', label: 'Анна' },
      { value: 'mira', label: 'Мира', disabled: true }
    ]
  },
  render: (args) => ({
    components: { SuggestionList },
    setup: () => ({ args }),
    template: `<SuggestionList v-bind="args" />`
  })
} satisfies Meta<typeof SuggestionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { options: [] } };
