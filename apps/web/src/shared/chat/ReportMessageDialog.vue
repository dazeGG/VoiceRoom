<script setup lang="ts">
// Reporting a room or direct message to the service operator. The reason is
// required, the comment is optional; the operator sees the message itself.
import { useLocalizedText, currentErrorMessage } from '@/shared/i18n/localized-text';

import { t } from '@/shared/i18n';
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
  {
    value: 'spam',
    get label() {
      return t('Спам или реклама');
    }
  },
  {
    value: 'abuse',
    get label() {
      return t('Оскорбления, травля или угрозы');
    }
  },
  {
    value: 'illegal',
    get label() {
      return t('Запрещённый законом контент');
    }
  },
  {
    value: 'other',
    get label() {
      return t('Другое');
    }
  }
];

const reason = ref<ReportReason | null>(null);
const comment = ref('');
const sending = ref(false);
const error = useLocalizedText();

async function submit(): Promise<void> {
  if (!reason.value || sending.value) return;
  sending.value = true;
  error.value = '';
  try {
    const note = comment.value.trim();
    const status = await fileReport({ target, reason: reason.value, ...(note ? { comment: note } : {}) });
    emit('reported', status === 'filed' ? t('Жалоба отправлена, спасибо') : t('Вы уже пожаловались на это сообщение'));
    emit('close');
  } catch (cause) {
    error.value = () =>
      cause instanceof Error && currentErrorMessage(cause)
        ? currentErrorMessage(cause)
        : t('Не удалось отправить жалобу');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Dialog
    open
    :title="t('Пожаловаться на сообщение')"
    :on-close="() => emit('close')"
    :width="460"
    initial-focus="[name=report-reason]"
  >
    <form class="report-dialog" @submit.prevent="submit">
      <fieldset class="report-dialog__reasons">
        <legend class="report-dialog__label">{{ t('Что не так с сообщением?') }}</legend>
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
          >{{ t('Комментарий') }} <span class="report-dialog__soft">{{ t('· необязательно') }}</span></label
        >
        <textarea
          id="reportComment"
          v-model="comment"
          class="report-dialog__comment"
          rows="3"
          :maxlength="REPORT_COMMENT_MAX_LENGTH"
          :placeholder="t('Что ещё стоит знать модератору')"
        ></textarea>
      </div>

      <p class="report-dialog__note">
        {{ t('Жалобу рассмотрит администратор сервиса. Автор сообщения не узнает, кто пожаловался.') }}
      </p>

      <p v-if="error" class="report-dialog__error" role="alert">{{ error }}</p>

      <div class="report-dialog__actions">
        <Button variant="ghost" type="button" @click="emit('close')">{{ t('Отмена') }}</Button>
        <Button variant="danger" type="submit" :disabled="!reason || sending">
          {{ sending ? t('Отправляем…') : t('Отправить жалобу') }}
        </Button>
      </div>
    </form>
  </Dialog>
</template>
