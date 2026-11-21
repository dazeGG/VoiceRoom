import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/vue3-vite';
import vue from '@vitejs/plugin-vue';
import { NodePackageImporter } from 'sass';
import { mergeConfig } from 'vite';

const config: StorybookConfig = {
  framework: '@storybook/vue3-vite',
  stories: [
    '../src/**/*.stories.ts',
    '../src/**/*.mdx',
    '../../call/src/views/**/*.stories.ts',
    '../../../apps/meet/src/**/*.stories.ts'
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  viteFinal(config) {
    return mergeConfig(config, {
      plugins: [vue()],
      resolve: { alias: { '@': fileURLToPath(new URL('../../../apps/meet/src', import.meta.url)) } },
      css: { preprocessorOptions: { scss: { importers: [new NodePackageImporter()] } } }
    });
  }
};

export default config;
