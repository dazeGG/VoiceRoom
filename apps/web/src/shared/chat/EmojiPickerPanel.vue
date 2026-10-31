<script setup lang="ts">
import { SKIN_TONES } from '@voice-room/shared/emoji-skin-tones';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import Emoji from './Emoji.vue';
import { NEUTRAL_TONE, loadSkinTone, saveSkinTone } from './skin-tone-preference';
import {
  BROWSABLE_EMOJIS,
  TONE_SWATCH_BASE,
  hasSkinToneChoices,
  listBrowsableCategories,
  skinToneChoices,
  withSkinTone
} from './emoji-catalog';

// The emoji browser shared by message reactions and the composer. The host
// owns the popover and what a pick means; the panel is mounted only while
// the popover is open, so every open starts from a clean search and scroll.

const CATEGORIES = listBrowsableCategories();
const COLUMNS = 8;

// The browse list is one continuous scroller holding every category, so the
// category buttons are anchors into it rather than tabs that swap the content
// out. That costs ~2400 tiles, far past what the DOM wants to hold, so only
// the visible rows are rendered against a spacer of the full height.
const TILE = 44;
const TILE_GAP = 4;
const ROW_HEIGHT = TILE + TILE_GAP;
const HEADER_HEIGHT = 28;
// Two rows of slack: enough that a fast wheel never shows a blank strip,
// few enough that a jump to a category asks for one screen of artwork.
const OVERSCAN_ROWS = 2;
const TONE_HOVER_DELAY_MS = 300;
const TONE_CLOSE_GRACE_MS = 260;
const TONE_SWATCH = 34;
const TONE_SWATCH_GAP = 2;
const TONE_STRIP_PADDING = 5;
const TONE_STRIP_MARGIN = 8;

const {
  frequentEmoji,
  searchLabel = 'Поиск реакции',
  sectionsLabel = 'Разделы реакций',
  gridLabel = 'Доступные реакции',
  optionLabel = (emoji: string) => `Реакция ${emoji}`,
  toneStripLabel = 'Цвет кожи для этой реакции'
} = defineProps<{
  frequentEmoji: readonly string[];
  searchLabel?: string;
  sectionsLabel?: string;
  gridLabel?: string;
  optionLabel?: (emoji: string) => string;
  toneStripLabel?: string;
}>();

const emit = defineEmits<{ pick: [emoji: string] }>();

const search = ref('');
const activeIndex = ref(0);
const skinTone = ref(loadSkinTone(SKIN_TONES.length));
const toneMenuOpen = ref(false);
const toneStripFor = ref('');
const toneStripLeft = ref(0);
const toneStripTop = ref(0);
const strip = ref<HTMLDivElement | null>(null);
const scroller = ref<HTMLDivElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(300);
let toneHoverTimer = 0;
let toneCloseTimer = 0;
const picker = ref<HTMLDivElement | null>(null);

const searching = computed(() => search.value.trim().length > 0);

interface PickerSection {
  key: string;
  label: string;
  emojis: string[];
}

const sections = computed((): PickerSection[] => {
  const query = search.value.trim();
  if (query) {
    const matches = BROWSABLE_EMOJIS.filter((emoji) => emoji.includes(query));
    return [{ key: 'search', label: 'Результаты', emojis: [...matches] }];
  }

  const browse: PickerSection[] = [];
  if (frequentEmoji.length) {
    browse.push({ key: 'frequent', label: 'Часто используемые', emojis: [...frequentEmoji] });
  }
  for (const category of CATEGORIES) {
    browse.push({ key: category.key, label: category.label, emojis: category.emojis });
  }
  return browse;
});

/** Whatever the reader's tone preference turns this base into. */
function toned(emoji: string): string {
  return withSkinTone(emoji, skinTone.value);
}

type HeaderRow = { kind: 'header'; key: string; sectionKey: string; label: string; top: number; height: number };
type GridRow = {
  kind: 'grid';
  key: string;
  sectionKey: string;
  emojis: string[];
  firstIndex: number;
  top: number;
  height: number;
};
type PickerRow = HeaderRow | GridRow;

