<script setup lang="ts">
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuLabelProps } from './types';

defineProps<MenuLabelProps>();
const { Label } = useMenuParts();
</script>

<template>
  <Label class="ui-menu__label">{{ text }}</Label>
</template>
