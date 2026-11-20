// Plain TypeScript (ESLint and type-coverage) cannot load Vue single-file components.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
