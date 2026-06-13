<script lang="ts">
  import Topbar from '$lib/shared/components/Topbar.svelte';
</script>

<Topbar label="Новая голосовая комната" reload>
  <div class="room-heading topbar-room-heading" aria-label="Комната" hidden>
    <div class="room-title-line">
      <h1 id="roomTitle">room</h1>
      <div class="room-title-actions">
        <button class="copy-room-button" id="copyCodeButton" type="button" aria-label="Скопировать код комнаты" data-icon="copy"></button>
        <button class="copy-room-button" id="copyLinkButton" type="button" aria-label="Скопировать ссылку на комнату" data-icon="link"></button>
      </div>
    </div>
  </div>
  <div class="status-pill" data-state="idle" id="statusPill" hidden>
    <span class="status-dot" aria-hidden="true"></span>
    <span id="statusText">готово</span>
  </div>
</Topbar>
