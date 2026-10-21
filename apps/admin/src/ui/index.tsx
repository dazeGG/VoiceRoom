// The admin app's small set of controls, drawn with the main site's tokens:
// buttons, segmented tabs, avatars, a modal dialog, a switch, a select, a
// popover and the official mark beside a name.

import { BadgeCheck } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react';
import { useBadges } from '../badges.ts';
import './ui.css';

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

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

function avatarPalette(colorKey: string): { background: string; foreground: string } {
  const hue = AVATAR_HUES[colorKey] ?? 278;
  return { background: `oklch(74% 0.1 ${hue})`, foreground: `oklch(25% 0.05 ${hue})` };
}

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
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
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

/** A modal dialog: Escape and the backdrop close it, focus goes into it. */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
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
      <div className="ui-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <h2 id={titleId} className="ui-dialog-title">
          {title}
        </h2>
        <div className="ui-dialog-body">{children}</div>
        {footer ? <div className="ui-dialog-footer">{footer}</div> : null}
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
