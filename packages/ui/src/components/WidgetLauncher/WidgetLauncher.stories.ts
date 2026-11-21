import type { Meta, StoryObj } from '@storybook/vue3-vite';
import { h, onMounted, useTemplateRef } from 'vue';
import { createWidgetLauncher } from './widget-launcher';

const meta = {
  title: 'Components/Actions/WidgetLauncher',
  tags: ['autodocs'],
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
