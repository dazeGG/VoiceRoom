import type { Meta, StoryObj } from '@storybook/vue3-vite';

import AvatarStack from './AvatarStack.vue';
import type { AvatarStackItem } from './types';

const items: AvatarStackItem[] = [
  { id: 'anna', label: 'Анна', initials: 'А', background: 'var(--vr-accent)', foreground: 'var(--vr-accent-ink)' },
  { id: 'boris', label: 'Борис', initials: 'Б', background: 'var(--vr-surface-3)', foreground: 'var(--vr-text)' },
  { id: 'vera', label: 'Вера', initials: 'В', background: 'var(--vr-surface-2)', foreground: 'var(--vr-text)' },
  { id: 'gleb', label: 'Глеб', initials: 'Г', background: 'var(--vr-accent-soft)', foreground: 'var(--vr-text)' },
  { id: 'daria', label: 'Дарья', initials: 'Д', background: 'var(--vr-surface)', foreground: 'var(--vr-text)' }
];

const meta = {
  title: 'Components/People/AvatarStack',
  component: AvatarStack,
  tags: ['autodocs'],
  args: { items, size: 24, maxAvatars: 3, ariaLabel: 'Участники комнаты' },
  argTypes: { size: { control: 'select', options: [20, 24, 28, 32] } }
} satisfies Meta<typeof AvatarStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithOverflow: Story = {};
export const AllParticipants: Story = { args: { maxAvatars: null } };
export const SingleParticipant: Story = { args: { items: items.slice(0, 1) } };
export const Small: Story = { args: { size: 20 } };
export const Medium: Story = { args: { size: 28 } };
export const Large: Story = { args: { size: 32 } };
export const Empty: Story = {
  args: { items: [] },
  render: (args) => ({
    components: { AvatarStack },
    setup: () => ({ args }),
    template: '<AvatarStack v-bind="args"><template #empty>Пока никого нет</template></AvatarStack>'
  })
};
