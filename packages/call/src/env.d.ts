// Plain TypeScript (ESLint and type-coverage) cannot read Vue SFCs.
// vue-tsc resolves each component itself and checks its actual props.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent;
  export default component;
}

// Vite bundles the LiveKit E2EE worker and hands back its constructor.
declare module 'livekit-client/e2ee-worker?worker' {
  const E2eeWorker: new () => Worker;
  export default E2eeWorker;
}
