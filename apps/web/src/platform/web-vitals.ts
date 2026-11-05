// How fast pages open for real visitors, reported to our own server and nowhere
// else: a number per measure, summed there into a histogram. Loaded when the page
// is idle, so measuring does not slow what it measures.

import type { Metric } from 'web-vitals';

const ENDPOINT = '/api/client-vitals';

function report({ name, value }: Pick<Metric, 'name' | 'value'>): void {
  // CLS has no unit and stays under 1; the histogram counts it in thousandths.
  const scaled = name === 'CLS' ? value * 1000 : value;
  const body = JSON.stringify({ name, value: Math.round(scaled) });
  // A beacon outlives the page, which is when most of these are reported.
  if (!navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) {
    fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body
    }).catch(() => {});
  }
}

export async function startWebVitals(): Promise<void> {
  const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals');
  onCLS(report);
  onFCP(report);
  onINP(report);
  onLCP(report);
  onTTFB(report);
}
