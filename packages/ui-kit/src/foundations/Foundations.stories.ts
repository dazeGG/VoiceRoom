import type { Meta, StoryObj } from '@storybook/vue3-vite';

import { getAvatarColor } from '@voiceroom/ui-kit/avatar-colors';

// Live view of DESIGN.md "Colour", "Typography" and "Size grid": every swatch, text style and
// grid step reads the real token, so a token change shows up here at once.

const meta = {
  title: 'Foundations',
  parameters: { layout: 'padded' }
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const colorGroups: { title: string; tokens: string[] }[] = [
  {
    title: 'Слои',
    tokens: ['bg', 'surface', 'surface-2', 'surface-3', 'surface-2-hover', 'surface-3-hover', 'hover', 'video-bg']
  },
  { title: 'Линии', tokens: ['line', 'line-strong'] },
  { title: 'Текст', tokens: ['text', 'text-2', 'text-muted', 'text-3'] },
  {
    title: 'Акцент',
    tokens: ['accent', 'accent-hover', 'accent-ink', 'accent-soft', 'accent-soft-hover', 'accent-line']
  },
  { title: 'Присутствие', tokens: ['online', 'away', 'dnd', 'offline'] },
  {
    title: 'Обратная связь',
    tokens: ['success', 'warning', 'info', 'danger', 'danger-soft', 'danger-off', 'danger-hover', 'on-danger']
  },
  { title: 'Наложения', tokens: ['scrim', 'backdrop', 'dock-bg', 'badge-muted-bg', 'badge-muted-ink'] }
];

const avatarKeys = [
  'blurple',
  'violet',
  'orchid',
  'magenta',
  'rose',
  'coral',
  'rust',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'slate'
] as const;

const page = 'display:grid;gap:var(--space-32);max-width:960px;font-family:var(--font-ui);color:var(--vr-text)';
const heading = 'margin:0 0 var(--space-12);font-size:15px;font-weight:600';
const grid = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:var(--space-12)';
const swatch =
  'height:var(--size-56);border-radius:var(--radius-12);border:1px solid var(--vr-line-strong);background-image:linear-gradient(45deg,var(--vr-surface-3) 25%,transparent 25%,transparent 75%,var(--vr-surface-3) 75%),linear-gradient(45deg,var(--vr-surface-3) 25%,transparent 25%,transparent 75%,var(--vr-surface-3) 75%);background-size:12px 12px;background-position:0 0,6px 6px';
const label = 'margin:var(--space-6) 0 0;font-family:var(--font-mono);font-size:11px;color:var(--vr-text-muted)';

export const Colors: Story = {
  render: () => ({
    setup: () => ({
      colorGroups,
      avatars: avatarKeys.map((key) => getAvatarColor(key)),
      page,
      heading,
      grid,
      swatch,
      label
    }),
    template: `
      <div :style="page">
        <section v-for="group in colorGroups" :key="group.title">
          <h2 :style="heading">{{ group.title }}</h2>
          <div :style="grid">
            <figure v-for="token in group.tokens" :key="token" style="margin:0">
              <div :style="swatch"><div :style="'height:100%;border-radius:inherit;background:var(--vr-' + token + ')'"></div></div>
              <figcaption :style="label">--vr-{{ token }}</figcaption>
            </figure>
          </div>
        </section>
        <section>
          <h2 :style="heading">Аватары</h2>
          <div :style="grid">
            <figure v-for="avatar in avatars" :key="avatar.key" style="margin:0">
              <div :style="'display:grid;place-items:center;height:var(--size-56);border-radius:var(--radius-12);font-weight:600;background:' + avatar.background + ';color:' + avatar.foreground">А</div>
              <figcaption :style="label">{{ avatar.key }}</figcaption>
            </figure>
          </div>
        </section>
      </div>
    `
  })
};

const textStyles = [
  {
    name: 'hero',
    style: 'font-size:58px;font-weight:600;line-height:1.02;letter-spacing:-0.035em',
    sample: 'Голосовые комнаты'
  },
  { name: 'dialog-title', style: 'font-size:20px;font-weight:600;letter-spacing:-0.015em', sample: 'Создать комнату' },
  { name: 'body', style: 'font-size:16px;line-height:1.45', sample: 'Сохраняйте комнаты, историю и своё имя.' },
  { name: 'button · menu-item', style: 'font-size:14px;font-weight:600', sample: 'Войти в комнату' },
  { name: 'label', style: 'font-size:13px;font-weight:500;color:var(--vr-text-2)', sample: 'Отображаемое имя' },
  { name: 'caption', style: 'font-size:12px;color:var(--vr-text-muted)', sample: 'Как вас будут видеть в комнате' },
  {
    name: 'mono',
    style: 'font-family:var(--font-mono);font-size:12px;color:var(--vr-text-2)',
    sample: 'ABCD-EFGH-JKMN-PQRS · Ctrl M'
  }
];

export const Typography: Story = {
  render: () => ({
    setup: () => ({ textStyles, page, label }),
    template: `
      <div :style="page">
        <p class="eyebrow">voice room · типографика</p>
        <div v-for="item in textStyles" :key="item.name">
          <div :style="item.style">{{ item.sample }}</div>
          <p :style="label">{{ item.name }}</p>
        </div>
      </div>
    `
  })
};

const heights = [
  { size: 20, radius: 6, use: 'Badge · Kbd · Checkbox' },
  { size: 24, radius: 6, use: 'IconButton xs · Tag sm · сегмент sm' },
  { size: 28, radius: 8, use: 'IconButton sm · Tag md · Tooltip' },
  { size: 32, radius: 8, use: 'Button sm · Field sm · IconButton' },
  { size: 36, radius: 10, use: 'строки меню и навигации' },
  { size: 40, radius: 10, use: 'Button md · Field md · Tabs' },
  { size: 44, radius: 12, use: 'Field lg · Button lg · док · зона касания' },
  { size: 48, radius: 12, use: 'Button xl · двухстрочная опция' },
  { size: 56, radius: 12, use: 'строка списка в две строки' }
];
const spaces = [2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64];
const radii = [4, 6, 8, 10, 12, 16, 20, 24];
const icons = [12, 16, 18, 20, 24];

export const Grid: Story = {
  render: () => ({
    setup: () => ({ heights, spaces, radii, icons, page, heading, label }),
    template: `
      <div :style="page">
        <section>
          <h2 :style="heading">Высоты · --size-*</h2>
          <div style="display:grid;gap:var(--space-12)">
            <div v-for="h in heights" :key="h.size" style="display:grid;grid-template-columns:48px 180px 1fr;align-items:center;gap:var(--space-16)">
              <span style="font-family:var(--font-mono);font-weight:600;text-align:right">{{ h.size }}</span>
              <span :style="'display:block;height:var(--size-' + h.size + ');width:' + h.size * 3 + 'px;border-radius:var(--radius-' + h.radius + ');background:var(--vr-surface-3);border:1px solid var(--vr-line-strong)'"></span>
              <span style="font-size:13px;color:var(--vr-text-2)">radius-{{ h.radius }} · {{ h.use }}</span>
            </div>
          </div>
        </section>
        <section>
          <h2 :style="heading">Отступы · --space-*</h2>
          <div style="display:grid;gap:var(--space-8)">
            <div v-for="s in spaces" :key="s" style="display:flex;align-items:center;gap:var(--space-16)">
              <span :style="label + ';width:72px;margin:0'">space-{{ s }}</span>
              <span :style="'height:var(--space-12);width:var(--space-' + s + ');background:var(--vr-accent);border-radius:var(--radius-4)'"></span>
            </div>
          </div>
        </section>
        <section>
          <h2 :style="heading">Радиусы · --radius-*</h2>
          <div style="display:flex;flex-wrap:wrap;gap:var(--space-16)">
            <figure v-for="r in radii" :key="r" style="margin:0">
              <div :style="'width:72px;height:72px;background:var(--vr-surface-3);border:1px solid var(--vr-line-strong);border-radius:var(--radius-' + r + ')'"></div>
              <figcaption :style="label">radius-{{ r }}</figcaption>
            </figure>
          </div>
        </section>
        <section>
          <h2 :style="heading">Иконки · --icon-*</h2>
          <div style="display:flex;align-items:flex-end;gap:var(--space-24)">
            <figure v-for="i in icons" :key="i" style="margin:0;text-align:center">
              <span :style="'display:inline-block;width:var(--icon-' + i + ');height:var(--icon-' + i + ');border:2px solid var(--vr-text-2);border-radius:50%'"></span>
              <figcaption :style="label">icon-{{ i }}</figcaption>
            </figure>
          </div>
        </section>
      </div>
    `
  })
};
