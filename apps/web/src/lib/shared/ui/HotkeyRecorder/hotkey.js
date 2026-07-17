/** @typedef {import('./types').HotkeyBinding} HotkeyBinding */

const MODIFIER_CODES = new Set([
  'AltLeft',
  'AltRight',
  'ControlLeft',
  'ControlRight',
  'MetaLeft',
  'MetaRight',
  'ShiftLeft',
  'ShiftRight'
]);

/**
 * @param {KeyboardEvent} event
 * @returns {HotkeyBinding | null}
 */
export function hotkeyBindingFromEvent(event) {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey
  };
}

/**
 * @param {HotkeyBinding | null} binding
 * @param {KeyboardEvent} event
 */
export function hotkeyMatchesEvent(binding, event) {
  return Boolean(
    binding
    && binding.code === event.code
    && binding.altKey === event.altKey
    && binding.ctrlKey === event.ctrlKey
    && binding.metaKey === event.metaKey
    && binding.shiftKey === event.shiftKey
  );
}

/** @param {HotkeyBinding | null} binding */
export function formatHotkeyBinding(binding) {
  if (!binding) return 'Не назначено';
  /** @type {string[]} */
  const parts = [];
  if (binding.ctrlKey) parts.push('Ctrl');
  if (binding.metaKey) parts.push('⌘');
  if (binding.altKey) parts.push(isApplePlatform() ? '⌥' : 'Alt');
  if (binding.shiftKey) parts.push('Shift');
  parts.push(formatHotkeyCode(binding.code));
  return parts.join(' + ');
}

/** @param {string} code */
export function isHotkeyModifierCode(code) {
  return MODIFIER_CODES.has(code);
}

/** @param {string} code */
function formatHotkeyCode(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  /** @type {Record<string, string>} */
  const labels = {
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    Backquote: '`',
    Backslash: '\\',
    Backspace: 'Backspace',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Equal: '=',
    Home: 'Home',
    Insert: 'Insert',
    Minus: '-',
    PageDown: 'Page Down',
    PageUp: 'Page Up',
    Period: '.',
    Quote: "'",
    Semicolon: ';',
    Slash: '/',
    Space: 'Пробел',
    Tab: 'Tab'
  };
  return labels[code] || code;
}

function isApplePlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
