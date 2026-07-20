import assert from "node:assert/strict";

class TestEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.cancelable = Boolean(options.cancelable);
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, options);
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
}

class TestKeyboardEvent extends TestEvent {
  constructor(type, options = {}) {
    super(type, options);
    this.key = options.key || "";
  }
}

class TestNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(typeof node === "string" ? this.ownerDocument.createTextNode(node) : node);
  }

  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [this.ownerDocument.createTextNode(String(value))];
  }
}

class TestText extends TestNode {
  constructor(ownerDocument, value) {
    super(ownerDocument);
    this.nodeType = 3;
    this.value = String(value);
  }

  get textContent() {
    return this.value;
  }

  set textContent(value) {
    this.value = String(value);
  }
}

class TestElement extends TestNode {
  constructor(ownerDocument, tagName) {
    super(ownerDocument);
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.eventListeners = new Map();
    this.style = {};
    this.dataset = {};
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === "id") this.id = stringValue;
    if (name === "tabindex") this.tabIndex = Number(stringValue);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    listeners.push(listener);
    this.eventListeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.eventListeners.set(type, (this.eventListeners.get(type) || []).filter((value) => value !== listener));
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const listener of this.eventListeners.get(event.type) || []) listener.call(this, event);
    if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }

  focus() {
    this.ownerDocument.activeElement = this;
    this.dispatchEvent(new TestEvent("focus"));
  }

  click() {
    this.dispatchEvent(new TestEvent("click", { bubbles: true, cancelable: true }));
  }

  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) return attr[2] === undefined ? this.hasAttribute(attr[1]) : this.getAttribute(attr[1]) === attr[2];
    const id = selector.match(/^#([A-Za-z0-9_-]+)$/);
    if (id) return this.getAttribute("id") === id[1];
    const tagAttr = selector.match(/^([a-z0-9-]+)\[([^=\]]+)(?:="([^"]*)")?\]$/i);
    if (tagAttr) return this.tagName.toLowerCase() === tagAttr[1].toLowerCase()
      && (tagAttr[3] === undefined ? this.hasAttribute(tagAttr[2]) : this.getAttribute(tagAttr[2]) === tagAttr[3]);
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) matches.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return this.__rect || { x: 0, y: 0, width: 100, height: 30, top: 0, left: 0, right: 100, bottom: 30 };
  }

  setTestRect(rect) {
    this.__rect = { top: rect.y ?? rect.top ?? 0, left: rect.x ?? rect.left ?? 0, right: rect.right ?? 0, bottom: rect.bottom ?? 0, ...rect };
  }
}

class TestDocument extends TestElement {
  constructor() {
    super(null, "#document");
    this.ownerDocument = this;
    this.documentElement = new TestElement(this, "html");
    this.body = new TestElement(this, "body");
    this.documentElement.appendChild(this.body);
    this.childNodes = [this.documentElement];
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new TestElement(this, tagName);
  }

  createTextNode(value) {
    return new TestText(this, value);
  }

  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
}

export function installDomRuntime({ reducedMotion = true } = {}) {
  const document = new TestDocument();
  const window = {
    document,
    Event: TestEvent,
    KeyboardEvent: TestKeyboardEvent,
    HTMLElement: TestElement,
    Node: TestNode,
    getComputedStyle: () => ({}),
    matchMedia: (query) => ({
      media: query,
      matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
      addEventListener() {},
      removeEventListener() {}
    })
  };
  Object.assign(globalThis, {
    document,
    window,
    Event: TestEvent,
    KeyboardEvent: TestKeyboardEvent,
    HTMLElement: TestElement,
    Node: TestNode,
    getComputedStyle: window.getComputedStyle,
    matchMedia: window.matchMedia
  });
  return { window, document, cleanup: () => document.body.childNodes.splice(0) };
}

export function assertRenderedContainer(container) {
  assert.ok(container instanceof TestElement, "fixture must render into a DOM container");
  assert.ok(container.childNodes.length > 0, "fixture must render at least one DOM node");
}
