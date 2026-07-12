export interface HotkeyBinding {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface HotkeyRecorderProps {
  ariaLabel?: string;
  defaultValue?: HotkeyBinding | null;
  disabled?: boolean;
  onValueChange?: (value: HotkeyBinding | null) => void;
  value?: HotkeyBinding | null;
}
