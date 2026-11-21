import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import Switch from '../Switch/Switch.vue';
import Popover from './Popover.vue';

const meta = {
  title: 'Components/Overlays/Popover',
  component: Popover,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Popover for content that contains controls.',
          '',
          '- Use a width of 300, padding of 16 and radius 12.',
          '- Use it for content that has controls, at sm. If it contains only actions, use DropdownMenu.',
          '- Use a title of 14/600, and do not add a close button.'
        ].join('\n')
      }
    }
  },
  args: { placement: 'bottom-start', title: 'Уведомления', role: 'dialog', flip: true },
  render: (args) => ({
    components: { Button, Popover, Switch },
    setup: () => ({ args, sound: ref(true) }),
    template: `
      <Popover v-bind="args">
        <template #trigger="{ open, toggle, panelId }">
          <Button :aria-expanded="open" :aria-controls="panelId" aria-haspopup="dialog" @click="toggle">
            Настроить уведомления
          </Button>
        </template>
        <template #content>
          <label class="story-popover-setting">
            Звук уведомлений
            <Switch v-model="sound" size="sm" aria-label="Звук уведомлений" />
          </label>
        </template>
      </Popover>
    `
  })
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Untitled: Story = { args: { title: '', ariaLabel: 'Уведомления' } };
export const BottomEnd: Story = { args: { placement: 'bottom-end' } };
export const TopStart: Story = { args: { placement: 'top-start' } };
export const TopEnd: Story = { args: { placement: 'top-end' } };
export const Floating: Story = { args: { floating: true } };
export const KeptMounted: Story = { args: { keepContentMounted: true } };
