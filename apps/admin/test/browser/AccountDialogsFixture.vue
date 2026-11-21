<script setup lang="ts">
import { ref } from 'vue';
import { Button } from '@voiceroom/ui-kit/components';
import AccountBlockDialog from '../../src/pages/AccountBlockDialog.vue';
import AccountDeleteDialog from '../../src/pages/AccountDeleteDialog.vue';
import { useStaffStore, type Staff } from '../../src/staff.store.ts';

const props = defineProps<{ staff: Staff }>();
const session = useStaffStore();
session.staff = props.staff;
const dialog = ref<'block' | 'delete' | null>(null);
const submits = ref(0);
function close(): void {
  dialog.value = null;
}
async function confirm(): Promise<null> {
  submits.value += 1;
  close();
  return null;
}
</script>

<template>
  <Button @click="dialog = 'block'">Open block</Button>
  <Button @click="dialog = 'delete'">Open delete</Button>
  <output aria-label="Submissions">{{ submits }}</output>
  <AccountBlockDialog v-if="dialog === 'block'" name="Fixture" :on-confirm="confirm" @close="close" />
  <AccountDeleteDialog v-if="dialog === 'delete'" login="fixture" :on-confirm="confirm" @close="close" />
</template>
