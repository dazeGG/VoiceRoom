import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Avatar from '../Avatar/Avatar.vue';
import Button from '../Button/Button.vue';
import HoverCard from './HoverCard.vue';

const meta = {
  title: 'Components/Overlays/HoverCard',
  component: HoverCard,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Reka HoverCard that previews a person after a short hover.',
          '',
          '- Use a width of 288, radius 16 and an avatar of 56.',
          '- Open it after 400 ms of hover and on focus. On a phone, open it on press.',
          '- Paint the banner with the avatar colour at 70% over `--vr-bg`, and use sm buttons for actions.'
        ].join('\n')
      }
    }
  },
  args: { ariaLabel: 'Профиль Ани' },
  render: (args) => ({
    components: { Avatar, Button, HoverCard },
    setup: () => ({ args }),
    template: `
      <HoverCard v-bind="args">
        <template #trigger><Button variant="plain" size="sm">Аня</Button></template>
        <div class="story-hovercard__banner"></div>
        <div class="story-hovercard__body">
          <Avatar name="Аня" :size="56" color-key="blurple" online />
          <div><strong>Аня</strong><br /><small>@anya</small></div>
          <Button size="sm" variant="soft">Добавить в друзья</Button>
        </div>
      </HoverCard>
    `
  })
} satisfies Meta<typeof HoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Right: Story = { args: { side: 'right' }, parameters: { layout: 'centered' } };
