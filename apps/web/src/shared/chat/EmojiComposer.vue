<script setup lang="ts">
// A message field that shows emoji as the same artwork as the picker and the
// messages, the way Discord's composer does. A textarea cannot hold images,
// so this is a contenteditable box whose DOM is only ever text nodes and
// emoji images; the value it hands out is plain text, exactly as a textarea
// would, so drafts, mentions and sending do not change.
//
// The DOM is rebuilt only when what is shown no longer matches the text —
// an emoji was typed or pasted, or the value was set from outside — so plain
// typing keeps the browser's own undo history.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { TextSelection } from './composer-handle';
import { insertIntoDraft } from './composer-insert';
import { emojiAssetUrl } from './emoji-asset';
import { splitEmoji } from './emoji-text';

const {
  placeholder = '',
  ariaLabel = '',
  maxlength = Number.POSITIVE_INFINITY,
  disabled
} = defineProps<{
  placeholder?: string;
  ariaLabel?: string;
  maxlength?: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  keydown: [event: KeyboardEvent];
  input: [];
  compositionstart: [];
  compositionend: [];
}>();

const value = defineModel<string>({ default: '' });

const root = ref<HTMLDivElement | null>(null);
let composing = false;
// What the DOM shows right now, so an outside change to `value` can be told
// apart from the echo of our own input.
let rendered = '';
// Where the caret was last seen inside the field. Opening the emoji picker
// moves focus away; the emoji still belongs where the person was writing.
let lastSelection: TextSelection | null = null;

const EMOJI_CLASS = 'emoji-composer__emoji';

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
  if (!root.value) return;
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
  root.value.replaceChildren(fragment);
  rendered = text;
}

/** The DOM matches `text` when its images are exactly the emoji `text` holds. */
function showsText(text: string): boolean {
  if (!root.value) return false;
  const nodes = Array.from(root.value.childNodes);
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
  if (!root.value) return 0;
  const range = document.createRange();
  range.setStart(root.value, 0);
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
  if (!root.value) return null;
  const nodes = Array.from(root.value.childNodes);
  let remaining = Math.max(0, target);
  for (const [index, node] of nodes.entries()) {
    if (isTrailingBreak(node)) return { node: root.value, offset: index };
    const length = nodeLength(node);
    if (node.nodeType === Node.TEXT_NODE && remaining <= length) return { node, offset: remaining };
    if (node.nodeType !== Node.TEXT_NODE && remaining < length) {
      // Never inside an emoji: before it at its start, after it otherwise.
      return { node: root.value, offset: remaining === 0 ? index : index + 1 };
    }
    remaining -= length;
  }
  return { node: root.value, offset: nodes.length - (isTrailingBreak(nodes.at(-1)) ? 1 : 0) };
}

function selectionInside(): TextSelection | null {
  const selection = document.getSelection();
  if (!root.value || !selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.value.contains(range.startContainer) || !root.value.contains(range.endContainer)) return null;
  return {
    start: offsetOf(range.startContainer, range.startOffset),
    end: offsetOf(range.endContainer, range.endOffset)
  };
}

function focus(): void {
  root.value?.focus();
}

/** The caret or selection as offsets into the text; the end when the field has none. */
function getSelection(): TextSelection {
  const inside = selectionInside();
  if (inside) return inside;
  return lastSelection ?? { start: value.value.length, end: value.value.length };
}

function setSelection(start: number, end = start, length = value.value.length): void {
  const from = pointAt(start);
  const to = pointAt(end);
  const selection = document.getSelection();
  if (!from || !to || !selection) return;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  lastSelection = { start: Math.min(start, length), end: Math.min(end, length) };
}

/** Puts text where the caret was, replacing a selection, like typing it. */
function insertText(text: string): boolean {
  if (!root.value || disabled) return false;
  const current = serialize(root.value);
  const inserted = insertIntoDraft(current, text, getSelection(), maxlength);
  if (!inserted) return false;
  render(inserted.text);
  value.value = inserted.text;
  root.value.focus();
  setSelection(inserted.caret, inserted.caret, inserted.text.length);
  emit('input');
  return true;
}

function sync(): void {
  if (!root.value || composing) return;
  let text = serialize(root.value);
  let selection = selectionInside();
  if (text.length > maxlength) {
    text = text.slice(0, maxlength);
    selection = selection && {
      start: Math.min(selection.start, text.length),
      end: Math.min(selection.end, text.length)
    };
  }
  if (!showsText(text) || text !== serialize(root.value)) {
    render(text);
    if (selection) setSelection(selection.start, selection.end);
  } else {
    rendered = text;
  }
  if (selection) lastSelection = selection;
  if (value.value !== text) value.value = text;
  emit('input');
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
    const selection = selectionInside() ?? { start: value.value.length, end: value.value.length };
    if (value.value.length - (selection.end - selection.start) + event.data.length > maxlength) event.preventDefault();
  }
}

function onKeydown(event: KeyboardEvent): void {
  emit('keydown', event);
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
  if (!root.value || !selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!root.value.contains(range.commonAncestorContainer)) return;
  // Emoji images copy as the characters they stand for.
  event.preventDefault();
  event.clipboardData?.setData('text/plain', serialize(range.cloneContents()));
  if (cut && !disabled) {
    range.deleteContents();
    sync();
  }
}

function onCompositionStart(): void {
  composing = true;
  emit('compositionstart');
}

function onCompositionEnd(): void {
  composing = false;
  sync();
  emit('compositionend');
}

// An outside change — sending clears the field, a draft or a mention is put
// back — is drawn; our own input already is. Runs once the field is mounted, too.
watch(
  [value, root],
  ([next, element]) => {
    if (!element || next === rendered) return;
    const focused = document.activeElement === element;
    render(next);
    lastSelection = null;
    if (focused) setSelection(next.length);
  },
  { flush: 'post', immediate: true }
);

function rememberSelection(): void {
  const inside = selectionInside();
  if (inside) lastSelection = inside;
}

onMounted(() => document.addEventListener('selectionchange', rememberSelection));
onBeforeUnmount(() => document.removeEventListener('selectionchange', rememberSelection));

defineExpose({ focus, getSelection, setSelection, insertText });
</script>

<template>
  <div
    ref="root"
    class="emoji-composer"
    :class="{ 'emoji-composer--empty': !value, 'emoji-composer--disabled': disabled }"
    role="textbox"
    :tabindex="disabled ? -1 : 0"
    :contenteditable="disabled ? 'false' : 'true'"
    aria-multiline="true"
    :aria-label="ariaLabel || placeholder || undefined"
    :aria-placeholder="placeholder || undefined"
    :aria-disabled="disabled || undefined"
    :placeholder="placeholder"
    spellcheck="true"
    @beforeinput="onBeforeInput"
    @input="sync"
    @keydown="onKeydown"
    @paste="onPaste"
    @drop="onDrop"
    @copy="copySelection($event, false)"
    @cut="copySelection($event, true)"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
  ></div>
</template>
