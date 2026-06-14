<script lang="ts">
  let {
    rooms,
    onOpenRoom,
    onRemoveRoom
  } = $props<{
    rooms: { roomId: string; savedAt: number }[];
    onOpenRoom: (roomId: string) => void;
    onRemoveRoom: (roomId: string) => void;
  }>();
</script>

<section class="home-list-card" aria-label="Мои статичные комнаты">
  <div class="home-list-head">
    <div>
      <span class="home-list-kicker">Локально</span>
      <h2 class="home-list-title">Мои статичные комнаты</h2>
    </div>
    <span class="home-list-count">{rooms.length}</span>
  </div>

  {#if rooms.length}
    <div class="home-room-list">
      {#each rooms as room}
        <article class="home-room-row" aria-label={`Комната ${room.roomId}`}>
          <div class="home-room-row-main">
            <span class="home-room-row-badge">static</span>
            <span class="home-room-row-code">{room.roomId}</span>
          </div>
          <div class="home-room-row-actions">
            <button class="home-ghost-button home-ghost-button--small" type="button" onclick={() => onOpenRoom(room.roomId)}>
              Открыть
            </button>
            <button
              class="home-icon-button home-icon-button--muted"
              type="button"
              aria-label={`Удалить комнату ${room.roomId} из локального списка`}
              onclick={() => onRemoveRoom(room.roomId)}
            >
              ×
            </button>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <p class="home-list-empty">
      Пока нет сохранённых статичных комнат. Нажмите <b>+</b> после ввода кода, чтобы добавить комнату в список.
    </p>
  {/if}
</section>
