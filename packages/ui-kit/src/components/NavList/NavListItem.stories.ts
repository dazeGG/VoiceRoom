import type { Meta, StoryObj } from '@storybook/vue3-vite';
import NavList from './NavList.vue';
import NavListItem from './NavListItem.vue';

const meta = {
  title: 'Components/Navigation/NavListItem',
  component: NavListItem,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'One link or action in a NavList.',
          '',
          '- Supply a `label` and use `href` for a link, `to` for a router destination or a click handler for an action.',
          '- Use `current` to mark the active destination. Use `disabled` to make a button action unavailable.',
          '- Use the `icon` and `trailing` slots for an icon and supporting metadata.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Уведомления', current: true },
  render: (args) => ({
    components: { NavListItem, NavList },
    setup: () => ({ args }),
    template: `<NavList label="Настройки"><NavListItem v-bind="args" /></NavList>`
  })
} satisfies Meta<typeof NavListItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Disabled: Story = { args: { current: false, disabled: true } };
