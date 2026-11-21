import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Tabs from './Tabs.vue';
import TabsPanel from './TabsPanel.vue';
import type { TabsProps } from './types';

const StoryTabs = Object.assign({ inheritAttrs: true }, Tabs<string>);

const meta = {
  title: 'Components/Navigation/Tabs',
  component: StoryTabs,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Tabs, either as a line for page sections or as segments for compact panels.',
          '',
          '- Use a line (40) for sections of a page or a dialog.',
          '- Use segments (40 / 32) for compact panels.',
          '- Use the counter and the dot the same way as SegmentControl.',
          '- On a tab that hides a form error, show a `--vr-danger` dot.'
        ].join('\n')
      }
    }
  },
  args: {
    label: 'Панель комнаты',
    modelValue: 'chat',
    items: [
      { value: 'chat', label: 'Чат', dot: true },
      { value: 'people', label: 'Участники', count: 4 },
      { value: 'settings', label: 'Настройки', error: true },
      { value: 'archive', label: 'Архив', disabled: true }
    ]
  },
  render: (args: TabsProps<string> & { modelValue: string }) => ({
    components: { Tabs, TabsPanel },
    setup: () => ({ args, selected: ref(args.modelValue) }),
    template: `
      <Tabs v-bind="args" v-model="selected">
        <TabsPanel value="chat">Сообщения комнаты</TabsPanel>
        <TabsPanel value="people">Участники комнаты</TabsPanel>
        <TabsPanel value="settings">Укажите название комнаты</TabsPanel>
      </Tabs>`
  })
} satisfies Meta<typeof StoryTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Line: Story = { args: { ...meta.args, variant: 'line' } };
export const Segmented: Story = { args: { ...meta.args, variant: 'segmented', stretch: true } };
