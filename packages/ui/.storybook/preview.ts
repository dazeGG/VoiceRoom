import type { Preview } from '@storybook/vue3-vite';
import './preview.scss';

const themes = ['graphite-volt', 'graphite-ice', 'graphite-coral'] as const;

function applyTheme(globals: Record<string, unknown>): void {
  const theme = themes.find((id) => id === globals.theme) ?? 'graphite-volt';
  const root = document.documentElement;
  root.classList.remove(...Array.from(root.classList).filter((name) => name.startsWith('theme--')));
  root.classList.add(`theme--${theme}`);
  root.lang = 'ru';
}

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Тема интерфейса',
      toolbar: {
        title: 'Тема',
        icon: 'paintbrush',
        items: [...themes],
        dynamicTitle: true
      }
    }
  },
  initialGlobals: { theme: 'graphite-volt' },
  decorators: [
    (story, context) => {
      applyTheme(context.globals);
      return story();
    }
  ],
  parameters: {
    backgrounds: { disable: true },
    layout: 'centered',
    a11y: { test: 'error' }
  }
};

export default preview;
