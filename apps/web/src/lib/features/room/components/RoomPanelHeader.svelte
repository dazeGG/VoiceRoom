<script lang="ts">
  import { ChevronRight, MessageSquare, Users, X } from '@lucide/svelte';
  import { iconSm } from '$lib/shared/ui/icons';

  let {
    activeTab,
    unread,
    mobile,
    chatTabId,
    participantsTabId,
    chatPanelId,
    participantsPanelId,
    onSelectChat,
    onSelectParticipants,
    onCollapse
  }: {
    activeTab: 'chat' | 'participants';
    unread: number;
    /** On a phone the panel is the whole screen, so it closes instead of collapsing. */
    mobile: boolean;
    chatTabId?: string;
    participantsTabId?: string;
    chatPanelId?: string;
    participantsPanelId?: string;
    onSelectChat?: () => void;
    onSelectParticipants?: () => void;
    onCollapse?: () => void;
  } = $props();
</script>

<header class="chat-rail-head">
  <div class="room-panel-tabs" role="tablist" aria-label="Раздел панели комнаты">
    <button
      id={chatTabId}
      type="button"
      role="tab"
      aria-controls={chatPanelId}
      aria-label="Чат"
      aria-selected={activeTab === 'chat'}
      data-active={activeTab === 'chat'}
      title="Чат"
      onclick={() => onSelectChat?.()}
    >
      <MessageSquare {...iconSm} aria-hidden="true" />
      {#if unread > 0}<span class="room-panel-tab-unread" aria-hidden="true"></span>{/if}
    </button>
    <button
      id={participantsTabId}
      type="button"
      role="tab"
      aria-controls={participantsPanelId}
      aria-label="Участники"
      aria-selected={activeTab === 'participants'}
      data-active={activeTab === 'participants'}
      title="Участники"
      onclick={() => onSelectParticipants?.()}
    >
      <Users {...iconSm} aria-hidden="true" />
    </button>
  </div>
  <button
    class="chat-rail-collapse"
    type="button"
    aria-label={mobile ? 'Закрыть панель' : 'Свернуть панель'}
    onclick={() => onCollapse?.()}
  >
    {#if mobile}
      <X {...iconSm} aria-hidden="true" />
    {:else}
      <ChevronRight {...iconSm} aria-hidden="true" />
    {/if}
  </button>
</header>
