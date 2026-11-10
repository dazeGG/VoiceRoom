// The download page after it loads: choose the build for this computer, swap
// the releases-page links for direct downloads, and let the macOS command be
// copied. Without this script the page still works (desktop-download.ts).

import { guessBuild, releaseLinks, type DesktopBuildId } from '../desktop-download.ts';

/** The processor, where the browser tells it (Chromium); '' elsewhere. */
async function architecture(): Promise<string> {
  try {
    return (await navigator.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture ?? '';
  } catch {
    return '';
  }
}

function choose(picker: HTMLElement, id: DesktopBuildId, sure: boolean): void {
  const radio = picker.querySelector<HTMLInputElement>(`input[value="${id}"]`);
  if (radio) radio.checked = true;
  const badge = picker.querySelector<HTMLElement>(`[data-build="${id}"] [data-build-auto]`);
  if (badge) badge.hidden = !sure;
}

async function sharpenPicker(picker: HTMLElement): Promise<void> {
  let manuallyChosen = false;
  picker.querySelectorAll<HTMLInputElement>('input[name="desktop-build"]').forEach((radio) => {
    radio.addEventListener('change', () => (manuallyChosen = true));
  });
  const guess = guessBuild(navigator.userAgent, await architecture());
  if (guess && !manuallyChosen) choose(picker, guess.id, guess.sure);

  let answer: unknown;
  try {
    const response = await fetch('/api/desktop/latest', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    answer = await response.json();
  } catch {
    return;
  }
  const links = releaseLinks(answer);
  if (!links) return;
  for (const [id, link] of Object.entries(links)) {
    const panel = picker.querySelector<HTMLElement>(`[data-build="${id}"]`);
    const anchor = panel?.querySelector<HTMLAnchorElement>('[data-build-link]');
    const meta = panel?.querySelector<HTMLElement>('[data-build-meta]');
    if (anchor) anchor.href = link.href;
    if (meta) meta.textContent = link.meta;
  }
}

function enableCopy(button: HTMLButtonElement): void {
  const text = button.dataset.copy ?? '';
  if (!text || !navigator.clipboard) return;
  const label = button.textContent ?? '';
  const status = document.getElementById(button.getAttribute('aria-describedby') ?? '');
  button.hidden = false;
  button.addEventListener('click', () => {
    if (status) status.textContent = '';
    navigator.clipboard.writeText(text).then(
      () => {
        button.textContent = 'Скопировано';
        if (status) status.textContent = 'Команда скопирована';
        setTimeout(() => (button.textContent = label), 2000);
      },
      () => {
        if (status) status.textContent = 'Не удалось скопировать — выделите команду вручную';
      }
    );
  });
}

const picker = document.querySelector<HTMLElement>('[data-download-picker]');
if (picker) void sharpenPicker(picker);
document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach(enableCopy);
