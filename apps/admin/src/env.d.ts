// For plain TypeScript tools. vue-tsc checks the actual component props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
