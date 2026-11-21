import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import Callout from './Callout.vue';

const meta = {
  title: 'Components/Feedback/Callout',
  component: Callout,
  tags: ['autodocs'],
  args: { title: 'Доступно обновление', text: 'Обновите страницу, когда закончите звонок.' }
} satisfies Meta<typeof Callout>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};
export const Warning: Story = {
  args: { tone: 'warning', title: 'Новый вход в аккаунт', text: 'Проверьте устройство.' }
};
export const Danger: Story = {
  args: { tone: 'danger', title: 'Не удалось подключиться', text: 'Проверьте интернет и повторите попытку.' }
};
export const Accent: Story = {
  args: { tone: 'accent', title: 'Сделайте комнату постоянной', text: 'Приглашайте друзей по одной ссылке.' },
  render: (args) => ({
    components: { Button, Callout },
    setup: () => ({ args }),
    template:
      '<Callout v-bind="args"><template #actions><Button size="sm">Создать аккаунт</Button></template></Callout>'
  })
};
export const Dismissible: Story = {
  args: { dismissible: true },
  render: (args) => ({
    components: { Button, Callout },
    setup: () => ({ args, visible: ref(true) }),
    template:
      '<Callout v-if="visible" v-bind="args" @dismiss="visible = false" /><Button v-else size="sm" @click="visible = true">Показать уведомление</Button>'
  })
};
