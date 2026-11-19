<script setup lang="ts">
import { t } from '@/shared/i18n';
import { computed, h, shallowRef, type VNode } from 'vue';
import type { RoomMessageContentV1 } from '@voice-room/shared/room-message-content';
import ChatText from '@/shared/components/ChatText.vue';
import { copyText } from '@/shared/utils/clipboard';
import EmojiText from './EmojiText.vue';
import { parseChatMarkdown, type MarkdownBlock, type MarkdownInline } from './chat-markdown';

const props = withDefaults(
  defineProps<{
    content?: RoomMessageContentV1 | null | undefined;
    fallback?: string;
    onmention?: ((userId: string, label: string, event: MouseEvent) => void) | undefined;
  }>(),
  { content: null, fallback: '', onmention: undefined }
);

type CodeBlock = Extract<MarkdownBlock, { kind: 'code' }>;

const blocks = computed(() => parseChatMarkdown(props.fallback, props.content));
const copyFeedback = shallowRef<{ block: CodeBlock; copied: boolean } | null>(null);

async function copyCode(block: CodeBlock): Promise<void> {
  try {
    await copyText(block.text);
    copyFeedback.value = { block, copied: true };
  } catch {
    copyFeedback.value = { block, copied: false };
  }
}

function renderInline(node: MarkdownInline): VNode {
  switch (node.kind) {
    case 'text':
      return h(ChatText, { text: node.text });
    case 'code':
      return h('code', node.text);
    case 'link':
      return h('a', { href: node.href, target: '_blank', rel: 'noopener noreferrer external' }, [
        h(EmojiText, { text: node.label })
      ]);
    case 'mention': {
      const onmention = props.onmention;
      const { userId, label } = node;
      const text = label.startsWith('@') ? label : `@${label}`;
      const attributes = { class: 'structured-message__mention', 'data-user-id': userId };
      if (!onmention || !userId) return h('span', attributes, text);
      return h(
        'button',
        {
          ...attributes,
          class: [attributes.class, 'structured-message__mention--button'],
          type: 'button',
          'aria-label': t('Открыть профиль {p0}', { p0: text }),
          onClick: (event: MouseEvent) => onmention(userId, label, event)
        },
        text
      );
    }
    default:
      return h(node.kind, node.children.map(renderInline));
  }
}

function renderBlock(block: MarkdownBlock): VNode {
  switch (block.kind) {
    case 'paragraph':
      return h('span', { class: 'structured-message__paragraph' }, block.children.map(renderInline));
    case 'quote':
      return h('blockquote', block.children.map(renderInline));
    case 'list':
      return h(
        block.firstNumber === null ? 'ul' : 'ol',
        { start: block.firstNumber },
        block.items.map((item) => h('li', item.map(renderInline)))
      );
    case 'code': {
      const state = copyFeedback.value?.block === block ? copyFeedback.value : null;
      const copyLabel = state ? (state.copied ? t('Скопировано') : t('Не удалось скопировать')) : t('Копировать');
      return h('div', { class: 'structured-message__code' }, [
        h('button', { type: 'button', 'aria-live': 'polite', onClick: () => void copyCode(block) }, copyLabel),
        h('pre', { tabindex: 0 }, [h('code', block.text)])
      ]);
    }
  }
}

// User strings are text nodes and URLs are validated before links reach Vue.
const MarkdownBody = () => {
  const nodes = blocks.value;
  return h(
    'div',
    {
      class: [
        'structured-message',
        { 'structured-message--inline': nodes.length === 1 && nodes[0]?.kind === 'paragraph' }
      ]
    },
    nodes.map(renderBlock)
  );
};
</script>

<template>
  <MarkdownBody />
</template>
