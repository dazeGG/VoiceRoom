export interface CalloutProps {
  title?: string;
  titleAs?: 'p' | 'h1';
  text?: string | undefined;
  tone?: 'info' | 'warning' | 'danger' | 'accent';
  layout?: 'standard' | 'pill' | 'countdown';
  /** Unix timestamp in milliseconds. Without a title, the countdown becomes the title. */
  deadline?: number;
  dismissible?: boolean;
}
