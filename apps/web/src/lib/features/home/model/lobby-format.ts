// Small presentational helpers shared by the lobby views.

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatTime(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
