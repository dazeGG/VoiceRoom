import type { Meta, StoryObj } from '../../../../ui-kit/.storybook/types';
import { ref } from 'vue';
import '@voiceroom/ui-kit/styles/widget/shell';
import WidgetJoinControls from './WidgetJoinControls.vue';

const meta = {
  title: 'Apps/Widget/Entry',
  component: WidgetJoinControls,
  tags: ['autodocs'],
  args: { title: 'Голосовая комната' },
  render: (args) => ({
    components: { WidgetJoinControls },
    setup: () => ({ args, name: ref('Анна'), code: ref('') }),
    template: `
      <div class="widget-shell story-widget">
        <WidgetJoinControls v-bind="args" v-model:name="name" v-model:code="code" />
      </div>
    `
  })
} satisfies Meta<typeof WidgetJoinControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Entry: Story = {};
