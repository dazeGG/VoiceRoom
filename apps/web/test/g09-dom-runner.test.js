import assert from "node:assert/strict";
import test from "node:test";

import { installDomRuntime } from "./setup/dom-runtime.js";
import { renderSvelte } from "./setup/render-svelte.js";
import {
  assertAccessibleName,
  assertFocusOrder,
  assertKeyboardActivation,
  assertLiveRegion,
  assertReducedMotionEnabled,
  assertStableLayout
} from "./setup/a11y-assertions.js";

function accessibleDialogFixture({ target }) {
  const dialog = document.createElement("section");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", "dialog-title");
  dialog.setTestRect({ x: 0, y: 0, width: 320, height: 200 });

  const title = document.createElement("h2");
  title.setAttribute("id", "dialog-title");
  title.textContent = "Room settings";

  const mute = document.createElement("button");
  mute.setAttribute("aria-label", "Mute microphone");
  let muted = false;
  mute.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") muted = true;
  });

  const close = document.createElement("button");
  close.textContent = "Close";

  const live = document.createElement("p");
  live.setAttribute("aria-live", "polite");
  live.textContent = "Ready";

  dialog.append(title, mute, close, live);
  target.appendChild(dialog);
  return { muted: () => muted };
}

test("G09-A01 rendered DOM runner proves focus, keyboard, names, live regions, reduced motion, layout and cleanup", async () => {
  const runtime = installDomRuntime({ reducedMotion: true });
  const rendered = await renderSvelte(accessibleDialogFixture);
  const dialog = rendered.container.querySelector("[role=\"dialog\"]");
  const mute = rendered.container.querySelector("[aria-label=\"Mute microphone\"]");

  assertAccessibleName(dialog, "Room settings");
  assertFocusOrder(rendered.container, ["Mute microphone", "Close"]);
  assertKeyboardActivation(mute, "Enter", rendered.instance.muted);
  assertLiveRegion(rendered.container, "Ready");
  assertReducedMotionEnabled();
  assertStableLayout(dialog, () => mute.focus());

  rendered.cleanup();
  assert.equal(document.body.childNodes.length, 0);
  runtime.cleanup();
});

test("G09-A02 rejects source-regex-only and invalid ARIA fixtures", async () => {
  installDomRuntime();
  await assert.rejects(
    () => renderSvelte("<button aria-label=\"Mute microphone\">x</button>"),
    /must pass a component function/i
  );

  await assert.rejects(
    () => renderSvelte(() => undefined),
    /render at least one DOM node/i
  );

  const rendered = await renderSvelte(({ target }) => {
    const button = document.createElement("button");
    button.textContent = "   ";
    target.appendChild(button);
  });
  assert.throws(() => assertAccessibleName(rendered.container.querySelector("button"), "Submit"), /Expected values/);
  rendered.cleanup();
});
