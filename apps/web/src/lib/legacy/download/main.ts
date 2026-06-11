import './download.css';

type Platform = 'mac' | 'win';

interface Build {
  id: string;
  action: string;
  meta: string;
  primary: boolean;
}

const QUARANTINE_CMD = 'sudo xattr -rd com.apple.quarantine /Applications/Voice\\ Room.app';

const PLATFORM_LABEL: Record<Platform, string> = {
  mac: 'macOS',
  win: 'Windows'
};

const PLATFORM_GLYPH: Record<Platform, string> = {
  mac: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"></rect><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="17" x2="12" y2="20"></line></svg>',
  win: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><circle cx="6.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle><circle cx="9" cy="6.5" r="0.6" fill="currentColor" stroke="none"></circle></svg>'
};

const BUILDS: Record<Platform, Build[]> = {
  mac: [
    { id: 'mac-arm64', action: 'Скачать · Apple Silicon', meta: '.dmg · ~100 МБ · arm64', primary: true },
    { id: 'mac-x64', action: 'Скачать · Intel', meta: '.dmg · ~100 МБ · x64', primary: false }
  ],
  win: [
    { id: 'win-x64', action: 'Скачать для Windows', meta: '.exe · ~100 МБ · 64-bit', primary: true }
  ]
};

const PLATFORMS: Platform[] = ['mac', 'win'];

let selected: Platform = detectPlatform();

function detectPlatform(): Platform {
  try {
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`;
    if (/Win/i.test(ua)) return 'win';
  } catch {
    // Ignore: default to mac below.
  }
  return 'mac';
}

function createDownloadButton(platform: Platform, build: Build): HTMLButtonElement {
  const template = document.querySelector<HTMLTemplateElement>('#dlButtonTemplate');
  if (!template) throw new Error('Missing #dlButtonTemplate');
  const button = template.content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
  if (build.primary) button.classList.add('dl-btn--primary');

  button.querySelector<HTMLElement>('[data-os-icon]')!.innerHTML = PLATFORM_GLYPH[platform];
  button.querySelector<HTMLElement>('[data-meta]')!.textContent = build.meta;

  const action = button.querySelector<HTMLElement>('[data-action]')!;
  action.textContent = build.action;

  let busy = false;
  button.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    button.classList.add('is-loading');
    action.textContent = 'Загрузка…';

    window.setTimeout(() => {
      button.classList.remove('is-loading');
      action.textContent = 'Загрузка началась';
      // TODO: replace with the real build URL for `build.id` once artifacts are published.
    }, 1500);

    window.setTimeout(() => {
      action.textContent = build.action;
      busy = false;
    }, 4800);
  });

  return button;
}

function renderButtons(): void {
  const host = document.querySelector<HTMLElement>('#dlButtons');
  if (!host) return;
  host.replaceChildren();
  for (const build of BUILDS[selected]) {
    host.appendChild(createDownloadButton(selected, build));
  }
}

function applyPlatform(): void {
  const blocks = document.querySelectorAll<HTMLElement>('[data-platform]');
  for (const block of blocks) {
    if (block.classList.contains('dl-platform-tab')) continue;
    block.hidden = block.dataset.platform !== selected;
  }
}

function renderSwitch(): void {
  const host = document.querySelector<HTMLElement>('#dlPlatformSwitch');
  if (!host) return;
  host.replaceChildren();

  for (const platform of PLATFORMS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'dl-platform-tab';
    tab.setAttribute('role', 'tab');
    tab.dataset.platform = platform;
    tab.innerHTML = `${PLATFORM_GLYPH[platform]}<span>${PLATFORM_LABEL[platform]}</span>`;

    const active = platform === selected;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));

    tab.addEventListener('click', () => {
      if (selected === platform) return;
      selected = platform;
      renderSwitch();
      renderButtons();
      applyPlatform();
    });

    host.appendChild(tab);
  }
}

function wireCopy(): void {
  const button = document.querySelector<HTMLButtonElement>('#dlCopyButton');
  const wrap = document.querySelector<HTMLElement>('.dl-cmd');
  const label = document.querySelector<HTMLElement>('#dlCopyLabel');
  const icon = document.querySelector<HTMLElement>('#dlCopyIcon');
  if (!button || !wrap || !label || !icon) return;

  const copyMark = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12 10 17 19 7"></polyline></svg>';
  const copyDefault = icon.innerHTML;
  let resetTimer = 0;

  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText(QUARANTINE_CMD);
    } catch {
      // Clipboard may be unavailable; still show feedback.
    }
    wrap.classList.add('is-copied');
    icon.innerHTML = copyMark;
    label.textContent = 'Скопировано';

    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      wrap.classList.remove('is-copied');
      icon.innerHTML = copyDefault;
      label.textContent = 'Копировать';
    }, 2000);
  });
}

renderSwitch();
renderButtons();
applyPlatform();
wireCopy();
