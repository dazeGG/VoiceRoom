export const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** The midnight `days` days from `dayStart`, by the calendar rather than by 24 hours. */
export function shiftDay(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return startOfDay(date.getTime());
}
