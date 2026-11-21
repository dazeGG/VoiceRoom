import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Skeleton from './Skeleton.vue';

const meta = {
  title: 'Components/Feedback/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  args: { width: '100%', height: 'var(--size-16)', radius: 'var(--radius-6)', circle: false },
  render: (args) => ({
    components: { Skeleton },
    setup: () => ({ args }),
    template: '<div style="width: calc(var(--size-48) * 5)"><Skeleton v-bind="args" /></div>'
  })
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Circle: Story = { args: { width: 'var(--size-40)', height: 'var(--size-40)', circle: true } };
export const Card: Story = { args: { height: 'calc(var(--size-48) * 3)', radius: 'var(--radius-16)' } };
export const RoomList: Story = {
  render: () => ({
    components: { Skeleton },
    template: `
      <div style="display: grid; width: calc(var(--size-48) * 5); gap: var(--space-12)" aria-label="Загрузка комнат">
        <div v-for="row in 3" :key="row" style="display: flex; align-items: center; gap: var(--space-12)">
          <Skeleton width="var(--size-40)" height="var(--size-40)" circle />
          <span style="display: grid; flex: 1; gap: var(--space-8)">
            <Skeleton width="60%" height="var(--icon-12)" />
            <Skeleton width="35%" height="var(--space-8)" />
          </span>
        </div>
      </div>
    `
  })
};
