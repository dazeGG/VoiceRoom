import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import { assertRenderedContainer } from "./dom-runtime.ts";

type Fixture = { $destroy?: () => void; destroy?: () => void } | null | undefined;
type Factory = (input: { target: HTMLElement; props: Record<string, unknown> }) => Fixture | Promise<Fixture>;

export async function renderSvelte(
  component: Factory | string | { default?: Factory | Fixture },
  props: Record<string, unknown> = {},
  options: { target?: HTMLElement } = {}
) {
  const target = options.target || document.createElement("div");
  document.body.appendChild(target);
  let instance: Fixture;

  if (typeof component === "function") {
    instance = await component({ target, props });
  } else if (typeof component === "string") {
    throw new Error("G09 rendered-DOM fixtures must pass a component function or module path, not source text");
  } else if (component?.default) {
    const factory = component.default;
    instance = typeof factory === "function" ? await factory({ target, props }) : factory;
  } else {
    throw new Error("Unsupported Svelte fixture shape");
  }

  assertRenderedContainer(target);
  return {
    container: target,
    instance,
    cleanup() {
      if (instance && typeof instance.$destroy === "function") instance.$destroy();
      if (instance && typeof instance.destroy === "function") instance.destroy();
      target.remove();
    }
  };
}

export async function renderSvelteModule(modulePath: string, props: Record<string, unknown> = {}, options: { target?: HTMLElement } = {}) {
  assert.equal(typeof modulePath, "string", "modulePath must be a string");
  const module = await import(pathToFileURL(modulePath).href);
  return renderSvelte(module, props, options);
}
