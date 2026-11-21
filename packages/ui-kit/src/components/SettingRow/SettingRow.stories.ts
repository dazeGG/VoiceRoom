import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Switch from '../Switch/Switch.vue';
import SettingRow from './SettingRow.vue';

const meta = {
  title: 'Components/Structure/SettingRow',
  component: SettingRow,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A settings row that pairs descriptive text with a control.',
          '',
          '- Use `label` and `description` for text, or the title and description slots for structured content.',
          '- Put the named control in the `control` slot and use `leading` for a leading icon or preview.',
          '- Use `stacked` when the control needs the full row width.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Звук уведомлений', description: 'Короткий сигнал при новом сообщении' },
  render: (args) => ({
    components: { SettingRow, Switch },
    setup: () => ({ args, enabled: ref(true) }),
    template: `<SettingRow v-bind="args"><template #control><Switch aria-label="Звук уведомлений" v-model="enabled" /></template></SettingRow>`
  })
} satisfies Meta<typeof SettingRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Stacked: Story = { args: { stacked: true } };
export const WithoutDescription: Story = { args: { description: '' } };
