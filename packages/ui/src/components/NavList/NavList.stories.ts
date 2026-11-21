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
