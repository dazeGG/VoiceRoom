import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Splitter from './Splitter.vue';
import type { SplitterProps, SplitterSize } from './types';

const meta = {
  title: 'Components/Structure/Splitter',
  component: Splitter,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Splitter whose handle moves the panes and reports the pane size.',
          '',
          '- Use a handle of 8 with a visible line of 2: `--vr-line`, `--vr-accent-line` on hover and while dragging, and `--vr-accent` in focus.',
          '- Move 16px with the arrow keys, and jump to the bounds with Home and End.',
          '- Use a vertical split for stacked panes. Set singlePane to show one pane while keeping both mounted.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Ширина боковой панели', size: 220, minSize: 144, maxSize: 320 },
  render: (args: SplitterProps & { collapsed?: boolean }) => ({
    components: { Splitter },
    setup: () => {
      const size = ref(args.size);
      const collapsed = ref(args.collapsed ?? false);
      const commit = (layout: SplitterSize): void => {
        if (!layout.collapsed) size.value = layout.size;
      };
      return { args, size, collapsed, commit };
    },
    template: `
      <div :style="{ width: 'min(560px, 80vw)', height: args.direction === 'vertical' ? '440px' : undefined }">
        <Splitter v-bind="args" v-model:collapsed="collapsed" :size="size" @commit="commit">
          <template #side>
            <div style="padding: var(--space-12)">
              <button v-if="args.collapsedSize !== undefined" type="button" @click="collapsed = !collapsed">
                {{ collapsed ? 'Развернуть' : 'Свернуть' }}
              </button>
              <span v-else>{{ args.direction === 'vertical' ? 'Звонок' : 'Друзья' }}</span>
            </div>
          </template>
          <p style="margin-inline: var(--space-12)">Переписка</p>
        </Splitter>
      </div>`
  })
} satisfies Meta<typeof Splitter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pane: Story = {};
export const Collapsible: Story = { args: { collapsedSize: 112 } };
export const Collapsed: Story = { args: { collapsedSize: 112, collapsed: true } };

export const Vertical: Story = {
  args: { direction: 'vertical', label: 'Высота звонка', size: 176, minSize: 120, maxSize: 300 }
};
export const VerticalExpanded: Story = { args: { ...Vertical.args, singlePane: 'side' } };
