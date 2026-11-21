import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Switch from '../Switch/Switch.vue';
import SettingRow from '../SettingRow/SettingRow.vue';
import SettingsGroup from './SettingsGroup.vue';

const meta = {
  title: 'Components/Structure/SettingsGroup',
  component: SettingsGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own group of settings rows, with a dangerous setting in its own group at the bottom.',
          '',
          '- Use radius 16 and padding 16.',
          '- Make a settings row at least 56, with a title of 14/500, a caption description and the control on the right.',
          '- Do not nest a card inside a card. Separate the contents with `--vr-line`.',
          '- Put a dangerous setting in its own group at the bottom.'
        ].join('\n')
      }
    }
  },
  args: { heading: 'Уведомления', description: 'Что приходит, пока вы не в комнате' },
  render: (args) => ({
    components: { SettingsGroup, SettingRow, Switch },
    setup: () => ({ args, enabled: ref(true), invites: ref(false) }),
    template: `<SettingsGroup v-bind="args">
  <SettingRow label="Приватный текст" description="Скрывать текст сообщений в системных уведомлениях">
    <template #control><Switch aria-label="Приватный текст" v-model="enabled" /></template>
  </SettingRow>
  <SettingRow label="Приглашения в комнаты">
    <template #control><Switch aria-label="Приглашения в комнаты" v-model="invites" /></template>
  </SettingRow>
</SettingsGroup>`
  })
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithoutHeading: Story = { args: { heading: '', description: '' } };
