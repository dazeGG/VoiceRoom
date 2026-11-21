import type { Meta, StoryObj } from '@storybook/vue3-vite';
import StoryIcon from '../../../.storybook/StoryIcon.vue';

import IconButton from './IconButton.vue';

const meta = {
  title: 'Components/Actions/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'Own icon-only button that always has a Tooltip.',
          '',
          '- Use sizes 24, 28, 32 (the default), 40 and 44.',
          '- Use 24 inside rows and fields.',
          '- Use 28 in message toolbars and tags.',
          '- Use 32 to close a dialog and for actions in headers.',
          '- Use 40 next to md buttons.',
          '- Use 44 on the phone and in the dock.',
          '- Offer a transparent variant as the default, plus `filled` (`--vr-surface-3`), `outline`, `soft`, `primary` and `danger`.',
          '- Set `aria-pressed` when it is pressed, and `aria-expanded` when its menu is open.',
          '- Require `aria-label`, and make it match the Tooltip text.',
          '- Do not use the `title` attribute.'
        ].join('\n')
      }
    }
  },
  args: { label: 'Выключить микрофон', size: 32, variant: 'default', tooltip: true, disabled: false },
  argTypes: {
    size: { control: 'inline-radio', options: [24, 28, 32, 40, 44] },
    variant: { control: 'select', options: ['default', 'filled', 'outline', 'soft', 'primary', 'danger'] }
  },
  render: (args) => ({
    components: { IconButton, StoryIcon },
    setup: () => ({ args }),
    template: '<IconButton v-bind="args"><StoryIcon name="mic" /></IconButton>'
  })
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Filled: Story = { args: { variant: 'filled' } };
export const Outline: Story = { args: { variant: 'outline' } };
export const Soft: Story = { args: { variant: 'soft' } };
export const Primary: Story = { args: { variant: 'primary' } };
export const Danger: Story = { args: { variant: 'danger' } };
export const Size24: Story = { args: { size: 24 } };
export const Size28: Story = { args: { size: 28 } };
export const Size32: Story = { args: { size: 32 } };
export const Size40: Story = { args: { size: 40 } };
export const Size44: Story = { args: { size: 44 } };
export const Disabled: Story = { args: { disabled: true } };
export const WithShortcut: Story = { args: { shortcut: ['Ctrl', 'M'] } };
export const WithoutTooltip: Story = { args: { tooltip: false } };
export const Pressed: Story = {
  render: (args) => ({
    components: { IconButton, StoryIcon },
    setup: () => ({ args }),
    template: '<IconButton v-bind="args" aria-pressed="true"><StoryIcon name="mic" /></IconButton>'
  })
};
export const Expanded: Story = {
  render: (args) => ({
    components: { IconButton, StoryIcon },
    setup: () => ({ args }),
    template: '<IconButton v-bind="args" aria-expanded="true"><StoryIcon name="mic" /></IconButton>'
  })
};

export const Unread: Story = { args: { dot: true } };
export const NeutralExpanded: Story = {
  ...Expanded,
  args: { neutralExpanded: true }
};
export const Scrim: Story = { args: { scrim: true, pill: true } };
export const Link: Story = { args: { href: '#rooms' } };
