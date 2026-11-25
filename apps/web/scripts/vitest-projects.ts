import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig, type ViteUserConfig } from 'vitest/config';
import { buildVersion } from './deploy-contract.ts';

export function testProjects(nodeFiles: string[]): NonNullable<ViteUserConfig['test']> {
  return {
    testTimeout: 20000,
    unstubGlobals: true,
    projects: [
      { test: { name: 'node', environment: 'node', include: nodeFiles } },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...nodeFiles],
          setupFiles: [fileURLToPath(new URL('../test/setup.ts', import.meta.url))]
        }
      }
    ]
  };
}

// Package suites still exercise the original Web adapters, mocks and harnesses.
export function packageTestConfig() {
  return defineConfig({
    plugins: [vue()],
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(buildVersion()) },
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    test: testProjects(['test/node/**/*.test.ts'])
  });
}
