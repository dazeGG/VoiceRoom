import { ref, shallowRef, type ShallowRef } from 'vue';
import type { AccountDetail } from '@voiceroom/shared/contracts/admin';

export function useAccountActions<Dialog extends string>(onChanged: (detail: AccountDetail) => void) {
  const dialog: ShallowRef<Dialog | null> = shallowRef(null);
  const busy = ref(false);
  const actionError = ref('');

  function closeDialog(): void {
    dialog.value = null;
  }

  async function run(action: () => Promise<AccountDetail>, fallback: string): Promise<string | null> {
    busy.value = true;
    actionError.value = '';
    try {
      const changed = await action();
      closeDialog();
      onChanged(changed);
      return null;
    } catch (cause) {
      return cause instanceof Error && cause.message ? cause.message : fallback;
    } finally {
      busy.value = false;
    }
  }

  async function runInline(action: () => Promise<AccountDetail>, fallback: string): Promise<void> {
    actionError.value = (await run(action, fallback)) ?? '';
  }

  return { dialog, busy, actionError, closeDialog, run, runInline };
}
