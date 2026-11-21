import type { Meta, StoryObj } from '../../../../packages/ui/.storybook/types';
import OwnerPage from '@/pages/OwnerPage.vue';
import { installMeetI18n, setMeetLocale } from '@/i18n';
import { useMeetStore } from '@/meet.store';
import '@/styles/main.scss';

const meta = {
  title: 'Apps/Meet/Entry',
  component: OwnerPage,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  render: () => ({
    components: { OwnerPage },
    setup() {
      installMeetI18n();
      setMeetLocale('ru');
      const meet = useMeetStore();
      meet.owner = 'ready';
      meet.api.createMeeting = async () => ({ ok: true, roomId: 'demo', joinUrl: '/room/demo' });
    },
    template: '<OwnerPage />'
  })
} satisfies Meta<typeof OwnerPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Entry: Story = {};
