import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Badge from '../Badge/Badge.vue';
import StoryIcon from '../../../.storybook/StoryIcon.vue';
import NavList from './NavList.vue';
import NavListGroup from './NavListGroup.vue';
import NavListItem from './NavListItem.vue';

const meta = {
  title: 'Components/Navigation/NavList',
  component: NavList,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own list of links or buttons for navigation within a page or dialog.',
          '',
          '- Use a row of 36 and an icon of 16.',
          '- Mark the current item with `aria-current="page"` and `--vr-surface-3`. Use `--vr-hover` for hover.',
          '- Label groups with the label style. Put a danger item last, in the danger tone.',
          '- Put a Badge or a counter on the right, and truncate a long name.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Разделы настроек' },
  render: (args) => ({
    components: { Badge, NavList, NavListGroup, NavListItem, StoryIcon },
    setup: () => ({ args, current: ref('profile') }),
    template: `
      <NavList v-bind="args" style="width: 248px">
        <NavListGroup label="Аккаунт">
          <NavListItem label="Профиль" :current="current === 'profile'" @click="current = 'profile'">
            <template #icon><StoryIcon name="user" /></template>
          </NavListItem>
          <NavListItem label="Уведомления о приглашениях в комнаты" :current="current === 'notifications'" @click="current = 'notifications'">
            <template #trailing><Badge :count="3" size="sm" /></template>
          </NavListItem>
        </NavListGroup>
        <NavListGroup label="Приложение">
          <NavListItem href="#settings" label="Справка" />
          <NavListItem label="Выйти из аккаунта" tone="danger" />
        </NavListGroup>
      </NavList>`
  })
} satisfies Meta<typeof NavList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Settings: Story = {};
