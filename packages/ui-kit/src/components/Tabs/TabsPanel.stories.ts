import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Tabs from './Tabs.vue';
import TabsPanel from './TabsPanel.vue';

const meta = {
  title: 'Components/Navigation/TabsPanel',
  component: TabsPanel,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The panel associated with a selected tab.',
          '',
          '- Set `value` to the matching tab value when the panel is nested in Tabs.',
          '- For a panel mounted outside Tabs, supply `aria-labelledby` and keep the trigger’s panel ID in sync.'
        ].join('\n')
      }
    }
  },
  args: { value: 'settings' },
  render: (args) => ({
    components: { TabsPanel, Tabs },
    setup: () => ({ args, selected: ref('settings'), items: [{ value: 'settings', label: 'Настройки' }] }),
    template: `<Tabs v-model="selected" label="Комната" :items="items"><TabsPanel v-bind="args">Настройки комнаты</TabsPanel></Tabs>`
  })
} satisfies Meta<typeof TabsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
