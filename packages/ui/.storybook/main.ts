import type { StorybookConfig } from '@storybook/vue3-vite';
import vue from '@vitejs/plugin-vue';
import { NodePackageImporter } from 'sass';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: '@storybook/vue3-vite',
  stories: ['../src/**/*.stories.ts', '../src/**/*.mdx', '../../call/src/views/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  viteFinal(config) {
    return mergeConfig(config, {
      plugins: [vue()],
      css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter()] } } }
    });
  }
};

export default config;
