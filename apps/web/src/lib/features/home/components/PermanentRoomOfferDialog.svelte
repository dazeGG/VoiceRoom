<script lang="ts">
  import { Button, Dialog } from '$lib/shared/ui';

  let { open, onRegister, onContinue, onClose } = $props<{
    open: boolean;
    onRegister: () => void;
    onContinue: () => void;
    onClose: () => void;
  }>();
</script>

<Dialog {open} title="Снова нужна комната?" {onClose} width={430} initialFocus=".permanent-room-offer-register">
  <p class="permanent-room-offer-text">
    Гостевая комната удаляется, когда все выходят, поэтому ссылку приходится каждый раз отправлять заново. С аккаунтом
    комната постоянная: одна ссылка навсегда, а друзья заходят по ней без регистрации.
  </p>
  <div class="permanent-room-offer-actions">
    <Button class="permanent-room-offer-register" variant="primary" type="button" onclick={onRegister}>
      Создать аккаунт
    </Button>
    <Button variant="ghost" type="button" onclick={onContinue}>Продолжить без аккаунта</Button>
  </div>
</Dialog>

<style>
  .permanent-room-offer-text {
    margin: 0;
    color: var(--vr-text-2);
    font-size: 14px;
    line-height: 1.5;
  }

  .permanent-room-offer-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
