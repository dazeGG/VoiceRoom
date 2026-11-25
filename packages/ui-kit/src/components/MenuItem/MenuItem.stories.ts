import type { Meta, StoryObj } from '@storybook/vue3-vite';
import Button from '../Button/Button.vue';
import DropdownMenu from '../DropdownMenu/DropdownMenu.vue';
import MenuItem from './MenuItem.vue';

const meta = {
  title: 'Components/Overlays/MenuItem',
  component: MenuItem,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'A selectable action row shared by dropdown and context menus.',
          '',
          '- Set `label` for the accessible name and typeahead. Add `description` for a two-line row, an icon slot or a `shortcut` when available.',
          '- Use `hint` for trailing context while keeping the label available for typeahead and a shortcut available in its own position.',
          '- Use the `friendly`, `accent` or `danger` tone when the action warrants it, and use `disabled` for an unavailable action.',
          '- Handle `select` so the action works from the keyboard and pointer.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Скопировать ссылку', shortcut: 'Ctrl+C' },
  render: (args) => ({
    components: { MenuItem, Button, DropdownMenu },
    setup: () => ({ args }),
    template: `<DropdownMenu aria-label="Действия с комнатой">
        <template #trigger><Button>Действия</Button></template>
        <template #content><MenuItem v-bind="args" /></template>
      </DropdownMenu>`
  })
} satisfies Meta<typeof MenuItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Destructive: Story = { args: { label: 'Удалить комнату', tone: 'danger' } };
export const Disabled: Story = { args: { disabled: true } };
export const Call: Story = { args: { label: 'Позвонить', shortcut: '' } };
export const Offline: Story = { args: { ...Call.args, hint: 'не в сети' } };
export const LeaveRoom: Story = { args: { ...Call.args, hint: 'Вы покинете «Вечерний созвон»' } };
export const ReturnToCall: Story = { args: { label: 'Вернуться в звонок', shortcut: '', tone: 'accent' } };
