// What SvelteKit's `updated` did: poll /_app/version.json and say once the
// deployed build differs from the one running here. The file is written by
// versionFilePlugin (scripts/deploy-contract.ts) with the same build id that
// vite.config.ts compiles in as __APP_VERSION__.

export interface VersionCheckOptions {
  /** The build id of the running app. */
  version: string;
  /** Called once, when a newer build is found. */
  onUpdated: () => void;
  /** Between two polls; 0 polls only on `check()`. */
  interval: number;
  url?: string;
  /** A dev server writes no version file: nothing is ever checked. */
  enabled?: boolean;
}

export interface VersionCheck {
  /** Asks now; answers whether a newer build is out. */
  check(): Promise<boolean>;
  stop(): void;
}

export function createVersionCheck({
  version,
  onUpdated,
  interval,
  url = '/_app/version.json',
  enabled = true
}: VersionCheckOptions): VersionCheck {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let updated = false;

  function schedule(): void {
    clearTimeout(timeout);
    if (interval && !updated) timeout = setTimeout(() => void check(), interval);
  }

  async function check(): Promise<boolean> {
    if (!enabled) return false;
    if (updated) return true;
    schedule();
    try {
      const response = await fetch(url, { headers: { pragma: 'no-cache', 'cache-control': 'no-cache' } });
      if (!response.ok) return false;
      const data: unknown = await response.json();
      const deployed = typeof data === 'object' && data !== null && 'version' in data ? data.version : undefined;
      if (deployed === version) return false;
      updated = true;
      clearTimeout(timeout);
      onUpdated();
      return true;
    } catch {
      return false;
    }
  }

  if (enabled) schedule();

  return {
    check,
    stop: () => clearTimeout(timeout)
  };
}
