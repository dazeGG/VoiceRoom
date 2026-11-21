export interface CalloutProps {
  title: string;
  titleAs?: 'p' | 'h1';
  text?: string | undefined;
  tone?: 'info' | 'warning' | 'danger' | 'accent';
  dismissible?: boolean;
}
