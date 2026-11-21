<script setup lang="ts">
import {
  ArrowRight,
  Bell,
  Copy,
  Ellipsis,
  Heart,
  Reply,
  SmilePlus,
  Trash2,
  User,
  UserPlus,
  Bold,
  Italic,
  KeyRound,
  Mic,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp,
  Undo2
} from '@lucide/vue';

defineProps<{
  name:
    | 'arrow-right'
    | 'bell'
    | 'copy'
    | 'ellipsis'
    | 'heart'
    | 'reply'
    | 'smile-plus'
    | 'trash-2'
    | 'user'
    | 'user-plus'
    | 'bold'
    | 'italic'
    | 'key-round'
    | 'mic'
    | 'plus'
    | 'search'
    | 'thumbs-down'
    | 'thumbs-up'
    | 'undo-2';
}>();

const icons = {
  'arrow-right': ArrowRight,
  bell: Bell,
  copy: Copy,
  ellipsis: Ellipsis,
  heart: Heart,
  reply: Reply,
  'smile-plus': SmilePlus,
  'trash-2': Trash2,
  user: User,
  'user-plus': UserPlus,
  bold: Bold,
  italic: Italic,
  'key-round': KeyRound,
  mic: Mic,
  plus: Plus,
  search: Search,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  'undo-2': Undo2
};
</script>

<template>
  <component :is="icons[name]" aria-hidden="true" />
</template>
