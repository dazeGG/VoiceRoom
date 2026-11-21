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
  UserPlus,
  Bold,
  KeyRound,
  Mic,
  Plus,
  Search,
  ThumbsDown,
  ThumbsUp
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
    | 'user-plus'
    | 'bold'
    | 'key-round'
    | 'mic'
    | 'plus'
    | 'search'
    | 'thumbs-down'
    | 'thumbs-up';
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
  'user-plus': UserPlus,
  bold: Bold,
  'key-round': KeyRound,
  mic: Mic,
  plus: Plus,
  search: Search,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp
};
</script>

<template>
  <component :is="icons[name]" aria-hidden="true" />
</template>
