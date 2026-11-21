import type { Meta, StoryObj } from '@storybook/vue3-vite';

import Avatar from './Avatar.vue';

const meta = {
  title: 'Components/People/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka Avatar for a person, a room or a group, with a fallback when the image fails.',
          '',
          '- Fall back when the image fails to load.',
          '- Use sizes 20, 24, 28, 32, 36, 40, 48, 56 and 80.',
          '- Use a circle for people, and a squircle (31%) for rooms and groups.',
          '- Use a status dot of 8 up to size 28, of 12 from 32 to 48, and of 14 with a 3px stroke from 56.',
          '- Colour that stroke with the surface under the avatar (`--ring`).',
          '- Size the letter to 39% of the avatar, and colour it with the pair `--avatar-<key>-bg` / `-ink`.'
        ].join('\n')
      }
    }
  },
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
