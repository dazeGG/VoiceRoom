// The admin app's small set of controls, drawn with the main site's tokens:
// buttons, segmented tabs, cards, pills, avatars (of people and of rooms, one
// or a stack), a strip of numbers, empty and loading placeholders, a modal
// dialog, a switch, a select, a popover and the official mark beside a name.

import { BadgeCheck, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react';
import { useBadges } from '../badges.ts';
import './ui.css';

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'danger-outline';

export function Button({
  variant = 'outline',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`.trim()} {...rest} />;
}

export interface SegmentOption<Value extends string> {
  value: Value;
  label: string;
  suffix?: ReactNode;
}

/** A row of choices; `kind="tabs"` makes it a tab list. */
export function Segment<Value extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  kind = 'segment'
}: {
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  ariaLabel: string;
  kind?: 'segment' | 'tabs';
}) {
  const tabs = kind === 'tabs';
  return (
    <div className="ui-segment" role={tabs ? 'tablist' : 'radiogroup'} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ui-segment-option"
          role={tabs ? 'tab' : 'radio'}
          {...(tabs ? { 'aria-selected': option.value === value } : { 'aria-checked': option.value === value })}
          data-active={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.suffix}
        </button>
      ))}
    </div>
  );
}

// The main site's avatar hues (apps/web/src/lib/visual/tokens.ts): every
// avatar sits at the same lightness, its letter darker on the same hue.
const AVATAR_HUES: Record<string, number> = {
  blurple: 278,
  violet: 304,
  orchid: 326,
  magenta: 351,
  rose: 16,
  coral: 36,
  rust: 42,
  amber: 70,
  olive: 112,
  green: 148,
  teal: 182,
  cyan: 214,
  sky: 242,
  blue: 260,
  indigo: 284,
  slate: 260
};

function paletteOf(hue: number): { background: string; foreground: string } {
  return { background: `oklch(74% 0.1 ${hue})`, foreground: `oklch(25% 0.05 ${hue})` };
}

function avatarPalette(colorKey: string): { background: string; foreground: string } {
  return paletteOf(AVATAR_HUES[colorKey] ?? 278);
}

const HUES = Object.values(AVATAR_HUES);

/** A room has no colour of its own: its id picks one of the avatar hues, the same every time. */
function roomPalette(roomId: string): { background: string; foreground: string } {
  let hash = 0;
  for (const char of roomId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return paletteOf(HUES[hash % HUES.length] ?? 278);
}

const firstLetter = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

/** A round avatar: the picture, or the first letter on the account's colour. */
export function Avatar({
  name,
  src = null,
  colorKey = '',
  background = null,
  size = 32
}: {
  name: string;
  src?: string | null;
  colorKey?: string;
  background?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const palette = avatarPalette(colorKey);
  const letter = firstLetter(name);
  return (
    <span
      className="ui-avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: background ?? palette.background,
        color: background ? 'var(--vr-text)' : palette.foreground
      }}
    >
      {src && failed !== src ? <img src={src} alt="" onError={() => setFailed(src)} /> : letter}
    </span>
  );
}

/**
 * A room's square avatar: its picture, or its first letter on a colour of its
 * own. A temporary room without a name, or one that is gone, shows "#".
 */
export function RoomAvatar({
  roomId,
  name,
  src = null,
  size = 34
}: {
  roomId: string;
  /** Empty or null for an unnamed temporary room. */
  name: string | null;
  src?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = name?.trim() ?? '';
  const palette = shown ? roomPalette(roomId) : null;
  return (
    <span
      className="ui-avatar ui-avatar--room"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 34 ? 10 : 8,
        fontSize: Math.round(size * 0.42),
        ...(palette ? { background: palette.background, color: palette.foreground } : {})
      }}
    >
      {src && failed !== src ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : shown ? (
        firstLetter(shown)
      ) : (
        '#'
      )}
    </span>
  );
}

export interface StackPerson {
  key: string;
  name: string;
  src?: string | null;
  colorKey?: string;
  background?: string | null;
}

/** Up to five overlapping avatars; the count beside them tells the rest. */
export function AvatarStack({
  people,
  max = 5,
  size = 26
}: {
  people: readonly StackPerson[];
  max?: number;
  size?: number;
}) {
  return (
    <span className="ui-avatar-stack" aria-hidden="true">
      {people.slice(0, max).map((person) => (
        <Avatar
          key={person.key}
          name={person.name}
          src={person.src ?? null}
          colorKey={person.colorKey ?? ''}
          background={person.background ?? null}
          size={size}
        />
      ))}
    </span>
  );
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** A small rounded label: a status, a kind, a role. */
export function Pill({
  tone = 'neutral',
  dot = false,
  compact = false,
  title,
  children
}: {
  tone?: Tone;
  /** A dot of the tone before the text, for a live status. */
  dot?: boolean;
  /** The tighter size used inside table rows. */
  compact?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className="ui-pill" data-tone={tone} data-compact={compact} title={title}>
      {dot ? <span className="ui-pill-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A card: a heading with something on its right, and what it holds. `flush` drops the padding, for tables. */
export function Panel({
  title,
  aside,
  flush = false,
  className = '',
  children
}: {
  title?: ReactNode;
  aside?: ReactNode;
  flush?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      className={`ui-panel ${className}`.trim()}
      data-flush={flush}
      aria-labelledby={title ? titleId : undefined}
    >
      {title || aside ? (
        <header className="ui-panel-head">
          {title ? (
            <h3 id={titleId} className="ui-panel-title">
              {title}
            </h3>
          ) : null}
          {aside ? <div className="ui-panel-aside">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** One quiet line in the middle of a card: nothing to show, or nothing found. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="ui-empty">{children}</p>;
}

/** A grey bar standing in for a value until it loads. */
export function Skeleton({
  width = '100%',
  height = 14
}: {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}) {
  return <span className="ui-skeleton" aria-hidden="true" style={{ width, height }} />;
}

/** A strip of numbers in one card, the cells split by hairlines; `min` is a cell's narrowest width. */
export function Stats({ min = 150, label, children }: { min?: number; label: string; children: ReactNode }) {
  const style: CSSProperties = { '--stat-min': `${String(min)}px` };
  return (
    <div className="ui-stats" role="list" aria-label={label} style={style}>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  note,
  tone,
  dot
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  /** Colours the value: a number that asks for attention. */
  tone?: Tone | undefined;
  /** A status dot of this tone before the label. */
  dot?: Tone | undefined;
}) {
  return (
    <div className="ui-stat" role="listitem">
      <span className="ui-stat-label">
        {dot ? <span className="ui-stat-dot" data-tone={dot} aria-hidden="true" /> : null}
        {label}
      </span>
      <span className="ui-stat-value" data-tone={tone}>
        {value}
      </span>
      {note ? <span className="ui-stat-note">{note}</span> : null}
    </div>
  );
}

/** The official mark beside a name, when the account carries one. */
export function AccountBadge({ userId }: { userId: string }) {
  const badges = useBadges();
  const badge = badges.get(userId);
  if (!badge) return null;
  const label = badge === 'official' ? 'Официальный аккаунт' : 'Подтверждённый аккаунт';
  return (
    <span className="ui-account-badge" title={label} aria-label={label} data-badge={badge}>
      <BadgeCheck size={14} aria-hidden="true" />
    </span>
  );
}

const FOCUSABLE = 'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: Escape, the backdrop and the cross close it, focus goes into
 * it and Tab keeps it there. `wide` is for a table rather than a form.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panel.current) return;
      const inside = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => !element.hasAttribute('disabled')
      );
      const first = inside[0];
      const last = inside.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ui-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="ui-dialog" data-wide={wide} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <header className="ui-dialog-head">
          <h2 id={titleId} className="ui-dialog-title">
            {title}
          </h2>
          {description ? <p className="ui-dialog-description">{description}</p> : null}
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
        {/* Last in the order, so a form's first field takes the focus on opening. */}
        <button type="button" className="ui-dialog-close" aria-label="Закрыть" title="Закрыть" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="ui-switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch-thumb" aria-hidden="true" />
    </button>
  );
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`ui-select ${className}`.trim()} {...rest} />;
}

/** A panel under a trigger; a click outside or Escape closes it. */
export function Popover({
  trigger,
  children,
  label
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="ui-popover" ref={root}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open ? (
        <div className="ui-popover-panel" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
