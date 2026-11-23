import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { h, onMounted, useTemplateRef } from 'vue';
import { createWidgetLauncher } from './widget-launcher';

const meta = {
  title: 'Components/Actions/WidgetLauncher',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: [
          'The button in a host page that opens and collapses a floating VoiceRoom widget.',
          '',
          '- Create it in the host document with `createWidgetLauncher` and the embed’s background, text and accent.',
          '- Use it for floating placement. The factory hides its element for an inline widget.',
          '- Wire its click to the embed toggle, call `setExpanded` to update `aria-expanded` and use `setInCall` to show the active-call label.'
        ].join('\n')
      }
    }
  },
  render: () => ({
    setup() {
      const host = useTemplateRef<HTMLElement>('host');
      onMounted(() => {
        const launcher = createWidgetLauncher({
          floating: true,
          background: '#181918',
          text: '#f0f1e8',
          accent: '#c1f100'
        });
        let expanded = true;
        launcher.element.addEventListener('click', () => {
          expanded = !expanded;
          launcher.setExpanded(expanded);
          launcher.setInCall(!expanded);
        });
        host.value?.append(launcher.element);
      });
      return () => h('div', { ref: 'host' });
    }
  })
} satisfies Meta;
export default meta;

export const Floating: StoryObj<typeof meta> = {};
