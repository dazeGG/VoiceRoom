import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import Switch from '../Switch/Switch.vue';
import Popover from './Popover.vue';

const meta = {
  title: 'Components/Overlays/Popover',
  component: Popover,
  tags: ['autodocs'],
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
