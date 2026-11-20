// Plain TypeScript (ESLint's typed rules, type-coverage) cannot read a .vue
// file, so an import of one falls back to this declaration there. vue-tsc
// resolves the component itself and checks its real props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}

interface ImportMetaEnv {
  /** Opaque web build id, also carried by /_app/version.json (vite.config.ts). */
  readonly VITE_APP_VERSION: string;
}
