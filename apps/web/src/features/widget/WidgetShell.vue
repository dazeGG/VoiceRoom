<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef, computed } from 'vue';
import type { WidgetBootstrap } from '@voice-room/shared/contracts/widget';
import { createWidgetRuntime } from './runtime';
import WidgetJoinControls from './WidgetJoinControls.vue';
const props = defineProps<{ bootstrap: WidgetBootstrap }>();
const mediaMount = ref<HTMLElement | null>(null);
const runtime = shallowRef<ReturnType<typeof createWidgetRuntime> | null>(null);
const code = ref('');
const message = ref('');
const cameraDevice = ref('');
const style = computed(() => ({
  '--vr-bg': props.bootstrap.config.background,
  '--vr-text': props.bootstrap.config.text,
  '--vr-accent': props.bootstrap.config.accent,
  borderRadius: `${props.bootstrap.config.radius}px`
}));
const notify = (type: 'callState' | 'requestCollapse', active?: boolean) =>
  window.parent.postMessage(
    { version: 1, nonce: props.bootstrap.nonce, type, ...(active === undefined ? {} : { active }) },
    props.bootstrap.parentOrigin
  );
onMounted(() => {
  if (mediaMount.value)
    runtime.value = createWidgetRuntime(mediaMount.value, props.bootstrap.config.chat, (active) =>
      notify('callState', active)
    );
});
onBeforeUnmount(() => runtime.value?.leave());
async function run(action: () => Promise<unknown> | undefined) {
  try {
    await action();
  } catch (error) {
    runtime.value?.report(error);
  }
}
function volume(peer: string, event: Event) {
  if (event.target instanceof HTMLInputElement) runtime.value?.volume(peer, Number(event.target.value));
}
async function sendText() {
  await runtime.value?.text(message.value);
  message.value = '';
}
</script>
<template>
  <main class="widget-shell" :style="style">
    <header class="widget-shell__header">
      <strong><span class="widget-shell__brand-mark" aria-hidden="true"></span>VoiceRoom</strong
      ><button v-if="bootstrap.config.mode === 'floating'" type="button" @click="notify('requestCollapse')">
        Свернуть
      </button>
      <span v-else class="widget-shell__guest">Гость</span>
    </header>
    <template v-if="runtime">
      <p role="status" class="widget-shell__status">{{ runtime.state.status }}</p>
      <p v-if="runtime.state.error" role="alert">{{ runtime.state.error }}</p>
      <label v-if="runtime.state.joined">Ваше имя<input v-model="runtime.state.name" maxlength="80" /></label>
      <WidgetJoinControls
        v-if="!runtime.state.joined"
        v-model:name="runtime.state.name"
        v-model:code="code"
        @create="run(() => runtime?.create())"
        @join="run(() => runtime?.join(code))"
      />
      <template v-else>
        <p>
          Код: <strong>{{ runtime.state.roomId }}</strong>
        </p>
        <button @click="runtime.mute()">
          {{ runtime.state.muted ? 'Включить микрофон' : 'Выключить микрофон' }}
        </button>
        <button
          @click="
            run(async () => {
              if (!runtime) return;
              await runtime.camera(!runtime.state.camera);
            })
          "
        >
          {{ runtime.state.camera ? 'Выключить камеру' : 'Включить камеру' }}
        </button>
        <button @click="run(() => runtime?.media.resumeAudio())">Включить звук</button>
        <button @click="runtime.leave()">Выйти</button>
        <details>
          <summary>Настройки звука и видео</summary>
          <label
            >Камера<select v-model="cameraDevice" @change="run(() => runtime?.camera(true, cameraDevice))">
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'videoinput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Камера' }}
              </option>
            </select></label
          >

          <button @click="run(() => runtime?.devices())">Обновить устройства</button>
          <label
            >Микрофон<select v-model="runtime.state.input" @change="run(() => runtime?.capture())">
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'audioinput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Микрофон' }}
              </option>
            </select></label
          >
          <label
            >Вывод звука<select
              v-model="runtime.state.output"
              @change="run(() => runtime?.media.outputDevice(runtime.state.output))"
            >
              <option value="">По умолчанию</option>
              <option
                v-for="device in runtime.state.devices.filter((d) => d.kind === 'audiooutput')"
                :key="device.deviceId"
                :value="device.deviceId"
              >
                {{ device.label || 'Динамики' }}
              </option>
            </select></label
          >
          <label
            >Шумоподавление<select v-model="runtime.state.noise" @change="run(() => runtime?.capture())">
              <option value="rnnoise">RNNoise</option>
              <option value="browser">Браузерное</option>
              <option value="off">Выключено</option>
            </select></label
          >
        </details>
        <ul>
          <li v-for="peer in runtime.state.peers" :key="peer.id">
            {{ peer.name || 'Гость'
            }}<template v-if="peer.id !== runtime.peerId"
              ><label
                >Громкость<input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  :value="runtime.state.localVolumes[peer.id] ?? 1"
                  @input="volume(peer.id, $event)" /></label
              ><button @click="runtime.volume(peer.id, runtime.state.localVolumes[peer.id] === 0 ? 1 : 0)">
                {{ runtime.state.localVolumes[peer.id] === 0 ? 'Включить локально' : 'Отключить локально' }}
              </button></template
            >
          </li>
        </ul>
        <section v-if="runtime.state.chat" aria-label="Текстовый чат" class="widget-shell__chat">
          <ol>
            <li v-for="item in runtime.state.messages" :key="item.id">
              {{ item.name }}: <span>{{ item.text }}</span
              ><button v-if="item.peerId === runtime.peerId" @click="run(() => runtime?.deleteText(item.id))">
                Удалить сообщение
              </button>
            </li>
          </ol>
          <form @submit.prevent="run(sendText)">
            <label>Сообщение<input v-model="message" maxlength="4000" /></label>
            <button>Отправить</button>
          </form>
        </section>
      </template>
    </template>
    <div ref="mediaMount" class="widget-media" />
  </main>
</template>
