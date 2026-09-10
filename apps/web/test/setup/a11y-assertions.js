import assert from "node:assert/strict";

const FOCUSABLE = "button,a[href],input,select,textarea,[tabindex]";

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function accessibleName(element, root = document) {
  if (element.getAttribute("aria-label")) return text(element.getAttribute("aria-label"));
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    return text(labelledBy.split(/\s+/).map((id) => root.getElementById(id)?.textContent).filter(Boolean).join(" "));
  }
  return text(element.textContent);
}

export function assertAccessibleName(element, expected, root = document) {
  assert.equal(accessibleName(element, root), expected);
}

export function assertFocusOrder(container, expectedNames) {
  const actual = container.querySelectorAll(FOCUSABLE)
    .filter((element) => element.getAttribute("disabled") === null && element.getAttribute("tabindex") !== "-1")
    .map((element) => accessibleName(element, container.ownerDocument));
  assert.deepEqual(actual, expectedNames);
}

export function assertKeyboardActivation(element, key, didActivate) {
  element.focus();
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  assert.equal(didActivate(), true, `${key} must activate ${accessibleName(element)}`);
}

export function assertLiveRegion(container, expectedText) {
  const region = container.querySelector("[aria-live]");
  assert.ok(region, "live region is required");
  assert.notEqual(region.getAttribute("aria-live"), "off");
  assert.equal(text(region.textContent), expectedText);
}

export function assertReducedMotionEnabled() {
  assert.equal(matchMedia("(prefers-reduced-motion: reduce)").matches, true);
}

export function assertStableLayout(element, mutate, tolerance = 0) {
  const before = element.getBoundingClientRect();
  mutate();
  const after = element.getBoundingClientRect();
  for (const key of ["x", "y", "width", "height"]) {
    assert.ok(Math.abs((before[key] || 0) - (after[key] || 0)) <= tolerance, `${key} shifted after interaction`);
  }
}
