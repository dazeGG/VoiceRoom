import type { HotkeyBinding } from './types';

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

export function hotkeyBindingFromEvent(event: KeyboardEvent): HotkeyBinding | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  return {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey
  };
}

export function hotkeyMatchesEvent(binding: HotkeyBinding | null, event: KeyboardEvent): boolean {
  return Boolean(
    binding
    && binding.code === event.code
    && binding.altKey === event.altKey
    && binding.ctrlKey === event.ctrlKey
    && binding.metaKey === event.metaKey
    && binding.shiftKey === event.shiftKey
  );
}

export function formatHotkeyBinding(binding: HotkeyBinding | null): string {
  if (!binding) return 'Не назначено';
  const parts: string[] = [];
  if (binding.ctrlKey) parts.push('Ctrl');
  if (binding.metaKey) parts.push('⌘');
  if (binding.altKey) parts.push(isApplePlatform() ? '⌥' : 'Alt');
  if (binding.shiftKey) parts.push('Shift');
  parts.push(formatHotkeyCode(binding.code));
  return parts.join(' + ');
}

export function isHotkeyModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

function formatHotkeyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const labels: Record<string, string> = {
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

function isApplePlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
