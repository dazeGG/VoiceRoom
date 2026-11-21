import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Avatar from './Avatar.vue';

const meta = {
  title: 'Components/People/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  args: { name: 'Анна', colorKey: 'blurple', size: 36, shape: 'circle' },
  argTypes: {
    size: { control: 'select', options: [20, 24, 28, 32, 36, 40, 48, 56, 80] },
    shape: { control: 'inline-radio', options: ['circle', 'squircle'] }
  }
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SizeGrid: Story = {
  render: (args) => ({
    components: { Avatar },
    setup: () => ({ args, sizes: [20, 24, 28, 32, 36, 40, 48, 56, 80] }),
    template: '<Avatar v-for="size in sizes" :key="size" v-bind="args" :size="size" online show-dot />'
  })
};
export const Circle: Story = {};
export const Squircle: Story = { args: { shape: 'squircle' } };
export const Small: Story = { args: { size: 24 } };
export const Large: Story = { args: { size: 56 } };
export const Profile: Story = { args: { size: 80 } };
export const Online: Story = { args: { showDot: true, online: true } };
export const Offline: Story = { args: { showDot: true, online: false } };
export const Away: Story = { args: { showDot: true, online: true, afk: true } };
export const DoNotDisturb: Story = { args: { showDot: true, online: true, dnd: true } };
export const LargePresence: Story = { args: { size: 80, showDot: true, online: true } };
export const CustomColors: Story = {
  args: { background: 'var(--vr-accent)', foreground: 'var(--vr-accent-ink)' }
};
export const RoomImage: Story = {
  args: {
    name: 'VoiceRoom',
    shape: 'squircle',
    src: new URL('../../../../../apps/web/public/voiceroom-icon.svg', import.meta.url).href
  }
};
export const ImageFallback: Story = { args: { src: './missing-avatar.png' } };
