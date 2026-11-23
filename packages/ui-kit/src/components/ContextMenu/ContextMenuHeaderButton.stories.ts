import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import ContextMenu from './ContextMenu.vue';
import MenuItem from '../MenuItem/MenuItem.vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import ContextMenuHeaderButton from './ContextMenuHeaderButton.vue';

const meta = {
  title: 'Components/Overlays/ContextMenuHeaderButton',
  component: ContextMenuHeaderButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'An icon action in the quick-action toolbar of a context menu.',
          '',
          '- Supply a label, the icon in the default slot and `pressed` for a toggle action.',
          '- Handle `click` from the parent toolbar and propagate unavailability with `disabled`.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Отметить' },
  render: (args) => ({
    components: { ContextMenuHeaderButton, Button, ContextMenu, MenuItem, StoryIcon },
    setup: () => ({ args, open: ref(false), pressed: ref(false) }),
    template: `<Button aria-haspopup="menu" :aria-expanded="open" @click="open = true">Действия</Button>
    <ContextMenu :open="open" :x="24" :y="48" aria-label="Действия" header-label="Быстрые действия" @close="open = false">
      <template #header><ContextMenuHeaderButton v-bind="args" :pressed="pressed" @click="pressed = !pressed"><StoryIcon name="check" /></ContextMenuHeaderButton></template>
      <MenuItem label="Скопировать" />
    </ContextMenu>`
  })
} satisfies Meta<typeof ContextMenuHeaderButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
