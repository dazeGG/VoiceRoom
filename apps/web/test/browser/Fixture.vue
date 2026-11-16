<script setup lang="ts">
import { ref } from 'vue';
import TypingIndicator from '../../src/shared/chat/TypingIndicator.vue';
import StructuredMessageContent from '../../src/shared/chat/StructuredMessageContent.vue';
import WhatsNew from '../../src/features/home/components/WhatsNewDialog.vue';
import Appearance from '../../src/features/home/components/settings/AppearanceSettings.vue';
import Dialog from '../../src/shared/ui/Dialog/Dialog.vue';
const appearance = ref(false);
const urgent = ref(false);
</script>
<template>
  <main>
    <div class="dm-composer" data-testid="dm-typing-host">
      <div class="dm-composer__row attachment-compose">
        <textarea class="dm-composer__input" aria-label="DM draft" />
      </div>
      <TypingIndicator label="Fixture is typing" />
    </div>
    <form class="room-chat-composer" data-testid="room-typing-host" @submit.prevent>
      <div class="room-chat-composer__row attachment-compose">
        <textarea class="room-chat-composer__input" aria-label="Room draft" />
      </div>
      <TypingIndicator label="Fixture is typing" />
    </form>
    <div class="room-chat-group" style="background: var(--vr-surface-hover)">
      <time class="room-chat-group__time">12:34</time><span class="room-chat-group__edited">изменено</span>
    </div>
    <p data-testid="chat-text"><StructuredMessageContent fallback="Fixture chat message for readable text." /></p>
    <button>Background</button><Appearance /><WhatsNew :paused="urgent" @open-appearance="appearance = true" /><Dialog
      :open="appearance"
      title="Appearance"
      :on-close="() => (appearance = false)"
      ><Appearance /></Dialog
    ><Dialog :open="urgent" title="Urgent" :on-close="() => (urgent = false)"><button>Urgent action</button></Dialog
    ><button @click="urgent = true">Urgent</button>
  </main>
</template>
