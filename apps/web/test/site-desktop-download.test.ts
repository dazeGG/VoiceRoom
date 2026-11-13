// The site's progressive enhancement runs against a real DOM in the existing
// web jsdom lane; pure release/platform contracts remain in the site's tests.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defined } from './helpers/assert';

// Only the site's Client Hints addition is needed here, not its narrower
// desktop Window declarations (which belong to a different TS program).
declare global {
  interface NavigatorUAData {
    getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
  }
}

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const COMMAND = 'sudo xattr -rd com.apple.quarantine /Applications/VoiceRoom.app';

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = `
    <div data-download-picker>
      <input type="radio" name="desktop-build" value="win-x64" checked>
      <input type="radio" name="desktop-build" value="mac-arm64">
      <input type="radio" name="desktop-build" value="mac-x64">
      <div data-build="mac-arm64"><span data-build-auto hidden>Recommended</span></div>
    </div>
    <button data-copy="${COMMAND}" aria-describedby="copy-command-status" hidden>Скопировать</button>
    <p id="copy-command-status" role="status"></p>`;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function selectedBuild(): string | undefined {
  return document.querySelector<HTMLInputElement>('input[name="desktop-build"]:checked')?.value;
}

function copyButton(): HTMLButtonElement {
  return defined(document.querySelector<HTMLButtonElement>('button[data-copy]'), 'copy button');
}

test('a late architecture result cannot replace a manually selected build', async () => {
  const architecture = Promise.withResolvers<{ architecture: string }>();
  vi.stubGlobal('navigator', {
    userAgent: MAC,
    userAgentData: { getHighEntropyValues: () => architecture.promise }
  });
  await import('../../site/src/scripts/download.ts');

  defined(document.querySelector<HTMLInputElement>('input[value="mac-x64"]'), 'Intel radio').click();
  expect(selectedBuild()).toBe('mac-x64');
  architecture.resolve({ architecture: 'arm' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

  expect(selectedBuild()).toBe('mac-x64');
  expect(document.querySelector<HTMLElement>('[data-build-auto]')?.hidden).toBe(true);
});

test('architecture detection still selects the matching build before any manual choice', async () => {
  const architecture = Promise.withResolvers<{ architecture: string }>();
  vi.stubGlobal('navigator', {
    userAgent: MAC,
    userAgentData: { getHighEntropyValues: () => architecture.promise }
  });
  await import('../../site/src/scripts/download.ts');
  expect(selectedBuild()).toBe('win-x64');

  architecture.resolve({ architecture: 'arm' });
  await vi.waitFor(() => expect(selectedBuild()).toBe('mac-arm64'));
  expect(document.querySelector<HTMLElement>('[data-build-auto]')?.hidden).toBe(false);
});

test('copy success is announced and the button label resets', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { userAgent: MAC, clipboard: { writeText } });
  await import('../../site/src/scripts/download.ts');

  expect(copyButton().hidden).toBe(false);
  copyButton().click();
  await Promise.resolve();
  expect(writeText).toHaveBeenCalledWith(COMMAND);
  expect(copyButton().textContent).toBe('Скопировано');
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Команда скопирована');

  await vi.advanceTimersByTimeAsync(2000);
  expect(copyButton().textContent).toBe('Скопировать');
});

test('clipboard denial gives visible guidance and can be retried successfully', async () => {
  const writeText = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    .mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { userAgent: MAC, clipboard: { writeText } });
  await import('../../site/src/scripts/download.ts');

  copyButton().click();
  await Promise.resolve();
  const status = defined(document.querySelector<HTMLElement>('[role="status"]'), 'copy status');
  expect(status.hidden).toBe(false);
  expect(status.textContent).toBe('Не удалось скопировать — выделите команду вручную');
  expect(copyButton().textContent).toBe('Скопировать');

  vi.useFakeTimers();
  copyButton().click();
  await Promise.resolve();
  expect(status.textContent).toBe('Команда скопирована');
  expect(copyButton().textContent).toBe('Скопировано');
  await vi.advanceTimersByTimeAsync(2000);
});
