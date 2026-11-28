import type { Meta, StoryObj } from '@storybook/vue3-vite';
import FileAttachment from './FileAttachment.vue';

const meta = {
  title: 'Components/Chat/FileAttachment',
  component: FileAttachment,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'A diagnostic report in a chat or support inbox. The full filename stays available when the row truncates it. Supply a download URL once the file is ready and use the actions slot for draft actions.'
      }
    }
  },
  args: { name: 'voiceroom-diagnostics-2026-11-27-1402.txt', bytes: 18432 }
} satisfies Meta<typeof FileAttachment>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = { args: { url: '/example-diagnostics.txt' } };
export const Uploading: Story = {};