const layout = computed(() => {
  const rows: PickerRow[] = [];
  const flat: string[] = [];
  const sectionTops: [string, number][] = [];
  let top = 0;

  for (const section of sections.value) {
    if (!section.emojis.length) continue;
    sectionTops.push([section.key, top]);
    rows.push({
      kind: 'header',
      key: `${section.key}:header`,
      sectionKey: section.key,
      label: section.label,
      top,
      height: HEADER_HEIGHT
    });
    top += HEADER_HEIGHT;

    for (let offset = 0; offset < section.emojis.length; offset += COLUMNS) {
      rows.push({
        kind: 'grid',
        key: `${section.key}:${offset}`,
        sectionKey: section.key,
        emojis: section.emojis.slice(offset, offset + COLUMNS),
        firstIndex: flat.length + offset,
        top,
        height: ROW_HEIGHT
      });
      top += ROW_HEIGHT;
    }
    flat.push(...section.emojis);
  }

  return { rows, flat, sectionTop: new Map(sectionTops), totalHeight: top };
});

const visibleRows = computed(() => {
  const from = scrollTop.value - OVERSCAN_ROWS * ROW_HEIGHT;
  const to = scrollTop.value + viewportHeight.value + OVERSCAN_ROWS * ROW_HEIGHT;
  return layout.value.rows.filter((row) => row.top + row.height >= from && row.top <= to);
});

const toneStripOptions = computed(() => (toneStripFor.value ? skinToneChoices(toneStripFor.value) : []));

onMounted(() => {
  void nextTick().then(() => {
    searchInput.value?.focus();
    if (scroller.value) viewportHeight.value = scroller.value.clientHeight || viewportHeight.value;
  });
});

onBeforeUnmount(() => {
  window.clearTimeout(toneHoverTimer);
  window.clearTimeout(toneCloseTimer);
});

// Which category the reader is actually looking at, so the anchors stay honest
// while they scroll instead of only when they click.
const activeSectionKey = computed(() => {
  const position = scrollTop.value + 1;
  let current = layout.value.rows[0]?.sectionKey ?? 'frequent';
  for (const row of layout.value.rows) {
    if (row.kind !== 'header' || row.top > position) continue;
    current = row.sectionKey;
  }
  return current;
});

function onScroll(event: Event): void {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  scrollTop.value = target.scrollTop;
  viewportHeight.value = target.clientHeight;
}

function goToSection(key: string): void {
  search.value = '';
  activeIndex.value = 0;
  void nextTick().then(() => {
    const top = layout.value.sectionTop.get(key);
    if (top === undefined || !scroller.value) return;
    // Instant, not smooth: an animated scroll walks the window across every
    // row in between, so the jump asked for hundreds of screens of artwork on
    // the way and felt like the picker was loading forever.
    scroller.value.scrollTop = top;
    scrollTop.value = top;
  });
}

async function focusOption(index: number): Promise<void> {
  const flat = layout.value.flat;
  if (!flat.length) return;
  activeIndex.value = Math.max(0, Math.min(index, flat.length - 1));

  // The target row may be outside the rendered window, so bring it into view
  // first and let the window rebuild before reaching for the button.
  const row = layout.value.rows.find(
    (entry) =>
      entry.kind === 'grid' &&
      activeIndex.value >= entry.firstIndex &&
      activeIndex.value < entry.firstIndex + entry.emojis.length
  );
  if (row && scroller.value) {
    if (row.top < scrollTop.value) scroller.value.scrollTop = row.top;
    else if (row.top + row.height > scrollTop.value + viewportHeight.value) {
      scroller.value.scrollTop = row.top + row.height - viewportHeight.value;
    }
  }
  await nextTick();
  scroller.value?.querySelector<HTMLButtonElement>(`[data-option-index="${activeIndex.value}"]`)?.focus();
}

function gridKeydown(event: KeyboardEvent): void {
  let next = activeIndex.value;
  if (event.key === 'ArrowRight') next += 1;
  else if (event.key === 'ArrowLeft') next -= 1;
  else if (event.key === 'ArrowDown') next += COLUMNS;
  else if (event.key === 'ArrowUp') next -= COLUMNS;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = layout.value.flat.length - 1;
  else return;
  event.preventDefault();
  // A context menu may be hosting this picker; it must not also move its own
  // selection on the same key.
  event.stopPropagation();
  void focusOption(next);
}

function categoryKeydown(event: KeyboardEvent): void {
  const toolbar = event.currentTarget;
  if (!(toolbar instanceof HTMLElement)) return;
  const anchors = Array.from(toolbar.querySelectorAll<HTMLButtonElement>('[data-category]'));
  const current = anchors.findIndex((anchor) => anchor === document.activeElement);
  if (current < 0) return;
  let next: number;
  if (event.key === 'ArrowRight') next = (current + 1) % anchors.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + anchors.length) % anchors.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = anchors.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  anchors[next]?.focus();
  anchors[next]?.click();
}

