<script lang="ts">
  // A message field that shows emoji as the same artwork as the picker and the
  // messages, the way Discord's composer does. A textarea cannot hold images,
  // so this is a contenteditable box whose DOM is only ever text nodes and
  // emoji images; the value it hands out is plain text, exactly as a textarea
  // would, so drafts, mentions and sending do not change.
  //
  // The DOM is rebuilt only when what is shown no longer matches the text —
  // an emoji was typed or pasted, or the value was set from outside — so plain
  // typing keeps the browser's own undo history.
  import { untrack } from 'svelte';
  import { insertIntoDraft } from './composer-insert';
  import { emojiAssetUrl } from './emoji-asset';
  import { splitEmoji } from './emoji-text';

  interface TextSelection {
    start: number;
    end: number;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    ariaLabel = '',
    maxlength = Number.POSITIVE_INFINITY,
    disabled = false,
    class: className = '',
    onkeydown,
    oninput,
    oncompositionstart,
    oncompositionend
  }: {
    value?: string;
    placeholder?: string;
    ariaLabel?: string;
    maxlength?: number;
    disabled?: boolean;
    class?: string;
    onkeydown?: (event: KeyboardEvent) => void;
    oninput?: () => void;
    oncompositionstart?: () => void;
    oncompositionend?: () => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);
  let composing = false;
  // What the DOM shows right now, so an outside change to `value` can be told
  // apart from the echo of our own input.
  let rendered = '';
  // Where the caret was last seen inside the field. Opening the emoji picker
  // moves focus away; the emoji still belongs where the person was writing.
  let lastSelection: TextSelection | null = null;

  const EMOJI_CLASS = 'composer-emoji';

  function isTrailingBreak(node: Node | undefined | null): boolean {
    return node instanceof HTMLBRElement && node.dataset.trailing !== undefined;
  }

  function serialize(node: Node): string {
    let text = '';
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue ?? '';
      else if (child instanceof HTMLImageElement) text += child.dataset.text ?? child.alt ?? '';
      else if (child instanceof HTMLBRElement) text += isTrailingBreak(child) ? '' : '\n';
      else if (child instanceof HTMLElement) {
        // A browser that wraps a new line in a block starts it on its own line.
        if ((child.tagName === 'DIV' || child.tagName === 'P') && text && !text.endsWith('\n')) text += '\n';
        text += serialize(child);
      }
    }
    return text;
  }

  function render(text: string): void {
    if (!root) return;
    const fragment = document.createDocumentFragment();
    for (const part of splitEmoji(text)) {
      if (part.kind === 'text') {
        fragment.append(document.createTextNode(part.text));
        continue;
      }
      const image = document.createElement('img');
      image.className = EMOJI_CLASS;
      image.src = emojiAssetUrl(part.emoji);
      image.alt = part.text;
      image.draggable = false;
      image.dataset.text = part.text;
      fragment.append(image);
    }
    // An empty last line needs something after the break to show and to hold
    // the caret; it is not part of the text.
    if (text.endsWith('\n')) {
      const trailing = document.createElement('br');
      trailing.dataset.trailing = '';
      fragment.append(trailing);
    }
    root.replaceChildren(fragment);
    rendered = text;
  }

  /** The DOM matches `text` when its images are exactly the emoji `text` holds. */
  function showsText(text: string): boolean {
    if (!root) return false;
    const nodes = Array.from(root.childNodes);
    const trailing = isTrailingBreak(nodes.at(-1));
    if (trailing !== text.endsWith('\n')) return false;
    const shown: string[] = [];
    for (const node of trailing ? nodes.slice(0, -1) : nodes) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node instanceof HTMLImageElement && node.dataset.text) {
        shown.push(node.dataset.text);
        continue;
      }
      return false;
    }
    const expected = splitEmoji(text)
      .filter((part) => part.kind === 'emoji')
      .map((part) => part.text);
    return expected.length === shown.length && expected.every((emoji, index) => emoji === shown[index]);
  }

  function offsetOf(container: Node, offset: number): number {
    if (!root) return 0;
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEnd(container, offset);
    return serialize(range.cloneContents()).length;
  }

  function nodeLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.length ?? 0;
    if (node instanceof HTMLImageElement) return (node.dataset.text ?? node.alt ?? '').length;
    if (node instanceof HTMLBRElement) return isTrailingBreak(node) ? 0 : 1;
    return serialize(node).length;
  }

  function pointAt(target: number): { node: Node; offset: number } | null {
    if (!root) return null;
    const nodes = Array.from(root.childNodes);
    let remaining = Math.max(0, target);
    for (const [index, node] of nodes.entries()) {
      if (isTrailingBreak(node)) return { node: root, offset: index };
      const length = nodeLength(node);
      if (node.nodeType === Node.TEXT_NODE && remaining <= length) return { node, offset: remaining };
      if (node.nodeType !== Node.TEXT_NODE && remaining < length) {
        // Never inside an emoji: before it at its start, after it otherwise.
        return { node: root, offset: remaining === 0 ? index : index + 1 };
      }
      remaining -= length;
    }
    return { node: root, offset: nodes.length - (isTrailingBreak(nodes.at(-1)) ? 1 : 0) };
  }

  function selectionInside(): TextSelection | null {
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    return {
      start: offsetOf(range.startContainer, range.startOffset),
      end: offsetOf(range.endContainer, range.endOffset)
    };
  }

  export function focus(): void {
    root?.focus();
  }

  /** The caret or selection as offsets into the text; the end when the field has none. */
  export function getSelection(): TextSelection {
    const inside = selectionInside();
    if (inside) return inside;
    return lastSelection ?? { start: value.length, end: value.length };
  }

  export function setSelection(start: number, end = start): void {
    const from = pointAt(start);
    const to = pointAt(end);
    const selection = document.getSelection();
    if (!from || !to || !selection) return;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    lastSelection = { start: Math.min(start, value.length), end: Math.min(end, value.length) };
  }

  /** Puts text where the caret was, replacing a selection, like typing it. */
  export function insertText(text: string): boolean {
    if (!root || disabled) return false;
    const current = serialize(root);
    const inserted = insertIntoDraft(current, text, getSelection(), maxlength);
    if (!inserted) return false;
    render(inserted.text);
    value = inserted.text;
    root.focus();
    setSelection(inserted.caret);
    oninput?.();
    return true;
  }

  function sync(): void {
    if (!root || composing) return;
    let text = serialize(root);
    let selection = selectionInside();
    if (text.length > maxlength) {
      text = text.slice(0, maxlength);
      selection = selection && {
        start: Math.min(selection.start, text.length),
        end: Math.min(selection.end, text.length)
      };
    }
    if (!showsText(text) || text !== serialize(root)) {
      render(text);
      if (selection) setSelection(selection.start, selection.end);
    } else {
      rendered = text;
    }
    if (selection) lastSelection = selection;
    if (value !== text) value = text;
    oninput?.();
  }

  function onBeforeInput(event: InputEvent): void {
    if (event.inputType.startsWith('format')) {
      event.preventDefault();
      return;
    }
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault();
      insertText('\n');
      return;
    }
    if (
      (event.inputType === 'insertText' || event.inputType === 'insertReplacementText') &&
      event.data &&
      !event.isComposing
    ) {
      const selection = selectionInside() ?? { start: value.length, end: value.length };
      if (value.length - (selection.end - selection.start) + event.data.length > maxlength) event.preventDefault();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    onkeydown?.(event);
    if (event.defaultPrevented || event.isComposing) return;
    // Rich-text shortcuts would add markup the message cannot carry.
    if ((event.ctrlKey || event.metaKey) && ['b', 'i', 'u'].includes(event.key.toLowerCase())) event.preventDefault();
  }

  function onPaste(event: ClipboardEvent): void {
    // Always plain text: pasted markup or pictures never land in the field.
    // An image in the clipboard is left to the attachment handler around it.
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (text) insertText(text.replace(/\r\n?/g, '\n'));
  }

  function onDrop(event: DragEvent): void {
    if (event.dataTransfer?.files.length) return;
    event.preventDefault();
    const text = event.dataTransfer?.getData('text/plain') ?? '';
    if (text) insertText(text.replace(/\r\n?/g, '\n'));
  }

  function copySelection(event: ClipboardEvent, cut: boolean): void {
    const selection = document.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    // Emoji images copy as the characters they stand for.
    event.preventDefault();
    event.clipboardData?.setData('text/plain', serialize(range.cloneContents()));
    if (cut && !disabled) {
      range.deleteContents();
      sync();
    }
  }

  // An outside change — sending clears the field, a draft or a mention is put
  // back — is drawn; our own input already is.
  $effect(() => {
    const next = value;
    untrack(() => {
      if (!root || next === rendered) return;
      const focused = document.activeElement === root;
      render(next);
      lastSelection = null;
      if (focused) setSelection(next.length);
    });
  });

  $effect(() => {
    const remember = () => {
      const inside = selectionInside();
      if (inside) lastSelection = inside;
    };
    document.addEventListener('selectionchange', remember);
    return () => document.removeEventListener('selectionchange', remember);
  });
