<script setup lang="ts">
// Reporting a room or direct message to the service operator. The reason is
// required, the comment is optional; the operator sees the message itself.
import { ref } from 'vue';
import { REPORT_COMMENT_MAX_LENGTH } from '@voice-room/shared/contracts/reports';
import { fileReport, type ReportReason, type ReportTarget } from '@/api/reports';
import { Button, Dialog } from '@/shared/ui';

const { target } = defineProps<{ target: ReportTarget }>();

const emit = defineEmits<{
  close: [];
  reported: [message: string];
}>();

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'spam', label: 'Спам или реклама' },
  { value: 'abuse', label: 'Оскорбления, травля или угрозы' },
  { value: 'illegal', label: 'Запрещённый законом контент' },
  { value: 'other', label: 'Другое' }
];

const reason = ref<ReportReason | null>(null);
const comment = ref('');
const sending = ref(false);
const error = ref('');

async function submit(): Promise<void> {
  if (!reason.value || sending.value) return;
  sending.value = true;
  error.value = '';
  try {
    const note = comment.value.trim();
    const status = await fileReport({ target, reason: reason.value, ...(note ? { comment: note } : {}) });
    emit('reported', status === 'filed' ? 'Жалоба отправлена, спасибо' : 'Вы уже пожаловались на это сообщение');
    emit('close');
  } catch (cause) {
    error.value = cause instanceof Error && cause.message ? cause.message : 'Не удалось отправить жалобу';
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Dialog
    open
    title="Пожаловаться на сообщение"
    :on-close="() => emit('close')"
    :width="460"
    initial-focus="[name=report-reason]"
  >
    <form class="report-dialog" @submit.prevent="submit">
      <fieldset class="report-dialog__reasons">
        <legend class="report-dialog__label">Что не так с сообщением?</legend>
        <label
          v-for="option in REASONS"
          :key="option.value"
          class="report-dialog__reason"
          :class="{ 'report-dialog__reason--selected': reason === option.value }"
        >
          <input
            v-model="reason"
            class="report-dialog__reason-input"
            type="radio"
            name="report-reason"
            :value="option.value"
          />
          <span class="report-dialog__reason-mark" aria-hidden="true"></span>
          <span class="report-dialog__reason-text">{{ option.label }}</span>
        </label>
      </fieldset>

      <div>
        <label class="report-dialog__label" for="reportComment"
          >Комментарий <span class="report-dialog__soft">· необязательно</span></label
        >
        <textarea
          id="reportComment"
          v-model="comment"
          class="report-dialog__comment"
          rows="3"
          :maxlength="REPORT_COMMENT_MAX_LENGTH"
          placeholder="Что ещё стоит знать модератору"
        ></textarea>
      </div>

      <p class="report-dialog__note">
        Жалобу рассмотрит администратор сервиса. Автор сообщения не узнает, кто пожаловался.
      </p>

      <p v-if="error" class="report-dialog__error" role="alert">{{ error }}</p>

      <div class="report-dialog__actions">
        <Button variant="ghost" type="button" @click="emit('close')">Отмена</Button>
        <Button variant="danger" type="submit" :disabled="!reason || sending">
          {{ sending ? 'Отправляем…' : 'Отправить жалобу' }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