/** A press anywhere that is not the strip or the tone menu puts them away. */
function dismissOverlays(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (strip.value?.contains(target)) return;
  if (!(target instanceof Element) || !target.closest('.emoji-picker__tone')) toneMenuOpen.value = false;
  if (!(target instanceof Element) || !target.closest('.emoji-picker__cell')) {
    toneStripFor.value = '';
  }
}

function chooseTone(tone: number): void {
  skinTone.value = tone;
  saveSkinTone(tone, SKIN_TONES.length);
  toneMenuOpen.value = false;
}

// A one-off pick, which leaves the remembered default alone. It opens on a
// dwell or a right click; the strip is anchored to the tile so the colours
// appear where the eye already is.
function openToneStrip(emoji: string, tile: HTMLElement): void {
  if (!hasSkinToneChoices(emoji) || !picker.value) return;
  cancelToneClose();
  const tileBox = tile.getBoundingClientRect();
  const pickerBox = picker.value.getBoundingClientRect();
  // Six swatches plus the padding and border around them. Kept in sync with
  // the stylesheet so the strip can be clamped before it is measured.
  const width = 6 * TONE_SWATCH + 5 * TONE_SWATCH_GAP + 2 * TONE_STRIP_PADDING;
  const half = width / 2;
  const centre = tileBox.left - pickerBox.left + tileBox.width / 2;
  // Clamped to the panel: unclamped, a swatch row over the leftmost column
  // hung outside the picker and was clipped away.
  toneStripLeft.value = Math.min(
    Math.max(centre, half + TONE_STRIP_MARGIN),
    pickerBox.width - half - TONE_STRIP_MARGIN
  );
  toneStripTop.value = Math.max(tileBox.top - pickerBox.top, TONE_SWATCH + TONE_STRIP_MARGIN);
  toneStripFor.value = emoji;
}

// Reaching the swatches means leaving the tile, so the strip survives a short
// grace period; entering it cancels the close outright.
function scheduleToneClose(): void {
  window.clearTimeout(toneCloseTimer);
  toneCloseTimer = window.setTimeout(() => (toneStripFor.value = ''), TONE_CLOSE_GRACE_MS);
}

function cancelToneClose(): void {
  window.clearTimeout(toneCloseTimer);
  toneCloseTimer = 0;
}

function beginToneHover(emoji: string, event: PointerEvent): void {
  const tile = event.currentTarget;
  if (!(tile instanceof HTMLElement) || !hasSkinToneChoices(emoji)) return;
  window.clearTimeout(toneHoverTimer);
  toneHoverTimer = window.setTimeout(() => openToneStrip(emoji, tile), TONE_HOVER_DELAY_MS);
}

function cancelToneHover(): void {
  window.clearTimeout(toneHoverTimer);
  toneHoverTimer = 0;
}

function leaveTile(): void {
  cancelToneHover();
  if (toneStripFor.value) scheduleToneClose();
}

function choose(emoji: string): void {
  cancelToneHover();
  emit('pick', emoji);
}

function chooseFromStrip(emoji: string): void {
  toneStripFor.value = '';
  emit('pick', emoji);
}

function onContextMenu(event: MouseEvent, emoji: string): void {
  if (!hasSkinToneChoices(emoji)) return;
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) openToneStrip(emoji, event.currentTarget);
}

function onSearchInput(): void {
  activeIndex.value = 0;
  scrollTop.value = 0;
  if (scroller.value) scroller.value.scrollTop = 0;
}
</script>