</script>

<div
  bind:this={root}
  class={`emoji-composer ${className}`.trim()}
  role="textbox"
  tabindex={disabled ? -1 : 0}
  contenteditable={disabled ? 'false' : 'true'}
  aria-multiline="true"
  aria-label={ariaLabel || placeholder || undefined}
  aria-placeholder={placeholder || undefined}
  aria-disabled={disabled || undefined}
  {placeholder}
  data-empty={value ? undefined : ''}
  spellcheck="true"
  onbeforeinput={onBeforeInput}
  oninput={sync}
  onkeydown={onKeydown}
  onpaste={onPaste}
  ondrop={onDrop}
  oncopy={(event) => copySelection(event, false)}
  oncut={(event) => copySelection(event, true)}
  oncompositionstart={() => {
    composing = true;
    oncompositionstart?.();
  }}
  oncompositionend={() => {
    composing = false;
    sync();
    oncompositionend?.();
  }}
></div>

<style>
  .emoji-composer {
    position: relative;
    overflow-y: auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    cursor: text;
  }

  .emoji-composer[contenteditable='false'] {
    cursor: default;
  }

  /* The placeholder is drawn over the empty field rather than put into it, so
     it is never part of the text and the caret starts at the very beginning. */
  .emoji-composer[data-empty]::before {
    position: absolute;
    content: attr(placeholder);
    color: var(--composer-placeholder, #6f6a5c);
    pointer-events: none;
  }

  .emoji-composer :global(img.composer-emoji) {
    width: 1.375em;
    height: 1.375em;
    margin: 0 0.05em 0 0.1em;
    vertical-align: -0.3em;
    user-select: all;
  }
</style>
