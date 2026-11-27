import type { Meta, StoryObj } from '@storybook/vue3-vite';

import SafetyCode from './SafetyCode.vue';

const meta = {
  title: 'Components/Feedback/SafetyCode',
  component: SafetyCode,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The emoji code two people compare to check that nobody sits between them, as in an end-to-end encrypted call.',
          '',
          '- Show it where the protection is explained, never as a toast.',
          '- Each emoji has its name under it, so people can read the code to each other aloud.',
          '- The order matters: keep the items in the order the protocol gives them.',
          '- Give the list a `label` that says what the code is for.',
          '- A name never breaks inside a word, so give the code at least 328 px: a wide Popover holds four columns.'
        ].join('\n')
      }
    }
  },
  args: {
    label: 'Код проверки звонка',
    items: [
      { emoji: '🦊', name: 'лиса' },
      { emoji: '🍉', name: 'арбуз' },
      { emoji: '🚀', name: 'ракета' },
      { emoji: '🐢', name: 'черепаха' }
    ]
  }
} satisfies Meta<typeof SafetyCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FourEmoji: Story = {};
export const LongNames: Story = {
  args: {
    items: [
      { emoji: '🐞', name: 'божья коровка' },
      { emoji: '🍁', name: 'кленовый лист' },
      { emoji: '⏰', name: 'будильник' },
      { emoji: '🚲', name: 'велосипед' }
    ]
  }
};
