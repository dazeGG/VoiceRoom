import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { ref } from 'vue';
import Button from '../Button/Button.vue';
import Callout from './Callout.vue';

const meta = {
  title: 'Components/Feedback/Callout',
  component: Callout,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own inline notice with a tone, optional actions and a close button.',
          '',
          '- Use padding 12/16, radius 16 and an icon of 20.',
          '- Offer tones `info`, `warning` (`--vr-away`), `danger` and `accent` (for suggestions).',
          '- Use a title of 14/600 and text of 13 in `--vr-text-2`.',
          '- Use sm buttons for actions, and an IconButton 28 to close.',
          '- Use the pill layout for a compact notice with a status dot and an inline xs action.'
        ].join('\n')
      }
    }
  },
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

export const Pill: Story = {
  args: { layout: 'pill', tone: 'accent', text: '' },
  parameters: { layout: 'centered' },
  render: (args) => ({
    components: { Button, Callout },
    setup: () => ({ args }),
    template: `<Callout v-bind="args" role="status">
      <template #actions><Button variant="primary" size="xs" pill>Обновить</Button></template>
    </Callout>`
  })
};

export const PillWithNote: Story = {
  args: { layout: 'pill', tone: 'accent', text: 'после звонка' },
  parameters: { layout: 'centered' }
};
