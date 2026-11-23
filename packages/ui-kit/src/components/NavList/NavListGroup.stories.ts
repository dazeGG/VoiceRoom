import type { Meta, StoryObj } from '@storybook/vue3-vite';
import NavList from './NavList.vue';
import NavListItem from './NavListItem.vue';
import NavListGroup from './NavListGroup.vue';

const meta = {
  title: 'Components/Navigation/NavListGroup',
  component: NavListGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A labelled group of related destinations inside a NavList.',
          '',
          '- Place NavListItem children in the default slot and give related sections a short `label`.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Параметры' },
  render: (args) => ({
    components: { NavListGroup, NavList, NavListItem },
    setup: () => ({ args }),
    template: `<NavList label="Настройки"><NavListGroup v-bind="args"><NavListItem label="Уведомления" current /><NavListItem label="Звук" /></NavListGroup></NavList>`
  })
} satisfies Meta<typeof NavListGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
