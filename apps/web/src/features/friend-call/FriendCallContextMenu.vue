<script setup lang="ts">
import { User, Volume2, VolumeX } from '@lucide/vue';
import { computed, shallowRef } from 'vue';
import { DEFAULT_PARTICIPANT_VOLUME, MAX_PARTICIPANT_VOLUME } from '@voiceroom/call/engine/core/config';
import {
  getParticipantAudioPreference,
  getParticipantAudioPreferenceKey,
  storeParticipantAudioPreference,
  type ParticipantAudioPreference
} from '@voiceroom/call/engine/core/settings';
import type { Participant } from '@voiceroom/call/engine/core/types';
import { applyRemoteParticipantAudioPreferences } from '@voiceroom/call/engine/services/media-playback-service';
import type { CallSnapshot } from '@voiceroom/shared/contracts/rings';
import { ContextMenu, MenuItem, MenuLabel, Slider } from '@voiceroom/ui-kit/components';
import { iconMd, iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { useProfileCardUiStore } from '@/entities/profile-card/profile-card-ui.store';
import { useRoomSocial } from '@/features/room/social';
import { t } from '@/shared/i18n';
import { effectivePresenceStatus } from '@/shared/presence';

const { peer, participant, position } = defineProps<{
  peer: CallSnapshot['caller'];
  participant: Participant | undefined;
  position: { x: number; y: number; tile: HTMLElement | null };
}>();
const emit = defineEmits<{ close: [] }>();
const { openProfileCardFor } = useProfileCardUiStore();
const social = useRoomSocial();

const preferenceKey = computed(() => getParticipantAudioPreferenceKey(peer.id, participant?.id ?? ''));
const preference = shallowRef(getParticipantAudioPreference(preferenceKey.value));
const volumePercent = computed(() => Math.round(preference.value.volume * 100));
const volumeLabel = computed(() => `${volumePercent.value}%`);
const name = computed(() => participant?.name ?? peer.displayName);

function showProfile(close: (restoreFocus?: boolean) => void): void {
  const { id, displayName, avatarUrl, avatarColorKey, avatarAccent } = peer;
  const friend = social.friends().find((entry) => entry.user.id === id);
  const presence = friend
    ? effectivePresenceStatus(friend.online, friend.user.presenceStatus, friend.user.doNotDisturb)
    : 'online';
  const person = {
    userId: id,
    name: displayName,
    login: social.knownLogin(id),
    avatarUrl,
    avatarColorKey,
    avatarAccent,
    presence
  };
  const { x, y, tile } = position;
  close(false);
  queueMicrotask(() => openProfileCardFor(person, { rect: { left: x, right: x, top: y }, restoreFocus: tile }));
}

function updateAudioPreference(patch: Partial<ParticipantAudioPreference>): void {
  if (!participant) return;
  preference.value = storeParticipantAudioPreference(preferenceKey.value, patch);
  applyRemoteParticipantAudioPreferences(participant);
}
</script>

<template>
  <ContextMenu
    open
    :x="position.x"
    :y="position.y"
    v-bind="{ ariaLabel: t('Действия для {p0}', { p0: name }) }"
    :restore-focus="position.tile"
    @close="emit('close')"
  >
    <template #default="{ close }">
      <div class="participant-menu">
        <MenuLabel :text="name" />
        <MenuItem :label="t('Профиль')" @select.prevent="showProfile(close)">
          <template #icon><User v-bind="iconMd" aria-hidden="true" /></template>
        </MenuItem>

        <template v-if="participant">
          <div class="participant-menu__volume">
            <div class="participant-menu__volume-head">
              <span class="participant-menu__volume-label">
                <Volume2 v-bind="iconSm" aria-hidden="true" />
                <span>{{ t('Громкость') }}</span>
              </span>
              <output class="participant-menu__volume-value">{{ volumeLabel }}</output>
            </div>
            <Slider
              :model-value="volumePercent"
              :min="0"
              :max="MAX_PARTICIPANT_VOLUME * 100"
              :step="1"
              :default-value="DEFAULT_PARTICIPANT_VOLUME * 100"
              snap
              :snap-threshold="6"
              :aria-label="t('Громкость {p0}', { p0: name })"
              :aria-value-text="volumeLabel"
              @value-change="(percent) => updateAudioPreference({ volume: percent / 100 })"
            />
          </div>
          <MenuItem
            :label="preference.muted ? t('Включить для меня') : t('Заглушить для меня')"
            @select.prevent="
              updateAudioPreference({ muted: !preference.muted });
              close();
            "
          >
            <template #icon><VolumeX v-bind="iconMd" aria-hidden="true" /></template>
          </MenuItem>
        </template>
      </div>
    </template>
  </ContextMenu>
</template>
