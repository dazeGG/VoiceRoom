// Plain TypeScript (ESLint and type-coverage) cannot read Vue SFCs.
// vue-tsc resolves each component itself and checks its actual props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}
