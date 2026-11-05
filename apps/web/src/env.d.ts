// Plain TypeScript (ESLint's typed rules, type-coverage) cannot read a .vue
// file, so an import of one falls back to this declaration there. vue-tsc
// resolves the component itself and checks its real props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}

interface ImportMetaEnv {
  /** The build id, the same one /_app/version.json carries (vite.config.ts). */
  readonly VITE_APP_VERSION: string;
  /** Content hash of the audio files under public/ (scripts/deploy-contract.ts). */
  readonly VITE_VOICE_ASSET_VERSION: string;
}