<template>
  <div ref="picker" class="emoji-picker" role="presentation" @pointerdown="dismissOverlays">
    <div class="emoji-picker__head">
      <div class="emoji-picker__search-row">
        <label class="emoji-picker__search">
          <span class="emoji-picker__label">{{ searchLabel }}</span>
          <input
            ref="searchInput"
            v-model="search"
            class="emoji-picker__input"
            type="search"
            :placeholder="searchLabel"
            @input="onSearchInput"
          />
        </label>

        <div class="emoji-picker__tone">
          <button
            class="emoji-picker__tone-trigger"
            type="button"
            aria-label="Цвет кожи по умолчанию"
            title="Цвет кожи по умолчанию"
            aria-haspopup="true"
            :aria-expanded="toneMenuOpen"
            @click="toneMenuOpen = !toneMenuOpen"
          >
            <Emoji :emoji="withSkinTone(TONE_SWATCH_BASE, skinTone)" :size="20" decorative />
          </button>

          <div v-if="toneMenuOpen" class="emoji-picker__tone-menu" role="menu" aria-label="Цвет кожи">
            <button
              v-for="(swatch, index) in skinToneChoices(TONE_SWATCH_BASE)"
              :key="swatch"
              class="emoji-picker__tone-option"
              type="button"
              role="menuitemradio"
              :aria-checked="index - 1 === skinTone"
              :aria-label="index - 1 === NEUTRAL_TONE ? 'Без цвета кожи' : `Тон ${index}`"
              @click="chooseTone(index - 1)"
            >
              <Emoji :emoji="swatch" :size="20" decorative />
            </button>
          </div>
        </div>
      </div>

      <!-- Anchors, not tabs: they scroll the one list rather than swapping
           its contents. -->
      <div
        class="emoji-picker__anchors"
        role="toolbar"
        tabindex="-1"
        :aria-label="sectionsLabel"
        @keydown="categoryKeydown"
      >
        <button
          v-if="frequentEmoji.length"
          class="emoji-picker__anchor"
          :class="{ 'emoji-picker__anchor--active': !searching && activeSectionKey === 'frequent' }"
          type="button"
          data-category="frequent"
          aria-label="Часто используемые"
          :aria-current="activeSectionKey === 'frequent' ? 'true' : undefined"
          title="Часто используемые"
          @click="goToSection('frequent')"
        >
          🕘
        </button>
        <button
          v-for="group in CATEGORIES"
          :key="group.key"
          class="emoji-picker__anchor"
          :class="{ 'emoji-picker__anchor--active': !searching && activeSectionKey === group.key }"
          type="button"
          :data-category="group.key"
          :aria-label="group.label"
          :aria-current="activeSectionKey === group.key ? 'true' : undefined"
          :title="group.label"
          @click="goToSection(group.key)"
        >
          <Emoji :emoji="group.icon" :size="20" decorative />
        </button>
      </div>
    </div>

    <div
      ref="scroller"
      class="emoji-picker__body"
      role="grid"
      tabindex="-1"
      :aria-label="gridLabel"
      @scroll="onScroll"
      @keydown="gridKeydown"
    >
      <div class="emoji-picker__spacer" :style="{ height: `${layout.totalHeight}px` }">
        <template v-for="row in visibleRows" :key="row.key">
          <span v-if="row.kind === 'header'" class="emoji-picker__section" :style="{ top: `${row.top}px` }">{{
            row.label
          }}</span>
          <div v-else class="emoji-picker__row" :style="{ top: `${row.top}px` }" role="row">
            <button
              v-for="(emoji, column) in row.emojis"
              :key="emoji"
              class="emoji-picker__cell"
              type="button"
              role="gridcell"
              :data-option-index="row.firstIndex + column"
              :tabindex="row.firstIndex + column === activeIndex ? 0 : -1"
              :aria-label="optionLabel(toned(emoji))"
              :aria-haspopup="hasSkinToneChoices(emoji) ? 'true' : undefined"
              @click="choose(toned(emoji))"
              @contextmenu="onContextMenu($event, emoji)"
              @focus="activeIndex = row.firstIndex + column"
              @pointerenter="beginToneHover(emoji, $event)"
              @pointerleave="leaveTile"
            >
              <Emoji :emoji="toned(emoji)" decorative />
              <span v-if="hasSkinToneChoices(emoji)" class="emoji-picker__tone-hint" aria-hidden="true"></span>
            </button>
          </div>
        </template>
      </div>

      <p v-if="layout.flat.length === 0" class="emoji-picker__empty">Ничего не найдено</p>
    </div>

    <!-- Anchored to the tile and only as wide as the six swatches. It
         closes by leaving it or clicking elsewhere; a click inside is
         never a reason to take the whole picker down with it. -->
    <div
      v-if="toneStripFor"
      ref="strip"
      class="emoji-picker__tone-strip"
      role="group"
      :aria-label="toneStripLabel"
      :style="{ left: `${toneStripLeft}px`, top: `${toneStripTop}px` }"
      @pointerenter="cancelToneClose"
      @pointerleave="scheduleToneClose"
    >
      <button
        v-for="option in toneStripOptions"
        :key="option"
        class="emoji-picker__tone-strip-option"
        type="button"
        :aria-label="optionLabel(option)"
        @click="chooseFromStrip(option)"
      >
        <Emoji :emoji="option" decorative />
      </button>
    </div>
  </div>
</template>
