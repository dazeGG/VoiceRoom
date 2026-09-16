/**
 * Copying text that shows emoji as artwork puts the emoji back as characters.
 *
 * Emoji in messages and names are images carrying the character as their alt
 * text, but a browser leaves images out of copied text, so "ok 👍" would copy
 * as "ok ". When a selection holds emoji artwork, the copied text is rebuilt
 * from a rendered copy of it with every emoji image turned back into its
 * character; line breaks come out the same as the browser's own copy. Anything
 * without emoji is left to the browser, and so is a copy something else has
 * already handled, such as the message field.
 */

const EMOJI_SELECTOR = 'img[data-emoji]';

function copyTextFor(range: Range): { text: string; html: string } | null {
  const fragment = range.cloneContents();
  const images = fragment.querySelectorAll<HTMLImageElement>(EMOJI_SELECTOR);
  if (images.length === 0) return null;
  for (const image of images) image.replaceWith(document.createTextNode(image.dataset.emoji ?? image.alt));

  // innerText follows layout — blocks and <br> become line breaks — so the
  // copy is rendered for a moment, out of sight and out of the way. It keeps
  // the white-space rule of where the selection sits: line breaks inside a
  // message survive, and the markup's indentation between blocks does not.
  const ancestor = range.commonAncestorContainer;
  const context = ancestor instanceof Element ? ancestor : ancestor.parentElement;
  const whiteSpace = context ? getComputedStyle(context).whiteSpace : 'normal';
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;';
  holder.style.whiteSpace = whiteSpace;
  holder.append(fragment);
  document.body.append(holder);
  try {
    return { text: holder.innerText, html: holder.innerHTML };
  } finally {
    holder.remove();
  }
}

export function handleEmojiCopy(event: ClipboardEvent): void {
  if (event.defaultPrevented || !event.clipboardData) return;
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

  let text = '';
  let html = '';
  let changed = false;
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const copy = copyTextFor(range);
    if (copy) changed = true;
    text += copy ? copy.text : range.toString();
    html += copy ? copy.html : '';
  }
  if (!changed) return;

  event.preventDefault();
  event.clipboardData.setData('text/plain', text);
  if (html) event.clipboardData.setData('text/html', html);
}

/** Listens for the whole document; returns the way to stop. */
export function installEmojiCopy(target: Document = document): () => void {
  target.addEventListener('copy', handleEmojiCopy);
  return () => target.removeEventListener('copy', handleEmojiCopy);
}
