import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Splitter from './Splitter.vue';
import type { SplitterProps, SplitterWidth } from './types';

const meta = {
  title: 'Components/Structure/Splitter',
  component: Splitter,
  tags: ['autodocs'],
  args: { label: 'Ширина боковой панели', width: 220, minWidth: 144, maxWidth: 320 },
  render: (args: SplitterProps & { collapsed?: boolean }) => ({
    components: { Splitter },
    setup: () => {
      const width = ref(args.width);
      const collapsed = ref(args.collapsed ?? false);
      const commit = (layout: SplitterWidth): void => {
        if (!layout.collapsed) width.value = layout.width;
      };
      return { args, width, collapsed, commit };
    },
    template: `
      <div style="width: min(560px, 80vw)">
        <Splitter v-bind="args" v-model:collapsed="collapsed" :width="width" @commit="commit">
          <template #side>
            <div style="padding: var(--space-12)">
              <button v-if="args.collapsedWidth !== undefined" type="button" @click="collapsed = !collapsed">
                {{ collapsed ? 'Развернуть' : 'Свернуть' }}
              </button>
              <span v-else>Друзья</span>
            </div>
          </template>
          <p style="margin-inline: var(--space-12)">Выберите переписку</p>
        </Splitter>
      </div>`
  })
} satisfies Meta<typeof Splitter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pane: Story = {};
export const Collapsible: Story = { args: { collapsedWidth: 112 } };
export const Collapsed: Story = { args: { collapsedWidth: 112, collapsed: true } };
