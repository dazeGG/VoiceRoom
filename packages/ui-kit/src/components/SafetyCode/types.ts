export interface SafetyCodeItem {
  /** One emoji of the code. */
  emoji: string;
  /** What people call it aloud, shown under it and read by screen readers. */
  name: string;
}

export interface SafetyCodeProps {
  items: readonly SafetyCodeItem[];
  /** The accessible name of the code as a whole. */
  label: string;
}
