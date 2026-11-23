<script setup lang="ts">
import { Badge } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
</script>
<!-- The stage the service is at, next to the logo: a quiet accent pill, not a
     warning. The label is the fixed English word BETA in every language; the
     hint, localized, says what it means for the person using it. -->
<template>
  <Badge
    size="sm"
    tone="soft"
    :title="t('VoiceRoom в бета-версии: активно дорабатывается, что-то может работать неидеально')"
    >BETA</Badge
  >
</template>
